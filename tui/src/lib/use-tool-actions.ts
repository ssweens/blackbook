import { useEffect, useMemo, useState } from "react";
import { type Key } from "ink";
import { useStore } from "./store.js";
import { getPackageManager } from "./config.js";
import { getToolLifecycleCommand, detectInstallMethodMismatch } from "./tool-lifecycle.js";
import { type ToolModalAction } from "../components/ToolActionModal.js";
import type { Tab, ManagedToolRow } from "./types.js";

const isBrewManagedTool = (binaryPath: string | null | undefined): boolean =>
  Boolean(binaryPath && (binaryPath.startsWith("/opt/homebrew/") || binaryPath.startsWith("/usr/local/")));

interface UseToolActionsArgs {
  tab: Tab;
  selectedIndex: number;
}

/**
 * Tool-action modal + tool shortcuts + tool detail state.
 *
 * Encapsulates everything related to install/update/uninstall/edit-config on a TOOL
 * (distinct from a plugin): the tool-action modal state machine, the tool detail
 * (detailToolKey) selection, the edit-config modal (editingToolId), the
 * install-method-mismatch warning effect, and the Tools-tab hint string.
 *
 * Pure relocation of code previously inline in App.tsx — behavior is unchanged.
 */
export function useToolActions({ tab, selectedIndex }: UseToolActionsArgs) {
  const managedTools = useStore((s) => s.managedTools);
  const toolDetection = useStore((s) => s.toolDetection);
  const toolDetectionPending = useStore((s) => s.toolDetectionPending);
  const toolActionInProgress = useStore((s) => s.toolActionInProgress);
  const toggleToolEnabled = useStore((s) => s.toggleToolEnabled);
  const updateToolConfigDir = useStore((s) => s.updateToolConfigDir);
  const installToolAction = useStore((s) => s.installToolAction);
  const updateToolAction = useStore((s) => s.updateToolAction);
  const uninstallToolAction = useStore((s) => s.uninstallToolAction);
  const cancelToolAction = useStore((s) => s.cancelToolAction);
  const refreshAll = useStore((s) => s.refreshAll);

  const [detailToolKey, setDetailToolKey] = useState<string | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolModal, setToolModal] = useState<{
    action: ToolModalAction | null; warning: string | null; migrate: boolean;
    running: boolean; done: boolean; success: boolean;
  }>({ action: null, warning: null, migrate: false, running: false, done: false, success: false });
  // Destructure for backward compat within this component
  const { action: toolModalAction, warning: toolModalWarning, migrate: toolModalMigrate,
    running: toolModalRunning, done: toolModalDone, success: toolModalSuccess } = toolModal;
  const setToolModalWarning = (v: string | null) => setToolModal((s) => ({ ...s, warning: v }));
  const setToolModalMigrate = (v: boolean | ((b: boolean) => boolean)) =>
    setToolModal((s) => ({ ...s, migrate: typeof v === "function" ? v(s.migrate) : v }));
  const setToolModalDone = (v: boolean) => setToolModal((s) => ({ ...s, done: v }));
  const resetToolModal = () => setToolModal({ action: null, warning: null, migrate: false, running: false, done: false, success: false });

  const editingTool = useMemo(() => {
    const managed = managedTools.find((tool) => `${tool.toolId}:${tool.instanceId}` === editingToolId);
    if (!managed) return null;
    return {
      toolId: managed.toolId,
      instanceId: managed.instanceId,
      name: managed.displayName,
      configDir: managed.configDir,
    };
  }, [managedTools, editingToolId]);

  const selectedManagedTool = useMemo(() => {
    if (tab !== "tools") return null;
    return managedTools[selectedIndex] || null;
  }, [tab, managedTools, selectedIndex]);

  const detailTool = useMemo(() => {
    if (!detailToolKey) return null;
    return managedTools.find((tool) => `${tool.toolId}:${tool.instanceId}` === detailToolKey) || null;
  }, [detailToolKey, managedTools]);

  const activeToolForModal = detailTool || selectedManagedTool;
  const pendingToolDetectionCount = useMemo(
    () => Object.values(toolDetectionPending).filter((isPending) => isPending).length,
    [toolDetectionPending]
  );

  useEffect(() => {
    let cancelled = false;

    if (!toolModalAction || !activeToolForModal || toolModalAction === "uninstall") {
      setToolModalWarning(null);
      return;
    }

    const packageManager = getPackageManager();
    const binaryPath = toolDetection[activeToolForModal.toolId]?.binaryPath ?? null;

    void detectInstallMethodMismatch(activeToolForModal.toolId, packageManager, binaryPath)
      .then((mismatch) => {
        if (!cancelled) {
          setToolModalWarning(mismatch?.message ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setToolModalWarning(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [toolModalAction, activeToolForModal, toolDetection]);

  const toolsHint = useMemo(() => {
    if (tab !== "tools") return undefined;
    if (toolActionInProgress) return "(Tool action running... Esc to cancel)";
    if (pendingToolDetectionCount > 0) {
      return `(Checking tool statuses... ${pendingToolDetectionCount} remaining · R refresh)`;
    }

    const supportsMigration = (detection: typeof toolDetection[string] | undefined) =>
      detection?.installed === true && isBrewManagedTool(detection.binaryPath);

    if (detailTool) {
      const detection = toolDetection[detailTool.toolId];
      if (supportsMigration(detection)) {
        return "i Install · u Update · d Uninstall · m Migrate · e Edit · Space Toggle · R Refresh · Esc Back";
      }
      return "i Install · u Update · d Uninstall · e Edit · Space Toggle · R Refresh · Esc Back";
    }

    if (!selectedManagedTool) {
      return "Enter detail · e edit · Space toggle · R refresh · q quit";
    }

    const detection = toolDetection[selectedManagedTool.toolId];
    if (!detection?.installed) {
      return "Enter detail · i Install · e Edit · Space Toggle · R refresh · q quit";
    }
    if (supportsMigration(detection)) {
      return "Enter detail · u Update · d Uninstall · m Migrate · e Edit · Space Toggle · R refresh · q quit";
    }
    if (detection.hasUpdate) {
      return "Enter detail · u Update · d Uninstall · e Edit · Space Toggle · R refresh · q quit";
    }
    return "Enter detail · d Uninstall · e Edit · Space Toggle · R refresh · q quit";
  }, [tab, toolActionInProgress, pendingToolDetectionCount, detailTool, selectedManagedTool, toolDetection]);

  const getToolActionCommand = (tool: ManagedToolRow, action: ToolModalAction): string => {
    const packageManager = getPackageManager();
    try {
      const command = getToolLifecycleCommand(tool.toolId, action, packageManager);
      if (!command) return "Unknown tool";
      return `${command.cmd} ${command.args.join(" ")}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const runToolAction = async (tool: ManagedToolRow, action: ToolModalAction, migrate = false) => {
    setToolModal((s) => ({ ...s, running: true, done: false }));
    const success =
      action === "install" ? await installToolAction(tool.toolId, { migrate })
      : action === "update" ? await updateToolAction(tool.toolId, { migrate })
      : await uninstallToolAction(tool.toolId);
    setToolModal((s) => ({ ...s, running: false, done: true, success }));
    await refreshAll({ silent: true });
  };

  const handleToolModalInput = (input: string, key: Key) => {
    if (toolModalDone) {
      if (!toolModalSuccess && (input === "m" || input === "M") && toolModalWarning) {
        setToolModalMigrate((c) => !c);
        return;
      }
      if (!toolModalSuccess && key.return && activeToolForModal) {
        setToolModalDone(false);
        void runToolAction(activeToolForModal, toolModalAction!, toolModalMigrate);
        return;
      }
      resetToolModal();
      return;
    }
    if (toolModalRunning) { if (key.escape) cancelToolAction(); return; }
    if (key.escape) { setToolModal((s) => ({ ...s, action: null, warning: null, migrate: false })); return; }
    if ((input === "m" || input === "M") && toolModalWarning) { setToolModalMigrate((c) => !c); return; }
    if (key.return && activeToolForModal) void runToolAction(activeToolForModal, toolModalAction!, toolModalMigrate);
  };

  /** Returns true if the shortcut was handled. */
  const handleToolShortcut = (input: string): boolean => {
    const tool = detailTool || managedTools[selectedIndex];
    const detection = tool ? toolDetection[tool.toolId] : null;
    const openModal = (action: "install" | "update" | "uninstall", migrate = false) =>
      setToolModal({ action, warning: null, migrate, running: false, done: false, success: false });

    if (input === "i" && tool && (!detection || !detection.installed)) { openModal("install"); return true; }
    if (input === "u" && tool && detection?.installed && detection.hasUpdate) { openModal("update"); return true; }
    if (input === "d" && tool && detection?.installed) { openModal("uninstall"); return true; }
    if (input === "m" && tool && detection?.installed) {
      const path = detection.binaryPath ?? "";
      if (isBrewManagedTool(path)) openModal("update", true);
      return true;
    }
    if (input === "e" && tool) { setEditingToolId(`${tool.toolId}:${tool.instanceId}`); return true; }
    if (input === " " && tool) { void toggleToolEnabled(tool.toolId, tool.instanceId); return true; }
    return false;
  };

  const handleToolConfigSave = (toolId: string, instanceId: string, configDir: string) => {
    void updateToolConfigDir(toolId, instanceId, configDir);
    setEditingToolId(null);
  };

  return {
    // Tool modal state (for render + useInput routing)
    toolModalAction,
    toolModalWarning,
    toolModalMigrate,
    toolModalRunning,
    toolModalDone,
    toolModalSuccess,
    // Tool detail / edit-config state
    detailTool,
    detailToolKey,
    setDetailToolKey,
    editingToolId,
    setEditingToolId,
    editingTool,
    selectedManagedTool,
    activeToolForModal,
    // Derived hint
    toolsHint,
    // Handlers
    handleToolModalInput,
    handleToolShortcut,
    handleToolConfigSave,
    runToolAction,
    getToolActionCommand,
  };
}
