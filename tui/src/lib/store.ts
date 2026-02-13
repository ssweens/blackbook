import { create } from "zustand";
import { existsSync, watch } from "fs";
import type {
  Tab,
  Marketplace,
  Plugin,
  Asset,
  ConfigFile,
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
  getDriftedAssetInstances,
  getMissingAssetInstances,
  buildAssetDiffTarget,
  buildAssetMissingSummary,
  getDriftedConfigInstances,
  getMissingConfigInstances,
  buildConfigDiffTarget,
  buildConfigMissingSummary,
} from "./diff.js";
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
  getPackageManager,
} from "./config.js";
import { fetchMarketplace } from "./marketplace.js";
import { getManagedToolRows } from "./tool-view.js";
import { detectTool } from "./tool-detect.js";
import { TOOL_REGISTRY } from "./tool-registry.js";
import { installTool, uninstallTool, updateTool, type ProgressEvent } from "./tool-lifecycle.js";

import {
  getAllInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  getPluginToolStatus,
  syncPluginInstances,
  getAssetToolStatus,
  getAssetSourceInfo,
  syncAssetInstances,
  getConfigToolStatus,
  syncConfigInstances,
  getConfigSourceFiles,
  reverseSyncConfig,
  manifestPath,
} from "./install.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: () => Promise<void>;
  loadAssets: () => Asset[];
  loadConfigs: () => Promise<ConfigFile[]>;
  loadTools: () => void;
  refreshManagedTools: () => void;
  refreshToolDetection: () => Promise<void>;
  installToolAction: (toolId: string) => Promise<boolean>;
  updateToolAction: (toolId: string) => Promise<boolean>;
  uninstallToolAction: (toolId: string) => Promise<boolean>;
  cancelToolAction: () => void;
  refreshAll: () => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  setDetailPlugin: (plugin: Plugin | null) => void;
  setDetailAsset: (asset: Asset | null) => void;
  setDetailConfig: (config: ConfigFile | null) => void;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => void;
  updateMarketplace: (name: string) => Promise<void>;
  toggleMarketplaceEnabled: (name: string) => Promise<void>;
  toggleToolEnabled: (toolId: string, instanceId: string) => Promise<void>;
  updateToolConfigDir: (toolId: string, instanceId: string, configDir: string) => Promise<void>;
  getSyncPreview: () => SyncPreviewItem[];
  syncTools: (items: SyncPreviewItem[]) => Promise<void>;
  notify: (message: string, type?: Notification["type"]) => void;
  clearNotification: (id: string) => void;
  // Pi package actions
  loadPiPackages: () => Promise<void>;
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  setDetailPiPackage: (pkg: PiPackage | null) => Promise<void>;
  togglePiMarketplaceEnabled: (name: string) => Promise<void>;
  // Section navigation
  setCurrentSection: (section: DiscoverSection) => void;
  setDiscoverSubView: (subView: DiscoverSubView) => void;
  // Diff view actions
  openDiffForAsset: (asset: Asset, instance?: DiffInstanceRef) => void;
  openDiffForConfig: (config: ConfigFile, instance?: DiffInstanceRef) => void;
  openMissingSummaryForAsset: (asset: Asset, instance?: DiffInstanceRef) => void;
  openMissingSummaryForConfig: (config: ConfigFile, instance?: DiffInstanceRef) => void;
  openDiffFromSyncItem: (item: SyncPreviewItem) => void;
  reverseSyncConfig: (config: ConfigFile, instance: DiffInstanceRef) => void;
  closeDiff: () => void;
  closeMissingSummary: () => void;
  getDriftedInstances: (item: Asset | ConfigFile, kind: "asset" | "config") => DiffInstanceRef[];
  getMissingInstances: (item: Asset | ConfigFile, kind: "asset" | "config") => DiffInstanceRef[];
}

export type Store = AppState & Actions;

function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
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

export interface AssetInstallStatus {
  installed: boolean;
  incomplete?: boolean;
  drifted?: boolean;
}

function getAssetInstallStatus(
  asset: Asset,
  sourceInfo = getAssetSourceInfo(asset)
): AssetInstallStatus {
  const statuses = getAssetToolStatus(asset, sourceInfo).filter((status) => status.enabled);
  if (statuses.length === 0) {
    return { installed: false, incomplete: false, drifted: false };
  }

  const installedAny = statuses.some((status) => status.installed);
  if (!installedAny) {
    return { installed: false, incomplete: false, drifted: false };
  }

  const incomplete = statuses.some((status) => !status.installed);
  const drifted = statuses.some((status) => status.drifted);
  return { installed: true, incomplete, drifted };
}

export interface ConfigInstallStatus {
  installed: boolean;
  incomplete?: boolean;
  drifted?: boolean;
}

function getConfigInstallStatus(
  config: ConfigFile,
  sourceFiles?: ConfigFile["sourceFiles"]
): ConfigInstallStatus {
  const files = sourceFiles || [];
  const statuses = getConfigToolStatus(config, files).filter((status) => status.enabled);
  if (statuses.length === 0) {
    return { installed: false, incomplete: false, drifted: false };
  }

  const installedAny = statuses.some((status) => status.installed);
  if (!installedAny) {
    return { installed: false, incomplete: false, drifted: false };
  }

  const incomplete = statuses.some((status) => !status.installed);
  const drifted = statuses.some((status) => status.drifted);
  return { installed: true, incomplete, drifted };
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

function buildAssetSyncPreview(assets: Asset[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const asset of assets) {
    const sourceInfo = getAssetSourceInfo(asset);
    const statuses = getAssetToolStatus(asset, sourceInfo).filter((status) => status.enabled);
    if (statuses.length === 0) continue;
    const installedAny = statuses.some((status) => status.installed);
    const missingInstances = statuses
      .filter((status) => !status.installed)
      .map((status) => status.name);
    const driftedInstances = statuses
      .filter((status) => status.drifted)
      .map((status) => status.name);

    // Only show assets that are installed somewhere and need sync
    if (!installedAny) continue;
    if (missingInstances.length === 0 && driftedInstances.length === 0) continue;

    preview.push({ kind: "asset", asset, missingInstances, driftedInstances });
  }
  return preview;
}

function buildConfigSyncPreview(configs: ConfigFile[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const config of configs) {
    const files = config.sourceFiles || [];
    const statuses = getConfigToolStatus(config, files).filter((status) => status.enabled);
    if (statuses.length === 0) continue;

    const installedAny = statuses.some((status) => status.installed);
    const missing = statuses.some((status) => !status.installed);
    const drifted = statuses.some((status) => status.drifted);

    // Only show configs that are installed somewhere and need sync
    if (!installedAny) continue;
    if (!missing && !drifted) continue;

    preview.push({ kind: "config", config, drifted, missing });
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

function formatDetectedVersion(version: string | null): string {
  return version ? `v${version}` : "unknown";
}

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
  tab: "sync",
  marketplaces: [],
  installedPlugins: [],
  assets: [],
  configs: [],
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
  detailAsset: null,
  detailConfig: null,
  detailMarketplace: null,
  detailPiPackage: null,
  notifications: [],
  diffTarget: null,
  diffSourceAsset: null,
  diffSourceConfig: null,
  missingSummary: null,
  missingSummarySourceAsset: null,
  missingSummarySourceConfig: null,
  // Pi packages state
  piPackages: [],
  piMarketplaces: [],
  // Section navigation
  currentSection: "configs" as DiscoverSection,
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
            detailAsset: null,
            detailConfig: null,
            detailMarketplace: null,
          }
    ),
  setSearch: (search) => set({ search, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setDetailPlugin: (plugin) => set({ detailPlugin: plugin }),
  setDetailAsset: (asset) => set({ detailAsset: asset }),
  setDetailConfig: (config) => set({ detailConfig: config }),
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

  notify: (message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification: Notification = { id, message, type, timestamp: Date.now() };
    set((state) => ({ notifications: [...state.notifications, notification] }));
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

  installToolAction: async (toolId) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const packageManager = getPackageManager();
    const success = await installTool(
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

  updateToolAction: async (toolId) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const packageManager = getPackageManager();
    const success = await updateTool(
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
    if (success && after?.installed && after.hasUpdate && after.installedVersion === before?.installedVersion) {
      notify(
        `Update command completed but running binary is still ${formatDetectedVersion(after.installedVersion)} at ${after.binaryPath || "unknown path"} (latest ${formatDetectedVersion(after.latestVersion)}). This usually means a different installation is first in PATH.`,
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
    // Check if Pi tool is enabled before loading packages
    const tools = get().tools;
    const piEnabled = tools.some((t) => t.toolId === "pi" && t.enabled);
    if (!piEnabled) {
      set({ piPackages: [], piMarketplaces: [] });
      return;
    }

    try {
      const marketplaces = await loadAllPiMarketplaces();
      const packages = getAllPiPackages(marketplaces);
      set({ piPackages: packages, piMarketplaces: marketplaces });
    } catch (error) {
      console.error("Failed to load Pi packages:", error);
      set({ piPackages: [], piMarketplaces: [] });
    }
  },

  installPiPackage: async (pkg) => {
    const { notify } = get();
    try {
      const result = await installPiPackage(pkg);
      if (result.success) {
        notify(`Installed ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to install ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      notify(`Error installing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  uninstallPiPackage: async (pkg) => {
    const { notify } = get();
    try {
      const result = await removePiPackage(pkg);
      if (result.success) {
        notify(`Uninstalled ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to uninstall ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      notify(`Error uninstalling ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  updatePiPackage: async (pkg) => {
    const { notify } = get();
    try {
      const result = await updatePiPackage(pkg);
      if (result.success) {
        notify(`Updated ${pkg.name}`, "success");
        await get().loadPiPackages();
        return true;
      } else {
        notify(`Failed to update ${pkg.name}: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
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

  loadMarketplaces: async () => {
    set((state) => ({
      loading:
        state.marketplaces.length === 0 &&
        state.installedPlugins.length === 0 &&
        state.assets.length === 0 &&
        state.configs.length === 0,
      error: null,
    }));

    try {
      const marketplaces = parseMarketplaces();
      const { plugins: installedPlugins } = getAllInstalledPlugins();
      const assets = get().loadAssets();
      const configs = await get().loadConfigs();
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
        assets,
        configs,
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
    const assets = get().loadAssets();
    const configs = await get().loadConfigs();
    set({
      installedPlugins: installedWithStatus,
      marketplaces,
      assets,
      configs,
      tools: getToolInstances(),
      managedTools: getManagedToolRows(),
    });
  },

  loadAssets: () => {
    const config = loadConfig();
    const assets = (config.assets || []).map((asset) => {
      const sourceInfo = getAssetSourceInfo(asset);
      const status = getAssetInstallStatus(
        {
          ...asset,
          installed: false,
          scope: "user",
        },
        sourceInfo
      );
      return {
        ...asset,
        installed: status.installed,
        incomplete: status.incomplete,
        drifted: status.drifted,
        scope: "user" as const,
        sourceExists: sourceInfo.exists,
        sourceError: sourceInfo.error || null,
      };
    });

    set({ assets });
    return assets;
  },

  loadConfigs: async () => {
    const config = loadConfig();
    const configs: ConfigFile[] = [];

    for (const cfg of (config.configs || [])) {
      let sourceFiles: ConfigFile["sourceFiles"] = [];
      let sourceError: string | null = null;

      try {
        sourceFiles = await getConfigSourceFiles(cfg);
      } catch (error) {
        sourceError = error instanceof Error ? error.message : String(error);
      }

      const status = getConfigInstallStatus(
        {
          ...cfg,
          installed: false,
          scope: "user",
        },
        sourceFiles
      );

      configs.push({
        ...cfg,
        installed: status.installed,
        incomplete: status.incomplete,
        drifted: status.drifted,
        scope: "user" as const,
        sourceExists: sourceError === null && sourceFiles.length > 0,
        sourceError,
        sourceFiles,
      });
    }

    set({ configs });
    return configs;
  },

  refreshAll: async () => {
    await get().loadMarketplaces();
    await get().loadPiPackages();
    get().refreshManagedTools();
    await get().refreshToolDetection();
  },

  installPlugin: async (plugin) => {
    const { notify } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    notify(`Installing ${plugin.name}...`, "info");
    const result = await installPlugin(plugin, marketplace.url);
    
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
    const { notify } = get();
    const enabledInstances = getEnabledToolInstances();
    if (enabledInstances.length === 0) {
      notify("No tools enabled in config.", "error");
      return false;
    }
    notify(`Uninstalling ${plugin.name}...`, "info");
    const success = await uninstallPlugin(plugin);
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

    const assets = get().assets.length > 0 ? get().assets : get().loadAssets();
    const configs = get().configs;
    const toolSync = buildToolSyncPreview(get().managedTools, get().toolDetection);
    return [
      ...toolSync,
      ...buildConfigSyncPreview(configs),
      ...buildAssetSyncPreview(assets),
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
      } else if (item.kind === "asset") {
        const statuses = getAssetToolStatus(item.asset)
          .filter((status) => status.enabled && (!status.installed || status.drifted));
        if (statuses.length === 0) continue;

        const result = syncAssetInstances(item.asset, statuses);
        if (result.success) syncedItems += 1;
        errors.push(...result.errors);
      } else if (item.kind === "config") {
        const files = item.config.sourceFiles || [];
        const statuses = getConfigToolStatus(item.config, files)
          .filter((status) => status.enabled && (!status.installed || status.drifted));
        if (statuses.length === 0) continue;

        const result = await syncConfigInstances(item.config, statuses);
        if (result.success) syncedItems += 1;
        errors.push(...result.errors);
      } else if (item.kind === "tool") {
        const success = await get().updateToolAction(item.toolId);
        if (success) {
          syncedItems += 1;
        } else {
          errors.push(`Failed to update ${item.name}`);
        }
      }
    }

    await get().refreshAll();

    if (syncedItems > 0) {
      notify(`✓ Synced ${syncedItems} items`, errors.length ? "success" : "success");
    }
    if (errors.length > 0) {
      notify(`⚠ Sync completed with errors: ${errors.slice(0, 3).join("; ")}`, "error");
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
    const marketplace = get().marketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const plugins = await fetchMarketplace(marketplace);
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

  getDriftedInstances: (item, kind) => {
    if (kind === "asset") {
      return getDriftedAssetInstances(item as Asset);
    }
    return getDriftedConfigInstances(item as ConfigFile);
  },

  getMissingInstances: (item, kind) => {
    if (kind === "asset") {
      return getMissingAssetInstances(item as Asset);
    }
    return getMissingConfigInstances(item as ConfigFile);
  },

  openDiffForAsset: (asset, instance) => {
    const instances = getDriftedAssetInstances(asset);
    if (instances.length === 0) {
      get().notify("No drifted instances found for this asset.", "warning");
      return;
    }
    const targetInstance = instance || instances[0];
    const diffTarget = buildAssetDiffTarget(asset, targetInstance);
    set({
      diffTarget,
      diffSourceAsset: asset,
      diffSourceConfig: null,
      missingSummary: null,
      missingSummarySourceAsset: null,
      missingSummarySourceConfig: null,
    });
  },

  openDiffForConfig: (config, instance) => {
    const instances = getDriftedConfigInstances(config);
    if (instances.length === 0) {
      get().notify("No drifted instances found for this config.", "warning");
      return;
    }
    const targetInstance = instance || instances[0];
    const diffTarget = buildConfigDiffTarget(config, targetInstance);
    set({
      diffTarget,
      diffSourceAsset: null,
      diffSourceConfig: config,
      missingSummary: null,
      missingSummarySourceAsset: null,
      missingSummarySourceConfig: null,
    });
  },

  openMissingSummaryForAsset: (asset, instance) => {
    const instances = getMissingAssetInstances(asset);
    if (instances.length === 0) {
      get().notify("No missing instances found for this asset.", "warning");
      return;
    }
    const targetInstance = instance || instances[0];
    const missingSummary = buildAssetMissingSummary(asset, targetInstance);
    set({
      missingSummary,
      missingSummarySourceAsset: asset,
      missingSummarySourceConfig: null,
      diffTarget: null,
      diffSourceAsset: null,
      diffSourceConfig: null,
    });
  },

  openMissingSummaryForConfig: (config, instance) => {
    const instances = getMissingConfigInstances(config);
    if (instances.length === 0) {
      get().notify("No missing instances found for this config.", "warning");
      return;
    }
    const targetInstance = instance || instances[0];
    const missingSummary = buildConfigMissingSummary(config, targetInstance);
    set({
      missingSummary,
      missingSummarySourceAsset: null,
      missingSummarySourceConfig: config,
      diffTarget: null,
      diffSourceAsset: null,
      diffSourceConfig: null,
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

    if (item.kind === "asset") {
      const asset = item.asset;
      if (item.driftedInstances.length > 0) {
        get().openDiffForAsset(asset);
      } else if (item.missingInstances.length > 0) {
        get().openMissingSummaryForAsset(asset);
      } else {
        get().notify("No diff or missing summary available for this asset.", "warning");
      }
      return;
    }

    if (item.kind === "config") {
      const config = item.config;
      if (item.drifted) {
        get().openDiffForConfig(config);
      } else if (item.missing) {
        get().openMissingSummaryForConfig(config);
      } else {
        get().notify("No diff or missing summary available for this config.", "warning");
      }
    }
  },

  reverseSyncConfig: (config, instance) => {
    const { notify } = get();
    const result = reverseSyncConfig(config, instance);
    if (result.success) {
      notify(`Pulled back ${result.syncedFiles} file${result.syncedFiles === 1 ? "" : "s"} to source`, "success");
    } else {
      notify(`Pull back failed: ${result.errors.join("; ") || "no drifted files found"}`, "error");
    }
    if (result.errors.length > 0 && result.success) {
      notify(`Pull back warnings: ${result.errors.join("; ")}`, "warning");
    }
    set({ diffTarget: null, diffSourceConfig: null });
    void get().refreshAll();
  },

  closeDiff: () => {
    set({ diffTarget: null });
  },

  closeMissingSummary: () => {
    set({ missingSummary: null });
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
