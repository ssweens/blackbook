import { create } from "zustand";
import { existsSync, lstatSync, statSync, watch } from "fs";

/**
 * Yield to the event loop so Ink can process keyboard input between
 * synchronous filesystem checks. Without this, tight loops of fs.existsSync
 * and fs.readFileSync block the event loop for hundreds of milliseconds,
 * making the TUI feel frozen.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
import { fetchMarketplace, loadAllPiMarketplaces, getAllPiPackages, loadPiSettings, isPackageInstalled, fetchNpmPackageDetails, getGlobalPiPackageInstallInfo } from "./marketplace.js";
import { installPiPackage, removePiPackage, updatePiPackage, repairPiPackageManager } from "./pi-install.js";
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
import { pullSourceRepo, primeSourceRepoStatus, clearSourceStatusCache } from "./source-setup.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "./config/playbooks.js";
import { runCheck, runApply } from "./modules/orchestrator.js";
import { fileCopyModule } from "./modules/file-copy.js";
import { directorySyncModule } from "./modules/directory-sync.js";
import { globCopyModule } from "./modules/glob-copy.js";
import { buildFileDiffTarget, buildFileMissingSummary } from "./diff.js";
import { buildStateKey } from "./state.js";
import type { OrchestratorStep } from "./modules/orchestrator.js";
import { getManagedToolRows } from "./tool-view.js";
import { detectTool } from "./tool-detect.js";
import { TOOL_REGISTRY, getToolRegistryEntry } from "./tool-registry.js";
import { installTool, uninstallTool, updateTool, reinstallTool, detectInstallMethodMismatch, detectInstallMethodFromPath, type ProgressEvent } from "./tool-lifecycle.js";

import {
  getAllInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  getPluginToolStatus,
  syncPluginInstances,
  manifestPath,
} from "./install.js";
import { invalidatePluginToolStatusCache } from "./plugin-status.js";
import type { PluginDrift } from "./plugin-drift.js";
import { countStoreUpdate } from "./perf.js";
import { filesToManagedItems, piPackagesToManagedItems, pluginsToManagedItems } from "./managed-item.js";
import type { ManagedItem } from "./managed-item.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: (options?: { silent?: boolean }) => Promise<void>;
  loadFiles: (options?: { silent?: boolean }) => Promise<FileStatus[]>;
  loadTools: () => void;
  refreshManagedTools: () => void;
  refreshToolDetection: () => Promise<void>;
  installToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  updateToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  uninstallToolAction: (toolId: string) => Promise<boolean>;
  cancelToolAction: () => void;
  refreshAll: (options?: { silent?: boolean }) => Promise<void>;
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
  loadPiPackages: (options?: { silent?: boolean }) => Promise<void>;
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  repairPiPackage: (pkg: PiPackage) => Promise<boolean>;
  setDetailPiPackage: (pkg: PiPackage | null) => Promise<void>;
  togglePiMarketplaceEnabled: (name: string) => Promise<void>;
  addPiMarketplace: (name: string, source: string) => Promise<void>;
  removePiMarketplace: (name: string) => Promise<void>;
  // Section navigation
  setSortBy: (by: AppState["sortBy"]) => void;
  setSortDir: (dir: AppState["sortDir"]) => void;
  setCurrentSection: (section: DiscoverSection) => void;
  setDiscoverSubView: (subView: DiscoverSubView) => void;
  toggleSyncSelection: (key: string) => void;
  setSyncArmed: (armed: boolean) => void;
  setPluginDriftMap: (map: Record<string, PluginDrift>) => void;
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

function composeManagedItems(
  installedPlugins: Plugin[],
  files: FileStatus[],
  piPackages: PiPackage[],
): ManagedItem[] {
  return [
    ...pluginsToManagedItems(installedPlugins),
    ...filesToManagedItems(files),
    ...piPackagesToManagedItems(piPackages),
  ];
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

/** Run fn with a spinner notification, clear it on completion. Returns fn's result. */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  notifyFn: Store["notify"],
  clearFn: Store["clearNotification"],
): Promise<T> {
  const id = notifyFn(message, "info", { spinner: true });
  try {
    return await fn();
  } finally {
    clearFn(id);
  }
}

export const useStore = create<Store>((rawSet, get) => {
  const set: typeof rawSet = (arg) => {
    countStoreUpdate();
    return rawSet(arg as any);
  };
  return {
  tab: "installed",
  marketplaces: [],
  installedPlugins: [],
  installedPluginsLoaded: false,
  files: [],
  filesLoaded: false,
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
  piPackagesLoaded: false,
  piMarketplaces: [],
  managedItems: [],
  // Sort state
  sortBy: "default" as AppState["sortBy"],
  sortDir: "asc" as AppState["sortDir"],
  // Sync tab state
  syncSelection: [] as string[],
  syncArmed: false,
  // Plugin drift cache
  pluginDriftMap: {} as Record<string, PluginDrift>,
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
  setSortBy: (by) => set({ sortBy: by }),
  setSortDir: (dir) => set({ sortDir: dir }),
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
  toggleSyncSelection: (key: string) =>
    set((state) => {
      const has = state.syncSelection.includes(key);
      const next = has
        ? state.syncSelection.filter((k) => k !== key)
        : [...state.syncSelection, key];
      return { syncSelection: next, syncArmed: false };
    }),
  setSyncArmed: (armed: boolean) => set({ syncArmed: armed }),
  setPluginDriftMap: (map) => set({ pluginDriftMap: map }),

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

  loadPiPackages: async (options) => {
    const silent = options?.silent === true;
    if (!silent) set({ piPackagesLoaded: false });

    // Load Pi packages only when Pi is enabled in config or detected as installed.
    const tools = get().tools;
    const piEnabled = tools.some((t) => t.toolId === "pi" && t.enabled);
    const piInstalled = get().toolDetection.pi?.installed === true;
    if (!piEnabled && !piInstalled) {
      const state = get();
      set({
        piPackages: [],
        piPackagesLoaded: true,
        piMarketplaces: [],
        managedItems: composeManagedItems(state.installedPlugins, state.files, []),
      });
      return;
    }

    try {
      const marketplaces = await loadAllPiMarketplaces();
      const preferredManager = getPackageManager();
      let packages: PiPackage[] = getAllPiPackages(marketplaces).map((pkg) => ({ ...pkg, preferredManager }));

      // Add installed npm packages that aren't in any marketplace
      const settings = loadPiSettings();
      const existingSources = new Set(packages.map((p) => p.source.toLowerCase()));
      const installInfo = getGlobalPiPackageInstallInfo();

      for (const source of settings.packages) {
        if (existingSources.has(source.toLowerCase())) continue;
        if (!source.startsWith("npm:")) continue;

        // Fetch package details from npm
        const pkgName = source.slice(4);
        const details = await fetchNpmPackageDetails(pkgName);
        if (!details) continue;

        const detected = installInfo.get(pkgName);
        const installedVersion = detected?.version ?? undefined;
        const latestVersion = details.version ?? "0.0.0";
        const pkg: PiPackage = {
          name: details.name ?? pkgName,
          description: details.description ?? "",
          version: latestVersion,
          source,
          sourceType: "npm",
          marketplace: "npm",
          installed: true,
          installedVersion,
          hasUpdate: Boolean(installedVersion && installedVersion !== latestVersion),
          installedVia: detected?.via,
          installedViaManagers: detected?.viaManagers,
          managerMismatch: Boolean(detected?.managerMismatch),
          preferredManager,
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

      const state = get();
      set({
        piPackages: packages,
        piPackagesLoaded: true,
        piMarketplaces: marketplaces,
        managedItems: composeManagedItems(state.installedPlugins, state.files, packages),
      });
    } catch (error) {
      console.error("Failed to load Pi packages:", error);
      const state = get();
      set({
        piPackages: [],
        piPackagesLoaded: true,
        piMarketplaces: [],
        managedItems: composeManagedItems(state.installedPlugins, state.files, []),
      });
    }
  },

  installPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const result = await withSpinner(`Installing ${pkg.name}...`, () => installPiPackage(pkg), notify, clearNotification);
      if (result.success) { notify(`Installed ${pkg.name}`, "success"); await get().loadPiPackages({ silent: true }); return true; }
      notify(`Failed to install ${pkg.name}: ${result.error}`, "error");
    } catch (error) { notify(`Error installing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  uninstallPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const result = await withSpinner(`Uninstalling ${pkg.name}...`, () => removePiPackage(pkg), notify, clearNotification);
      if (result.success) { notify(`Uninstalled ${pkg.name}`, "success"); await get().loadPiPackages({ silent: true }); return true; }
      notify(`Failed to uninstall ${pkg.name}: ${result.error}`, "error");
    } catch (error) { notify(`Error uninstalling ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  updatePiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const beforeInstalledVersion = pkg.installedVersion;
      const result = await withSpinner(`Updating ${pkg.name}...`, () => updatePiPackage(pkg), notify, clearNotification);
      if (!result.success) {
        notify(`Failed to update ${pkg.name}: ${result.error}`, "error");
        return false;
      }

      await get().loadPiPackages({ silent: true });

      const refreshed = get().piPackages.find((p) =>
        p.source === pkg.source ||
        (p.name === pkg.name && p.marketplace === pkg.marketplace)
      );

      if (!refreshed) {
        notify(`Update command completed for ${pkg.name}, but refreshed package status could not be found.`, "warning");
        return false;
      }

      // For npm packages, verify effective update after refresh instead of trusting exit code.
      if (refreshed.sourceType === "npm") {
        const versionChanged = Boolean(beforeInstalledVersion && refreshed.installedVersion && refreshed.installedVersion !== beforeInstalledVersion);
        const updateCleared = refreshed.hasUpdate === false;
        if (!versionChanged && !updateCleared) {
          notify(
            `Update command completed for ${pkg.name}, but it still appears out of date (installed ${refreshed.installedVersion || "unknown"}, latest ${refreshed.version || "unknown"}).`,
            "warning"
          );
          return false;
        }
      }

      const from = beforeInstalledVersion || "unknown";
      const to = refreshed.installedVersion || refreshed.version || "unknown";
      notify(`Updated ${pkg.name} (${from} → ${to})`, "success");
      return true;
    } catch (error) { notify(`Error updating ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  repairPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    const preferred = getPackageManager();
    const from = pkg.installedVia;

    if (pkg.sourceType !== "npm") {
      notify(`Repair is only supported for npm packages (${pkg.name})`, "warning");
      return false;
    }
    if (!from) {
      notify(`Couldn't determine current install manager for ${pkg.name}`, "warning");
      return false;
    }

    try {
      const result = await withSpinner(
        `Repairing ${pkg.name} (${from} → ${preferred})...`,
        () => repairPiPackageManager(pkg, { from, to: preferred }),
        notify,
        clearNotification,
      );
      if (!result.success) {
        notify(`Failed to repair ${pkg.name}: ${result.error}`, "error");
        return false;
      }

      await get().loadPiPackages({ silent: true });
      const refreshed = get().piPackages.find((p) =>
        p.source === pkg.source ||
        (p.name === pkg.name && p.marketplace === pkg.marketplace)
      );
      if (!refreshed) {
        notify(`Repaired ${pkg.name}, but refreshed package status could not be found.`, "warning");
        return false;
      }

      if (refreshed.managerMismatch) {
        notify(`Repair completed for ${pkg.name}, but install manager mismatch remains.`, "warning");
        return false;
      }

      notify(`Repaired ${pkg.name} (${from} → ${preferred})`, "success");
      return true;
    } catch (error) {
      notify(`Error repairing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
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
    invalidatePluginToolStatusCache();
    set((state) => ({
      loading:
        state.marketplaces.length === 0 &&
        state.installedPlugins.length === 0,
      error: null,
    }));

    try {
      const marketplaces = parseMarketplaces();
      const tools = getToolInstances();

      // STEP 1: Fetch all marketplaces FIRST (get plugin metadata with skill names)
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

          return {
            ...m,
            plugins: plugins.map((p) => ({
              ...p,
              installed: false, // Will be updated after scanning
            })),
            availableCount: plugins.length,
            installedCount: 0, // Will be updated after scanning
            updatedAt: new Date(),
          };
        })
      );

      // STEP 2: Extract all marketplace plugins for skill matching
      const allMarketplacePlugins = enrichedMarketplaces.flatMap((m) => m.plugins);

      // STEP 3: Scan installed skills, passing marketplace data for grouping
      const { plugins: installedPlugins } = getAllInstalledPlugins(allMarketplacePlugins);

      // STEP 4: Update marketplace installed counts and status
      const updatedMarketplaces = enrichedMarketplaces.map((m) => ({
        ...m,
        plugins: m.plugins.map((p) => ({
          ...p,
          ...getInstallStatus(p, installedPlugins.some((ip) => ip.name === p.name)),
        })),
        installedCount: m.plugins.filter((p) =>
          installedPlugins.some((ip) => ip.name === p.name)
        ).length,
      }));

      // STEP 5: Merge marketplace metadata with scanned plugins
      const installedWithStatus = installedPlugins.map((scannedPlugin) => {
        const marketplacePlugin = allMarketplacePlugins.find((mp) => mp.name === scannedPlugin.name);
        if (marketplacePlugin) {
          // Merge marketplace metadata with actually-installed components
          const status = getInstallStatus(marketplacePlugin, true);
          return {
            ...marketplacePlugin,
            // Override with actually-installed components from scan
            skills: scannedPlugin.skills,
            commands: scannedPlugin.commands,
            agents: scannedPlugin.agents,
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

      const state = get();
      set({
        marketplaces: updatedMarketplaces,
        installedPlugins: installedWithStatus,
        installedPluginsLoaded: true,
        tools,
        managedTools: getManagedToolRows(),
        managedItems: composeManagedItems(installedWithStatus, state.files, state.piPackages),
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadInstalledPlugins: async (options) => {
    invalidatePluginToolStatusCache();
    const silent = options?.silent === true;
    if (!silent) set({ installedPluginsLoaded: false });

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
    // (marketplace, description), use marketplace plugin.
    // But use scanned skills/commands/agents to show what's actually installed on disk.
    const allMarketplacePlugins = marketplaces.flatMap((m) => m.plugins);
    const installedWithStatus = installed.map((scannedPlugin) => {
      const marketplacePlugin = allMarketplacePlugins.find((mp) => mp.name === scannedPlugin.name);
      if (marketplacePlugin) {
        // Merge marketplace metadata with actually-installed components
        const status = getInstallStatus(marketplacePlugin, true);
        return {
          ...marketplacePlugin,
          // Override with actually-installed components from scan
          skills: scannedPlugin.skills,
          commands: scannedPlugin.commands,
          agents: scannedPlugin.agents,
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
    const state = get();
    set({
      installedPlugins: installedWithStatus,
      installedPluginsLoaded: true,
      marketplaces,
      tools: getToolInstances(),
      managedTools: getManagedToolRows(),
      managedItems: composeManagedItems(installedWithStatus, state.files, state.piPackages),
    });
  },

  loadFiles: async (options) => {
    const silent = options?.silent === true;
    if (!silent) set({ filesLoaded: false });

    // Only load files when YAML config exists
    const configPath = getYamlConfigPath();
    if (!configPath || !configPath.endsWith(".yaml")) {
      const state = get();
      set({
        files: [],
        filesLoaded: true,
        managedItems: composeManagedItems(state.installedPlugins, [], state.piPackages),
      });
      return [];
    }

    const configResult = loadYamlConfig(configPath);
    if (configResult.errors.length > 0) {
      const state = get();
      set({
        files: [],
        filesLoaded: true,
        managedItems: composeManagedItems(state.installedPlugins, [], state.piPackages),
      });
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
    let checkCounter = 0;

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

          checkCounter++;
          if (checkCounter % 5 === 0) await yieldToEventLoop();

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

            checkCounter++;
            if (checkCounter % 5 === 0) await yieldToEventLoop();

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

            checkCounter++;
            if (checkCounter % 5 === 0) await yieldToEventLoop();

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

    const state = get();
    set({
      files,
      filesLoaded: true,
      managedItems: composeManagedItems(state.installedPlugins, files, state.piPackages),
    });
    return files;
  },

  refreshAll: async (options) => {
    invalidatePluginToolStatusCache();
    const silent = options?.silent === true;
    clearSourceStatusCache();
    await get().loadMarketplaces();
    await get().refreshToolDetection();
    await get().loadPiPackages({ silent });
    await get().loadFiles({ silent });
    get().refreshManagedTools();
  },

  installPlugin: async (plugin) => {
    invalidatePluginToolStatusCache();
    const { notify, clearNotification } = get();
    const marketplace = get().marketplaces.find((m) => m.name === plugin.marketplace);
    if (!marketplace) { notify(`Marketplace not found for ${plugin.name}`, "error"); return false; }
    const result = await withSpinner(`Installing ${plugin.name}...`,
      () => installPlugin(plugin, marketplace.url), notify, clearNotification);
    
    if (result.success) {
      await get().refreshAll({ silent: true });
      
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
    invalidatePluginToolStatusCache();
    const { notify, clearNotification } = get();
    const enabledInstances = getEnabledToolInstances();
    if (enabledInstances.length === 0) { notify("No tools enabled in config.", "error"); return false; }
    const success = await withSpinner(`Uninstalling ${plugin.name}...`, () => uninstallPlugin(plugin), notify, clearNotification);
    await get().refreshAll({ silent: true });
    notify(success ? `✓ Uninstalled ${plugin.name}` : `✓ Removed ${plugin.name} from other tools`, "success");
    return success;
  },

  updatePlugin: async (plugin) => {
    invalidatePluginToolStatusCache();
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
      await get().refreshAll({ silent: true });
      
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

    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: displayName,
      configDir: currentConfigDir,
      enabled: !currentEnabled,
    });
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
    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: configuredTool?.name || managedTool?.displayName,
      configDir: trimmed,
      enabled: configuredTool?.enabled ?? managedTool?.enabled,
    });
    await get().refreshAll({ silent: true });
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
    invalidatePluginToolStatusCache();
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

        // Only forward-sync instances (skip conflicts and pullback targets unless forceBothChanged)
        const forceBothChanged = item.forceBothChanged ?? false;
        const steps: OrchestratorStep[] = item.file.instances
          .filter((i) => {
            if (i.status !== "missing" && i.status !== "drifted") return false;
            // Allow both-changed instances when forceBothChanged is true
            if (i.driftKind === "both-changed" && forceBothChanged) return true;
            // Skip both-changed and target-changed by default (conflicts and pullback targets)
            if (i.driftKind === "both-changed" || i.driftKind === "target-changed") return false;
            return true;
          })
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

    // Refresh only what's needed - files for file syncs, plugins for plugin syncs
    // Don't do a full refreshAll which is slow
    const hadFiles = items.some((item) => item.kind === "file");
    const hadPlugins = items.some((item) => item.kind === "plugin");
    if (hadFiles) {
      void get().loadFiles({ silent: true });
    }
    if (hadPlugins) {
      void get().loadInstalledPlugins({ silent: true });
    }
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
        void get().refreshAll({ silent: true });
        return false;
      }

      notify(`✓ Pulled ${file.name} from ${picked.instanceName}`, "success");
      void get().refreshAll({ silent: true });
      return true;
    } catch (error) {
      notify(`Pull failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      void get().refreshAll({ silent: true });
      return false;
    }
  },
  };
});

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
  // No dynamic background refreshes; updates are startup + manual refresh only.
  // Check source repo for updates at launch (silently no-ops if not configured/offline)
  void pullSourceRepo();
  // Prime source repo status cache during startup so Settings tab renders immediately.
  void primeSourceRepoStatus();
}
