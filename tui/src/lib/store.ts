import { create } from "zustand";
import { existsSync, lstatSync, statSync, watch } from "fs";
import type {
  Tab,
  Marketplace,
  Plugin,
  FileStatus,
  FileInstanceStatus,
  AppState,
  Notification,
  SyncPreviewItem,
  DiffTarget,
  DiffInstanceRef,
  MissingSummary,
  PiPackage,
  PiMarketplace,
  DiscoverSection,
  DiscoverSubView,
  ManagedToolRow,
  ToolDetectionResult,
} from "./types.js";
import { loadAllPiMarketplaces, getAllPiPackages, loadPiSettings, isPackageInstalled, fetchNpmPackageDetails } from "./pi-marketplace.js";
import { installPiPackage, removePiPackage, updatePiPackage } from "./pi-install.js";
import {
  parseMarketplaces,
  addMarketplace as addMarketplaceToConfig,
  removeMarketplace as removeMarketplaceFromConfig,
  ensureConfigExists,
  getConfigPath,
  getToolInstances,
  updateToolInstanceConfig,
  getEnabledToolInstances,
  getCacheDir,
  loadConfig,
  setMarketplaceEnabled,
  setPiMarketplaceEnabled,
  addPiMarketplace as addPiMarketplaceToConfig,
  removePiMarketplace as removePiMarketplaceFromConfig,
  getPackageManager,
  getConfigRepoPath,
  getAssetsRepoPath,
} from "./config.js";
import { loadConfig as loadYamlConfig, getConfigPath as getYamlConfigPath } from "./config/loader.js";
import { resolveSourcePath, expandPath as expandConfigPath } from "./config/path.js";
import { pullSourceRepo } from "./source-setup.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "./config/playbooks.js";
import { runCheck, runApply } from "./modules/orchestrator.js";
import { fileCopyModule } from "./modules/file-copy.js";
import { directorySyncModule } from "./modules/directory-sync.js";
import { globCopyModule } from "./modules/glob-copy.js";
import { buildFileDiffTarget, buildFileMissingSummary } from "./diff.js";
import { buildStateKey } from "./state.js";
import type { OrchestratorStep } from "./modules/orchestrator.js";
import { fetchMarketplace } from "./marketplace.js";
import { getManagedToolRows } from "./tool-view.js";
import { detectTool } from "./tool-detect.js";
import { TOOL_REGISTRY, getToolRegistryEntry } from "./tool-registry.js";
import { installTool, uninstallTool, updateTool, reinstallTool, detectInstallMethodMismatch, type ProgressEvent } from "./tool-lifecycle.js";

import {
  getAllInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  getPluginToolStatus,
  syncPluginInstances,
  manifestPath,
} from "./install.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: () => Promise<void>;
  loadFiles: () => Promise<FileStatus[]>;
  loadTools: () => void;
  refreshManagedTools: () => void;
  refreshToolDetection: () => Promise<void>;
  installToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  updateToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  uninstallToolAction: (toolId: string) => Promise<boolean>;
  cancelToolAction: () => void;
  refreshAll: () => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  setDetailPlugin: (plugin: Plugin | null) => void;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => void;
  updateMarketplace: (name: string) => Promise<void>;
  toggleMarketplaceEnabled: (name: string) => Promise<void>;
  toggleToolEnabled: (toolId: string, instanceId: string) => Promise<void>;
  updateToolConfigDir: (toolId: string, instanceId: string, configDir: string) => Promise<void>;
  getSyncPreview: () => SyncPreviewItem[];
  syncTools: (items: SyncPreviewItem[]) => Promise<void>;
  notify: (message: string, type?: Notification["type"], options?: { spinner?: boolean }) => string;
  clearNotification: (id: string) => void;
  // Pi package actions
  loadPiPackages: () => Promise<void>;
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  setDetailPiPackage: (pkg: PiPackage | null) => Promise<void>;
  togglePiMarketplaceEnabled: (name: string) => Promise<void>;
  addPiMarketplace: (name: string, source: string) => Promise<void>;
  removePiMarketplace: (name: string) => Promise<void>;
  // Section navigation
  setCurrentSection: (section: DiscoverSection) => void;
  setDiscoverSubView: (subView: DiscoverSubView) => void;
  // Diff view actions
  openDiffForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openMissingSummaryForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openDiffFromSyncItem: (item: SyncPreviewItem) => void;
  closeDiff: () => void;
  closeMissingSummary: () => void;

  // Pullback actions
  pullbackFileInstance: (file: FileStatus, instance: DiffInstanceRef) => Promise<boolean>;
}

export type Store = AppState & Actions;

function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
}

function isDirectorySource(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const stat = lstatSync(path);
    if (stat.isDirectory()) return true;
    if (stat.isSymbolicLink()) {
      return statSync(path).isDirectory();
    }
  } catch {
    return false;
  }
  return false;
}

function isGlobPath(pathValue: string): boolean {
  return /[*?\[{]/.test(pathValue);
}

function getSyncModule(sourcePath: string) {
  if (isGlobPath(sourcePath)) return globCopyModule;
  return isDirectorySource(sourcePath) ? directorySyncModule : fileCopyModule;
}

export interface InstallStatus {
  installed: boolean;
  incomplete?: boolean;
}

function getInstallStatus(plugin: Plugin, installedAny: boolean): InstallStatus {
  if (!installedAny) return { installed: false, incomplete: false };

  const statuses = getPluginToolStatus(plugin);
  const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
  if (supportedEnabled.length === 0) return { installed: false, incomplete: false };

  const incomplete = supportedEnabled.some((status) => !status.installed);
  return { installed: true, incomplete };
}


function buildSyncPreview(plugins: Plugin[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const plugin of plugins) {
    const statuses = getPluginToolStatus(plugin);
    const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
    if (supportedEnabled.length === 0) continue;
    const installedAny = supportedEnabled.some((status) => status.installed);
    if (!installedAny) continue;
    const missingInstances = supportedEnabled
      .filter((status) => !status.installed)
      .map((status) => status.name);
    if (missingInstances.length === 0) continue;

    preview.push({ kind: "plugin", plugin, missingInstances });
  }
  return preview;
}


function buildFileSyncPreview(files: FileStatus[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const file of files) {
    const missingInstances = file.instances
      .filter((i) => i.status === "missing")
      .map((i) => i.instanceName);
    const driftedInstances = file.instances
      .filter((i) => i.status === "drifted")
      .map((i) => i.instanceName);

    if (missingInstances.length === 0 && driftedInstances.length === 0) continue;

    preview.push({ kind: "file", file, missingInstances, driftedInstances });
  }
  return preview;
}

function buildToolSyncPreview(
  tools: ManagedToolRow[],
  toolDetection: Record<string, ToolDetectionResult>
): SyncPreviewItem[] {
  const uniqueByTool = new Map<string, ManagedToolRow>();
  for (const tool of tools) {
    if (!uniqueByTool.has(tool.toolId)) {
      uniqueByTool.set(tool.toolId, tool);
    }
  }

  const preview: SyncPreviewItem[] = [];
  for (const [toolId, tool] of uniqueByTool.entries()) {
    const detection = toolDetection[toolId];
    if (!detection) continue;
    if (!detection.installed) continue;
    if (!detection.hasUpdate) continue;
    if (!detection.installedVersion || !detection.latestVersion) continue;

    preview.push({
      kind: "tool",
      toolId,
      name: tool.displayName,
      installedVersion: detection.installedVersion,
      latestVersion: detection.latestVersion,
    });
  }

  return preview;
}

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

export const useStore = create<Store>((set, get) => ({
  tab: "installed",
  marketplaces: [],
  installedPlugins: [],
  files: [],
  tools: getToolInstances(),
  managedTools: getManagedToolRows(),
  toolDetection: {},
  toolDetectionPending: {},
  toolActionInProgress: null,
  toolActionOutput: [],
  search: "",
  selectedIndex: 0,
  loading: false,
  error: null,
  detailPlugin: null,
  detailMarketplace: null,
  detailPiPackage: null,
  notifications: [],
  diffTarget: null,
  missingSummary: null,
  // Pi packages state
  piPackages: [],
  piMarketplaces: [],
  // Section navigation
  currentSection: "plugins" as DiscoverSection,
  discoverSubView: null as DiscoverSubView,

  setTab: (tab) =>
    set((state) =>
      state.tab === tab
        ? state
        : {
            tab,
            selectedIndex: 0,
            search: "",
            detailPlugin: null,
            detailMarketplace: null,
            discoverSubView: null,
            currentSection: "plugins",
          }
    ),
  setSearch: (search) => set({ search, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setDetailPlugin: (plugin) => set({ detailPlugin: plugin }),
  setDetailMarketplace: (marketplace) => set({ detailMarketplace: marketplace }),
  setDetailPiPackage: async (pkg) => {
    if (!pkg) {
      set({ detailPiPackage: null });
      return;
    }
    
    // Set immediately so UI shows something
    set({ detailPiPackage: pkg });
    
    // Fetch full details for npm packages
    if (pkg.sourceType === "npm") {
      const details = await fetchNpmPackageDetails(pkg.source);
      if (details) {
        // Merge details into the package
        set((state) => ({
          detailPiPackage: state.detailPiPackage?.source === pkg.source
            ? { ...state.detailPiPackage, ...details }
            : state.detailPiPackage,
        }));
      }
    }
  },
  setCurrentSection: (section) => set({ currentSection: section }),
  setDiscoverSubView: (subView) => set({ discoverSubView: subView }),

  notify: (message, type = "info", options) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification: Notification = { id, message, type, timestamp: Date.now(), spinner: options?.spinner };
    set((state) => ({ notifications: [...state.notifications, notification] }));
    return id;
  },

  clearNotification: (id) => {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }));
  },

  loadTools: () => {
    set({ tools: getToolInstances(), managedTools: getManagedToolRows() });
  },

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

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const result = await detectTool(entry, packageManager);
          set((state) => ({
            toolDetection: {
              ...state.toolDetection,
              [entry.toolId]: result,
            },
            toolDetectionPending: {
              ...state.toolDetectionPending,
              [entry.toolId]: false,
            },
          }));
        } catch (error) {
          set((state) => ({
            toolDetection: {
              ...state.toolDetection,
              [entry.toolId]: {
                toolId: entry.toolId,
                installed: false,
                binaryPath: null,
                installedVersion: null,
                latestVersion: null,
                hasUpdate: false,
                error: error instanceof Error ? error.message : String(error),
              },
            },
            toolDetectionPending: {
              ...state.toolDetectionPending,
              [entry.toolId]: false,
            },
          }));
        }
      })
    );
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

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const packageManager = getPackageManager();
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
      { signal: toolActionAbortController.signal }
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

  loadPiPackages: async () => {
    // Load Pi packages only when Pi is enabled in config or detected as installed.
    const tools = get().tools;
    const piEnabled = tools.some((t) => t.toolId === "pi" && t.enabled);
    const piInstalled = get().toolDetection.pi?.installed === true;
    if (!piEnabled && !piInstalled) {
      set({ piPackages: [], piMarketplaces: [] });
      return;
    }

    try {
      const marketplaces = await loadAllPiMarketplaces();
      let packages = getAllPiPackages(marketplaces);

      // Add installed npm packages that aren't in any marketplace
      const settings = loadPiSettings();
      const existingSources = new Set(packages.map((p) => p.source.toLowerCase()));

      for (const source of settings.packages) {
        if (existingSources.has(source.toLowerCase())) continue;
        if (!source.startsWith("npm:")) continue;

        // Fetch package details from npm
        const pkgName = source.slice(4);
        const details = await fetchNpmPackageDetails(pkgName);
        if (!details) continue;

        const pkg: PiPackage = {
          name: details.name ?? pkgName,
          description: details.description ?? "",
          version: details.version ?? "0.0.0",
          source,
          sourceType: "npm",
          marketplace: "npm",
          installed: true,
          extensions: details.extensions ?? [],
          skills: details.skills ?? [],
          prompts: details.prompts ?? [],
          themes: details.themes ?? [],
          homepage: details.homepage,
          repository: details.repository,
          author: details.author,
          license: details.license,
        };
        packages.push(pkg);
      }

      set({ piPackages: packages, piMarketplaces: marketplaces });
    } catch (error) {
      console.error("Failed to load Pi packages:", error);
      set({ piPackages: [], piMarketplaces: [] });
    }
  },

  installPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    const loadingId = notify(`Installing ${pkg.name}...`, "info", { spinner: true });
    try {
      const result = await installPiPackage(pkg);
      clearNotification(loadingId);
      if (result.success) {
        notify(`Installed ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to install ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      clearNotification(loadingId);
      notify(`Error installing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  uninstallPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    const loadingId = notify(`Uninstalling ${pkg.name}...`, "info", { spinner: true });
    try {
      const result = await removePiPackage(pkg);
      clearNotification(loadingId);
      if (result.success) {
        notify(`Uninstalled ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to uninstall ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      clearNotification(loadingId);
      notify(`Error uninstalling ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  updatePiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    const loadingId = notify(`Updating ${pkg.name}...`, "info", { spinner: true });
    try {
      const result = await updatePiPackage(pkg);
      clearNotification(loadingId);
      if (result.success) {
        notify(`Updated ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to update ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      clearNotification(loadingId);
      notify(`Error updating ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  togglePiMarketplaceEnabled: async (name) => {
    const { piMarketplaces, notify } = get();
    const marketplace = piMarketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const newEnabled = !marketplace.enabled;
    setPiMarketplaceEnabled(name, newEnabled);
    notify(`${name} Pi marketplace ${newEnabled ? "enabled" : "disabled"}`, "info");
    await get().loadPiPackages();
  },

  addPiMarketplace: async (name, source) => {
    const { notify } = get();
    const existing = get().piMarketplaces.find((m) => m.name === name);
    if (existing) {
      notify(`Pi marketplace "${name}" already exists`, "error");
      return;
    }
    addPiMarketplaceToConfig(name, source);
    notify(`Added Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },

  removePiMarketplace: async (name) => {
    const { notify } = get();
    removePiMarketplaceFromConfig(name);
    notify(`Removed Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },

  loadMarketplaces: async () => {
    set((state) => ({
      loading:
        state.marketplaces.length === 0 &&
        state.installedPlugins.length === 0,
      error: null,
    }));

    try {
      const marketplaces = parseMarketplaces();
      const { plugins: installedPlugins } = getAllInstalledPlugins();
      const tools = getToolInstances();

      const enrichedMarketplaces: Marketplace[] = await Promise.all(
        marketplaces.map(async (m) => {
          // Skip fetching plugins for disabled marketplaces
          if (!m.enabled) {
            return {
              ...m,
              plugins: [],
              availableCount: 0,
              installedCount: 0,
            };
          }
          
          const plugins = await fetchMarketplace(m);
          const installedCount = plugins.filter((p) =>
            installedPlugins.some((ip) => ip.name === p.name)
          ).length;

          return {
            ...m,
            plugins: plugins.map((p) => ({
              ...p,
              ...getInstallStatus(p, installedPlugins.some((ip) => ip.name === p.name)),
            })),
            availableCount: plugins.length,
            installedCount,
            updatedAt: new Date(),
          };
        })
      );

      // Replace scanned plugin with marketplace plugin entirely when available
      // Scanned plugins only tell us "something is installed" - for all metadata
      // (marketplace, description, full component list), use marketplace plugin
      const allMarketplacePlugins = enrichedMarketplaces.flatMap((m) => m.plugins);
      const installedWithStatus = installedPlugins.map((scannedPlugin) => {
        const marketplacePlugin = allMarketplacePlugins.find((mp) => mp.name === scannedPlugin.name);
        if (marketplacePlugin) {
          // Use marketplace plugin entirely - has correct marketplace, description, components
          // Plugin IS installed (it's in the scanned list), but may be incomplete
          const status = getInstallStatus(marketplacePlugin, true);
          return {
            ...marketplacePlugin,
            installed: true, // Always true since it was found on disk
            incomplete: status.incomplete,
          };
        }
        // Local-only plugin - no marketplace version exists
        const status = getInstallStatus(scannedPlugin, true);
        return {
          ...scannedPlugin,
          installed: true, // Always true since it was found on disk
          incomplete: status.incomplete,
        };
      });

      set({
        marketplaces: enrichedMarketplaces,
        installedPlugins: installedWithStatus,
        tools,
        managedTools: getManagedToolRows(),
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadInstalledPlugins: async () => {
    const { plugins: installed } = getAllInstalledPlugins();
    const marketplaces = get().marketplaces.map((m) => ({
      ...m,
      plugins: m.plugins.map((p) => ({
        ...p,
        ...getInstallStatus(p, installed.some((ip) => ip.name === p.name)),
      })),
    }));
    // Replace scanned plugin with marketplace plugin entirely when available
    // Scanned plugins only tell us "something is installed" - for all metadata
    // (marketplace, description, full component list), use marketplace plugin
    const allMarketplacePlugins = marketplaces.flatMap((m) => m.plugins);
    const installedWithStatus = installed.map((scannedPlugin) => {
      const marketplacePlugin = allMarketplacePlugins.find((mp) => mp.name === scannedPlugin.name);
      if (marketplacePlugin) {
        // Use marketplace plugin entirely - has correct marketplace, description, components
        // Plugin IS installed (it's in the scanned list), but may be incomplete
        const status = getInstallStatus(marketplacePlugin, true);
        return {
          ...marketplacePlugin,
          installed: true, // Always true since it was found on disk
          incomplete: status.incomplete,
        };
      }
      // Local-only plugin - no marketplace version exists
      const status = getInstallStatus(scannedPlugin, true);
      return {
        ...scannedPlugin,
        installed: true, // Always true since it was found on disk
        incomplete: status.incomplete,
      };
    });
    set({
      installedPlugins: installedWithStatus,
      marketplaces,
      tools: getToolInstances(),
      managedTools: getManagedToolRows(),
    });
  },

  loadFiles: async () => {
    // Only load files when YAML config exists
    const configPath = getYamlConfigPath();
    if (!configPath.endsWith(".yaml")) {
      set({ files: [] });
      return [];
    }

    const configResult = loadYamlConfig(configPath);
    if (configResult.errors.length > 0) {
      set({ files: [] });
      return [];
    }

    const config = configResult.config;
    const configManagementEnabled = config.settings.config_management;

    const playbooks = getAllPlaybooks();
    const toolInstances = resolveToolInstances(config, playbooks);
    const sourceRepo = config.settings.source_repo
      ? expandConfigPath(config.settings.source_repo)
      : null;

    // Back-compat: if YAML doesn't specify source_repo, infer config/assets repos
    // from the legacy config to keep relative sources working.
    const legacyConfigRepo = getConfigRepoPath();
    const legacyAssetsRepo = getAssetsRepoPath();
    const effectiveRepo = sourceRepo || legacyAssetsRepo || undefined;

    const files: FileStatus[] = [];
    const coveredTargets = new Set<string>(); // "toolId:instanceId:targetRelPath"

    // Load files from config — ALL are files, always shown.
    // tools: field just scopes which tool instances the file targets.
    // Configs come ONLY from playbook config_files (injected below).
    for (const fileEntry of config.files) {
      const fileStatus: FileStatus = {
        name: fileEntry.name,
        source: fileEntry.source,
        target: fileEntry.target,
        tools: fileEntry.tools,
        instances: [],
        kind: "file",
      };

      // Determine which tool instances this file targets
      const targetToolIds = fileEntry.tools
        ? fileEntry.tools.filter((t) => isSyncTarget(t, playbooks))
        : [...toolInstances.keys()].filter((t) => isSyncTarget(t, playbooks));

      for (const toolId of targetToolIds) {
        const instances = toolInstances.get(toolId) || [];
        for (const inst of instances) {
          if (!inst.enabled) continue;

          const instanceConfigDir = expandConfigPath(inst.config_dir);
          const targetOverride = fileEntry.overrides?.[`${toolId}:${inst.id}`];
          const targetRelPath = targetOverride || fileEntry.target;

          const sourcePath = resolveSourcePath(fileEntry.source, effectiveRepo);
          const targetPath = `${instanceConfigDir}/${targetRelPath}`;

          // Build orchestrator step and run check
          const stateKey = buildStateKey(fileEntry.name, toolId, inst.id, targetRelPath);
          const steps: OrchestratorStep[] = [{
            label: `${fileEntry.name}:${toolId}:${inst.id}`,
            module: getSyncModule(sourcePath) as any,
            params: {
              sourcePath,
              targetPath,
              owner: `file:${fileEntry.name}`,
              stateKey,
              backupRetention: config.settings.backup_retention,
            },
          }];

          const result = await runCheck(steps);
          const stepResult = result.steps[0];

          fileStatus.instances.push({
            toolId,
            instanceId: inst.id,
            instanceName: inst.name,
            configDir: instanceConfigDir,
            targetRelPath,
            sourcePath,
            targetPath,
            status: stepResult.check.status,
            message: stepResult.check.message,
            diff: stepResult.check.diff,
            driftKind: stepResult.check.driftKind,
          });
          coveredTargets.add(`${toolId}:${inst.id}:${targetRelPath}`);

          // Directory sync (target ".") covers all files in the tool's config dir,
          // including playbook-declared config_files. Mark them as covered so
          // auto-inject doesn't duplicate them.
          if (targetRelPath === ".") {
            const playbook = playbooks.get(toolId);
            if (playbook?.config_files) {
              for (const cf of playbook.config_files) {
                coveredTargets.add(`${toolId}:${inst.id}:${cf.path}`);
              }
            }
          }
        }
      }

      files.push(fileStatus);
    }

    // Load configs (tool-specific settings) only if config_management is enabled
    if (configManagementEnabled) {
      for (const configEntry of config.configs) {
        const fileStatus: FileStatus = {
          name: configEntry.name,
          source: configEntry.source,
          target: configEntry.target,
          tools: configEntry.tools,
          instances: [],
          kind: "config",
        };

        // Determine which tool instances this config targets
        const targetToolIds = configEntry.tools
          ? configEntry.tools.filter((t) => isSyncTarget(t, playbooks))
          : [...toolInstances.keys()].filter((t) => isSyncTarget(t, playbooks));

        for (const toolId of targetToolIds) {
          const instances = toolInstances.get(toolId) || [];
          for (const inst of instances) {
            if (!inst.enabled) continue;

            const instanceConfigDir = expandConfigPath(inst.config_dir);
            const targetOverride = configEntry.overrides?.[`${toolId}:${inst.id}`];
            const targetRelPath = targetOverride || configEntry.target;

            const sourcePath = resolveSourcePath(configEntry.source, effectiveRepo);
            const targetPath = `${instanceConfigDir}/${targetRelPath}`;

            // Build orchestrator step and run check
            const stateKey = buildStateKey(configEntry.name, toolId, inst.id, targetRelPath);
            const steps: OrchestratorStep[] = [{
              label: `${configEntry.name}:${toolId}:${inst.id}`,
              module: getSyncModule(sourcePath) as any,
              params: {
                sourcePath,
                targetPath,
                owner: `config:${configEntry.name}`,
                stateKey,
                backupRetention: config.settings.backup_retention,
              },
            }];

            const result = await runCheck(steps);
            const stepResult = result.steps[0];

            fileStatus.instances.push({
              toolId,
              instanceId: inst.id,
              instanceName: inst.name,
              configDir: instanceConfigDir,
              targetRelPath,
              sourcePath,
              targetPath,
              status: stepResult.check.status,
              message: stepResult.check.message,
              diff: stepResult.check.diff,
              driftKind: stepResult.check.driftKind,
            });
            coveredTargets.add(`${toolId}:${inst.id}:${targetRelPath}`);

            // Directory sync (target ".") covers all files in the tool's config dir,
            // including playbook-declared config_files. Mark them as covered so
            // auto-inject doesn't duplicate them.
            if (targetRelPath === ".") {
              const playbook = playbooks.get(toolId);
              if (playbook?.config_files) {
                for (const cf of playbook.config_files) {
                  coveredTargets.add(`${toolId}:${inst.id}:${cf.path}`);
                }
              }
            }
          }
        }

        if (fileStatus.instances.length > 0) {
          files.push(fileStatus);
        }
      }
    }

    // Auto-inject playbook-declared config files not covered by explicit entries
    // Only when config_management is enabled
    if (configManagementEnabled) {
      for (const [toolId, playbook] of playbooks) {
        if (!playbook.config_files || playbook.config_files.length === 0) continue;
        if (!isSyncTarget(toolId, playbooks)) continue;

        const instances = toolInstances.get(toolId) || [];
        const enabledInstances = instances.filter((i) => i.enabled);
        if (enabledInstances.length === 0) continue;

        for (const configFile of playbook.config_files) {
          const uncoveredInstances = enabledInstances.filter(
            (inst) => !coveredTargets.has(`${toolId}:${inst.id}:${configFile.path}`)
          );
          if (uncoveredInstances.length === 0) continue;

          const conventionalSource = `config/${toolId}/${configFile.path}`;
          const sourcePath = resolveSourcePath(conventionalSource, effectiveRepo);

          const fileStatus: FileStatus = {
            name: configFile.name,
            source: conventionalSource,
            target: configFile.path,
            tools: [toolId],
            instances: [],
            kind: "config",
          };

          for (const inst of uncoveredInstances) {
            const instanceConfigDir = expandConfigPath(inst.config_dir);
            const targetPath = `${instanceConfigDir}/${configFile.path}`;
            const stateKey = buildStateKey(configFile.name, toolId, inst.id, configFile.path);
            const steps: OrchestratorStep[] = [{
              label: `${configFile.name}:${toolId}:${inst.id}`,
              module: getSyncModule(sourcePath) as any,
              params: {
                sourcePath,
                targetPath,
                owner: `file:${configFile.name}`,
                stateKey,
                backupRetention: config.settings.backup_retention,
              },
            }];

            const result = await runCheck(steps);
            const stepResult = result.steps[0];

            fileStatus.instances.push({
              toolId,
              instanceId: inst.id,
              instanceName: inst.name,
              configDir: instanceConfigDir,
              targetRelPath: configFile.path,
              sourcePath,
              targetPath,
              status: stepResult.check.status,
              message: stepResult.check.message,
              diff: stepResult.check.diff,
              driftKind: stepResult.check.driftKind,
            });
          }

          if (fileStatus.instances.length > 0) {
            files.push(fileStatus);
          }
        }
      }
    }

    set({ files });
    return files;
  },

  refreshAll: async () => {
    await pullSourceRepo();
    await get().loadMarketplaces();
    await get().refreshToolDetection();
    await get().loadPiPackages();
    await get().loadFiles();
    get().refreshManagedTools();
  },

  installPlugin: async (plugin) => {
    const { notify, clearNotification } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    const loadingId = notify(`Installing ${plugin.name}...`, "info", { spinner: true });
    const result = await installPlugin(plugin, marketplace.url);
    clearNotification(loadingId);
    
    if (result.success) {
      await get().refreshAll();
      
      const parts: string[] = [];
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Installed ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
      } else {
        notify(`⚠ Install ran but no items linked for ${plugin.name}`, "error");
      }
    } else {
      notify(`✗ Failed to install ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  uninstallPlugin: async (plugin) => {
    const { notify, clearNotification } = get();
    const enabledInstances = getEnabledToolInstances();
    if (enabledInstances.length === 0) {
      notify("No tools enabled in config.", "error");
      return false;
    }
    const loadingId = notify(`Uninstalling ${plugin.name}...`, "info", { spinner: true });
    const success = await uninstallPlugin(plugin);
    clearNotification(loadingId);
    await get().refreshAll();
    if (success) {
      notify(`✓ Uninstalled ${plugin.name}`, "success");
    } else {
      notify(`✓ Removed ${plugin.name} from other tools`, "success");
    }
    return success;
  },

  updatePlugin: async (plugin) => {
    const { notify } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    notify(`Updating ${plugin.name}...`, "info");
    const result = await updatePlugin(plugin, marketplace.url);
    
    if (result.success) {
      await get().refreshAll();
      
      const parts: string[] = [];
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Updated ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
      } else {
        notify(`✓ Updated ${plugin.name}`, "success");
      }
    } else {
      notify(`✗ Failed to update ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  toggleToolEnabled: async (toolId, instanceId) => {
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

    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: displayName,
      configDir: currentConfigDir,
      enabled: !currentEnabled,
    });
    await get().refreshAll();
    notify(`${displayName} ${currentEnabled ? "disabled" : "enabled"}`, "success");
  },

  updateToolConfigDir: async (toolId, instanceId, configDir) => {
    const { notify } = get();
    const trimmed = configDir.trim();
    if (!trimmed) {
      notify("Config directory cannot be empty.", "error");
      return;
    }

    const configuredFromState = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const configuredTool = configuredFromState || (getToolInstances() || []).find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const managedTool = get().managedTools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: configuredTool?.name || managedTool?.displayName,
      configDir: trimmed,
      enabled: configuredTool?.enabled ?? managedTool?.enabled,
    });
    await get().refreshAll();
    notify(`Updated ${(configuredTool?.name || managedTool?.displayName) ?? `${toolId}:${instanceId}`} config_dir`, "success");
  },

  getSyncPreview: () => {
    const { plugins: installedPlugins } = getAllInstalledPlugins();
    const allMarketplacePlugins = get().marketplaces.flatMap((m) => m.plugins);

    // Use marketplace plugin for accurate component lists (skills, commands, agents)
    // Scanned plugins may have incomplete component lists if only partially installed
    const pluginsForSync = installedPlugins.map((scanned) => {
      const marketplace = allMarketplacePlugins.find((mp) => mp.name === scanned.name);
      return marketplace || scanned; // Prefer marketplace, fallback to scanned for local-only
    });

    const files = get().files;
    const toolSync = buildToolSyncPreview(get().managedTools, get().toolDetection);
    return [
      ...toolSync,
      ...buildFileSyncPreview(files),
      ...buildSyncPreview(pluginsForSync),
    ];
  },

  syncTools: async (items) => {
    const { notify } = get();
    if (items.length === 0) {
      notify("All enabled instances are in sync.", "success");
      return;
    }

    const marketplaces = get().marketplaces;
    notify(`Syncing ${items.length} items...`, "info");

    const errors: string[] = [];
    let syncedItems = 0;

    for (const item of items) {
      if (item.kind === "plugin") {
        const marketplaceUrl = marketplaces.find((m) => m.name === item.plugin.marketplace)?.url;
        const statuses = getPluginToolStatus(item.plugin)
          .filter((status) => status.enabled && status.supported && !status.installed);
        if (statuses.length === 0) continue;

        const result = await syncPluginInstances(item.plugin, marketplaceUrl, statuses);
        if (result.success) syncedItems += 1;
        errors.push(...result.errors);
      } else if (item.kind === "file") {
        // Build orchestrator steps for non-ok instances
        const configResult = loadYamlConfig();
        if (configResult.errors.length > 0) {
          errors.push(`Config load failed: ${configResult.errors[0].message}`);
          continue;
        }

        // Only forward-sync instances (skip conflicts and pullback targets)
        const steps: OrchestratorStep[] = item.file.instances
          .filter((i) => (i.status === "missing" || i.status === "drifted") && i.driftKind !== "both-changed" && i.driftKind !== "target-changed")
          .map((i) => {
            const sourcePath = i.sourcePath;
            const targetPath = i.targetPath;
            const stateKey = buildStateKey(item.file.name, i.toolId, i.instanceId, i.targetRelPath);
            return {
              label: `${item.file.name}:${i.toolId}:${i.instanceId}`,
              module: getSyncModule(sourcePath) as any,
              params: { sourcePath, targetPath, owner: `file:${item.file.name}`, stateKey, backupRetention: configResult.config.settings.backup_retention },
            };
          });

        if (steps.length > 0) {
          const result = await runApply(steps);
          if (result.summary.changed > 0) syncedItems += 1;
          for (const step of result.steps) {
            if (step.apply?.error) errors.push(step.apply.error);
          }
        }
      } else if (item.kind === "tool") {
        const success = await get().updateToolAction(item.toolId);
        if (success) {
          syncedItems += 1;
        } else {
          errors.push(`Failed to update ${item.name}`);
        }
      }
    }

    if (syncedItems > 0) {
      notify(`✓ Synced ${syncedItems} items`, "success");
    }
    if (errors.length > 0) {
      notify(`⚠ Sync completed with errors: ${errors.slice(0, 3).join("; ")}`, "error");
    }

    // Refresh state in the background — don't block the success notification
    void get().refreshAll();
  },

  addMarketplace: (name, url) => {
    const { notify } = get();
    const marketplaces = get().marketplaces;
    if (marketplaces.some((m) => m.name === name)) {
      notify(`Marketplace "${name}" already exists`, "error");
      return;
    }

    // Save to config file
    addMarketplaceToConfig(name, url);

    // Update state
    set({
      marketplaces: [
        ...marketplaces,
        {
          name,
          url,
          isLocal:
            url.startsWith("/") ||
            url.startsWith("~") ||
            url.startsWith("./") ||
            url.startsWith("../") ||
            url.startsWith("file://"),
          plugins: [],
          availableCount: 0,
          installedCount: 0,
          autoUpdate: false,
          source: "blackbook",
          enabled: true,
        },
      ],
    });
    
    notify(`Added marketplace "${name}"`, "success");
    
    // Fetch plugins for the new marketplace
    get()
      .updateMarketplace(name)
      .catch((error) => {
        notify(
          `Added marketplace "${name}" but failed to fetch plugins: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      });
  },

  removeMarketplace: (name) => {
    const { notify } = get();
    
    // Remove from config file
    removeMarketplaceFromConfig(name);
    
    // Update state
    set({
      marketplaces: get().marketplaces.filter((m) => m.name !== name),
    });
    
    notify(`Removed marketplace "${name}"`, "success");
  },

  updateMarketplace: async (name) => {
    const { notify, clearNotification } = get();
    const marketplace = get().marketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const loadingId = notify(`Updating marketplace \"${name}\"...`, "info", { spinner: true });
    try {
      const plugins = await fetchMarketplace(marketplace, { forceRefresh: true });
      const installedPlugins = get().installedPlugins;

      set({
        marketplaces: get().marketplaces.map((m) =>
          m.name === name
            ? {
                ...m,
                plugins: plugins.map((p) => ({
                  ...p,
                  installed: installedPlugins.some((ip) => ip.name === p.name),
                })),
                availableCount: plugins.length,
                installedCount: plugins.filter((p) =>
                  installedPlugins.some((ip) => ip.name === p.name)
                ).length,
                updatedAt: new Date(),
              }
            : m
        ),
      });

      notify(`Updated marketplace \"${name}\" (${plugins.length} plugin${plugins.length === 1 ? "" : "s"})`, "success");
    } catch (error) {
      notify(`Failed to update marketplace \"${name}\": ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      clearNotification(loadingId);
    }
  },

  toggleMarketplaceEnabled: async (name) => {
    const { marketplaces, notify } = get();
    const marketplace = marketplaces.find((m) => m.name === name);
    if (!marketplace) return;
    
    const newEnabled = !marketplace.enabled;
    setMarketplaceEnabled(name, newEnabled);
    notify(`${name} marketplace ${newEnabled ? "enabled" : "disabled"}`, "info");
    await get().loadMarketplaces();
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Diff view actions
  // ─────────────────────────────────────────────────────────────────────────────

  openDiffForFile: (file, instance) => {
    const driftedInstances = file.instances.filter((i) => i.status === "drifted");
    if (driftedInstances.length === 0) {
      get().notify("No drifted instances found for this file.", "warning");
      return;
    }

    const picked =
      instance
        ? driftedInstances.find(
            (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
          ) || driftedInstances[0]
        : driftedInstances[0];

    const targetInstance: DiffInstanceRef = instance || {
      toolId: picked.toolId,
      instanceId: picked.instanceId,
      instanceName: picked.instanceName,
      configDir: picked.configDir,
    };

    const diffTarget = buildFileDiffTarget(
      file.name,
      picked.targetRelPath,
      picked.sourcePath,
      picked.targetPath,
      targetInstance,
    );

    set({
      diffTarget,
      missingSummary: null,
    });
  },

  openMissingSummaryForFile: (file, instance) => {
    const missingInstances = file.instances.filter((i) => i.status === "missing");
    if (missingInstances.length === 0) {
      get().notify("No missing instances found for this file.", "warning");
      return;
    }

    const picked =
      instance
        ? missingInstances.find(
            (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
          ) || missingInstances[0]
        : missingInstances[0];

    const targetInstance: DiffInstanceRef = instance || {
      toolId: picked.toolId,
      instanceId: picked.instanceId,
      instanceName: picked.instanceName,
      configDir: picked.configDir,
    };

    const missingSummary = buildFileMissingSummary(
      file.name,
      picked.targetRelPath,
      picked.sourcePath,
      picked.targetPath,
      targetInstance,
    );

    set({
      missingSummary,
      diffTarget: null,
    });
  },

  openDiffFromSyncItem: (item) => {
    if (item.kind === "plugin") {
      get().notify("Plugins do not support drift diff.", "warning");
      return;
    }

    if (item.kind === "tool") {
      get().notify("Tool updates do not have a diff view.", "warning");
      return;
    }

    if (item.kind === "file") {
      const drifted = item.file.instances.filter((i) => i.status === "drifted");
      const missing = item.file.instances.filter((i) => i.status === "missing");

      if (drifted.length > 0) {
        get().openDiffForFile(item.file);
        return;
      }
      if (missing.length > 0) {
        get().openMissingSummaryForFile(item.file);
        return;
      }

      get().notify("No diff or missing summary available for this file.", "warning");
      return;
    }
  },

  closeDiff: () => {
    set({ diffTarget: null });
  },

  closeMissingSummary: () => {
    set({ missingSummary: null });
  },

  pullbackFileInstance: async (file, instance) => {
    const { notify } = get();
    const picked = file.instances.find(
      (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
    );
    if (!picked) {
      notify(`Unknown instance: ${instance.toolId}:${instance.instanceId}`, "error");
      return false;
    }

    try {
      const stateKey = buildStateKey(file.name, picked.toolId, picked.instanceId, picked.targetRelPath);
      const configResult = loadYamlConfig();
      const backupRetention = configResult.errors.length === 0
        ? configResult.config.settings.backup_retention
        : undefined;

      // Glob sources cannot be pulled back by swapping paths (the destination is a pattern).
      // Instead, let glob-copy interpret pullback=true as target→source.
      const isGlob = isGlobPath(picked.sourcePath);

      const step: OrchestratorStep = isGlob
        ? {
            label: `pullback:${file.name}:${picked.toolId}:${picked.instanceId}`,
            module: globCopyModule as any,
            params: {
              sourcePath: picked.sourcePath,
              targetPath: picked.targetPath,
              owner: `file:${file.name}`,
              pullback: true,
              backupRetention,
            },
          }
        : {
            label: `pullback:${file.name}:${picked.toolId}:${picked.instanceId}`,
            module: getSyncModule(picked.targetPath) as any,
            params: {
              sourcePath: picked.targetPath,
              targetPath: picked.sourcePath,
              owner: `file:${file.name}`,
              stateKey,
              pullback: true,
              backupRetention,
            },
          };

      notify(`Pulling ${file.name} from ${picked.instanceName}...`, "info");
      const result = await runApply([step]);
      const hadError = result.steps.some((s) => s.apply?.error);
      if (hadError) {
        const msg = result.steps.find((s) => s.apply?.error)?.apply?.error;
        notify(`Pull failed: ${msg || "unknown error"}`, "error");
        void get().refreshAll();
        return false;
      }

      notify(`✓ Pulled ${file.name} from ${picked.instanceName}`, "success");
      void get().refreshAll();
      return true;
    } catch (error) {
      notify(`Pull failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      void get().refreshAll();
      return false;
    }
  },
}));

let watchersStarted = false;
let refreshTimer: NodeJS.Timeout | null = null;

function scheduleRefresh(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refresh().catch((error) => {
      notify(`Failed to refresh after file change: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, 250);
}

function startFileWatchers(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (watchersStarted) return;
  watchersStarted = true;

  const configPath = getConfigPath();
  const cacheDir = getCacheDir();
  const manifestFile = manifestPath();

  try {
    if (existsSync(configPath)) {
      watch(configPath, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch config file: ${error instanceof Error ? error.message : String(error)}`, "error");
  }

  try {
    if (existsSync(cacheDir)) {
      watch(cacheDir, { persistent: false }, (event, filename) => {
        if (filename && filename.toString() === "installed_items.json") {
          scheduleRefresh(refresh, notify);
        }
      });
    } else if (existsSync(manifestFile)) {
      watch(manifestFile, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch cache directory: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

export function initializeStore(): void {
  ensureConfigExists();
  const { refreshAll, notify } = useStore.getState();
  startFileWatchers(refreshAll, notify);
}
