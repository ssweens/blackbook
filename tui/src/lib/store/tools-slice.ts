import type { ToolDetectionResult } from "../types.js";
import { getManagedToolRows } from "../tool-view.js";
import { detectTool } from "../tool-detect.js";
import { TOOL_REGISTRY, getToolRegistryEntry } from "../tool-registry.js";
import {
  installTool,
  uninstallTool,
  updateTool,
  reinstallTool,
  detectInstallMethodMismatch,
  detectInstallMethodFromPath,
  type ProgressEvent,
} from "../tool-lifecycle.js";
import { getPackageManager, getToolInstances, updateToolInstanceConfig } from "../config.js";
import { invalidatePluginToolStatusCache } from "../plugin-status.js";
import type { Store, SliceCreator } from "./types.js";

const TOOL_OUTPUT_MAX_LINES = 200;
let toolActionAbortController: AbortController | null = null;

/** Strip ANSI escape sequences so Ink doesn't re-interpret raw codes. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Append process output while handling carriage-return (\r) correctly.
 *
 * Terminal spinners (npm, pip, etc.) emit `\rNew text` to overwrite the
 * current line in-place.  The previous implementation only split on `\n`,
 * so every spinner frame was appended as a separate line, causing the
 * "stacking Upgrading" bug.
 *
 * Rules:
 *  - `\n` → new line (append)
 *  - bare `\r` (no following `\n`) → carriage return (replace last line)
 */
function appendToolOutput(existing: string[], chunk: string): string[] {
  if (!chunk) return existing;

  const clean = stripAnsi(chunk);
  const next = [...existing];
  const hasCarriageReturn = clean.includes("\r");

  // Split on actual newlines first
  const segments = clean.split("\n");

  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];

    // Within a segment, \r means "go back to start of line".
    // Keep only the text after the last \r (what the terminal would show).
    if (seg.includes("\r")) {
      const parts = seg.split("\r");
      seg = parts.filter((p) => p.length > 0).pop() || "";
    }

    const trimmed = seg.trim();
    if (trimmed.length === 0) continue;

    // First segment of a \r-containing chunk replaces the last output line
    // (simulates the terminal overwriting the current line).
    if (hasCarriageReturn && next.length > 0 && i === 0) {
      next[next.length - 1] = trimmed;
    } else {
      next.push(trimmed);
    }
  }

  if (next.length <= TOOL_OUTPUT_MAX_LINES) {
    return next;
  }
  return next.slice(next.length - TOOL_OUTPUT_MAX_LINES);
}

export type ToolsSlice = Pick<
  Store,
  // state
  | "tools"
  | "managedTools"
  | "toolDetection"
  | "toolDetectionPending"
  | "toolActionInProgress"
  | "toolActionOutput"
  // actions
  | "refreshManagedTools"
  | "refreshToolDetection"
  | "installToolAction"
  | "updateToolAction"
  | "uninstallToolAction"
  | "cancelToolAction"
  | "toggleToolEnabled"
  | "updateToolConfigDir"
>;

export const createToolsSlice: SliceCreator<ToolsSlice> = (set, get) => ({
  tools: getToolInstances(),
  managedTools: getManagedToolRows(),
  toolDetection: {},
  toolDetectionPending: {},
  toolActionInProgress: null,
  toolActionOutput: [],

  refreshManagedTools: () => {
    set({ managedTools: getManagedToolRows() });
  },

  refreshToolDetection: async () => {
    const packageManager = getPackageManager();
    const entries = Object.values(TOOL_REGISTRY);
    const initialPending: Record<string, boolean> = {};
    for (const entry of entries) {
      initialPending[entry.toolId] = true;
    }

    set({ toolDetectionPending: initialPending });

    const nextDetection: Record<string, ToolDetectionResult> = {};
    const nextPending: Record<string, boolean> = {};

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const result = await detectTool(entry, packageManager);
          nextDetection[entry.toolId] = result;
          nextPending[entry.toolId] = false;
        } catch (error) {
          nextDetection[entry.toolId] = {
            toolId: entry.toolId,
            installed: false,
            binaryPath: null,
            installedVersion: null,
            latestVersion: null,
            hasUpdate: false,
            error: error instanceof Error ? error.message : String(error),
          };
          nextPending[entry.toolId] = false;
        }
      })
    );

    set((state) => ({
      toolDetection: { ...state.toolDetection, ...nextDetection },
      toolDetectionPending: { ...state.toolDetectionPending, ...nextPending },
    }));
  },

  installToolAction: async (toolId, options) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const onProgress = (event: ProgressEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
        return;
      }
      if (event.type === "error") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
        return;
      }
      if (event.type === "timeout") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
        return;
      }
      if (event.type === "cancelled") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
      }
    };

    const packageManager = getPackageManager();
    const mismatch = await detectInstallMethodMismatch(toolId, packageManager, before?.binaryPath);
    if (mismatch) {
      set((state) => ({
        toolActionOutput: appendToolOutput(state.toolActionOutput, mismatch.message),
      }));
    }

    const shouldMigrate = options?.migrate === true;
    const success = shouldMigrate
      ? await reinstallTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal })
      : await installTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal });

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    if (success && !after?.installed) {
      notify(
        `Install command succeeded but tool is still not detected in PATH (${after?.binaryPath || "no binary path"}).`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool installed successfully." : "Tool install failed.", success ? "success" : "error");
    return success;
  },

  updateToolAction: async (toolId, options) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const onProgress = (event: ProgressEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
        return;
      }
      if (event.type === "error") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
        return;
      }
      if (event.type === "timeout") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
        return;
      }
      if (event.type === "cancelled") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
      }
    };

    const packageManager = getPackageManager();
    const mismatch = await detectInstallMethodMismatch(toolId, packageManager, before?.binaryPath);
    if (mismatch) {
      set((state) => ({
        toolActionOutput: appendToolOutput(state.toolActionOutput, mismatch.message),
      }));
    }

    const shouldMigrate = options?.migrate === true;
    const success = shouldMigrate
      ? await reinstallTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal })
      : await updateTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal });

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    const ineffectiveUpdate = Boolean(
      success &&
      after?.installed &&
      after.hasUpdate &&
      after.installedVersion === before?.installedVersion
    );

    if (ineffectiveUpdate || (!success && mismatch && !shouldMigrate)) {
      const migrationNote = getToolRegistryEntry(toolId)?.lifecycle?.migration_note;
      notify(
        `Update did not complete cleanly for the active binary (${after?.binaryPath || before?.binaryPath || "unknown path"}). ${migrationNote || "If install methods differ, retry and press m in the action modal to migrate methods."}`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool updated successfully." : "Tool update failed.", success ? "success" : "error");
    return success;
  },

  uninstallToolAction: async (toolId) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const packageManager = getPackageManager();
    const detectedInstallMethod = detectInstallMethodFromPath(before?.binaryPath);
    const success = await uninstallTool(
      toolId,
      packageManager,
      (event: ProgressEvent) => {
        if (event.type === "stdout" || event.type === "stderr") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
          return;
        }
        if (event.type === "error") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
          return;
        }
        if (event.type === "timeout") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
          return;
        }
        if (event.type === "cancelled") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
        }
      },
      { signal: toolActionAbortController.signal, detectedInstallMethod }
    );

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    if (success && after?.installed) {
      notify(
        `Uninstall command completed but binary is still detected at ${after.binaryPath || "unknown path"}.`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool uninstalled successfully." : "Tool uninstall failed.", success ? "success" : "error");
    return success;
  },

  cancelToolAction: () => {
    if (toolActionAbortController) {
      toolActionAbortController.abort();
      toolActionAbortController = null;
    }
  },

  toggleToolEnabled: async (toolId, instanceId) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    const configuredFromState = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const configuredTool = configuredFromState || (getToolInstances() || []).find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const managedTool = get().managedTools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    if (!configuredTool && !managedTool) {
      notify(`Unknown tool instance: ${toolId}:${instanceId}`, "error");
      return;
    }

    const displayName = configuredTool?.name || managedTool?.displayName || `${toolId}:${instanceId}`;
    const currentEnabled = configuredTool?.enabled ?? managedTool?.enabled ?? false;
    const currentConfigDir = configuredTool?.configDir || managedTool?.configDir;

    try {
      updateToolInstanceConfig(toolId, instanceId, {
        id: instanceId,
        name: displayName,
        configDir: currentConfigDir,
        enabled: !currentEnabled,
      });
    } catch (error) {
      notify(`Failed to update ${displayName}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    await get().refreshAll({ silent: true });
    notify(`${displayName} ${currentEnabled ? "disabled" : "enabled"}`, "success");
  },

  updateToolConfigDir: async (toolId, instanceId, configDir) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    const trimmed = configDir.trim();
    if (!trimmed) {
      notify("Config directory cannot be empty.", "error");
      return;
    }

    const configuredFromState = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const configuredTool = configuredFromState || (getToolInstances() || []).find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const managedTool = get().managedTools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const displayName = (configuredTool?.name || managedTool?.displayName) ?? `${toolId}:${instanceId}`;
    try {
      updateToolInstanceConfig(toolId, instanceId, {
        id: instanceId,
        name: configuredTool?.name || managedTool?.displayName,
        configDir: trimmed,
        enabled: configuredTool?.enabled ?? managedTool?.enabled,
      });
    } catch (error) {
      notify(`Failed to update ${displayName}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    await get().refreshAll({ silent: true });
    notify(`Updated ${displayName} config_dir`, "success");
  },
});
