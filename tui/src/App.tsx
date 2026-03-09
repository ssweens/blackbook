import React, { useEffect, useState, useMemo, useRef } from "react";
import { join } from "path";
import { existsSync } from "fs";
import { Box, Text, useInput, useApp } from "ink";
import { useStore, withSpinner } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginPreview } from "./components/PluginPreview.js";
import { buildItemActions, getPiPackageActions } from "./lib/item-actions.js";
import { MarketplaceList } from "./components/MarketplaceList.js";
import { MarketplaceDetailView } from "./components/MarketplaceDetailView.js";
import { AddMarketplaceModal } from "./components/AddMarketplaceModal.js";
import { SourceSetupWizard } from "./components/SourceSetupWizard.js";
import { EditToolModal } from "./components/EditToolModal.js";
import { ToolsList } from "./components/ToolsList.js";
import { ToolDetail } from "./components/ToolDetail.js";
import { ToolActionModal, type ToolModalAction } from "./components/ToolActionModal.js";
import { SyncList } from "./components/SyncList.js";
import { SyncPreview } from "./components/SyncPreview.js";
import { FilePreview } from "./components/FilePreview.js";

import { HintBar } from "./components/HintBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Notifications } from "./components/Notifications.js";
import { DiffView } from "./components/DiffView.js";
import { MissingSummaryView } from "./components/MissingSummary.js";
import { PluginSummary } from "./components/PluginSummary.js";
import { PiPackageSummary } from "./components/PiPackageSummary.js";
import { PiPackagePreview } from "./components/PiPackagePreview.js";
// PiPackageDetail actions built via toPiPkgItemActions in lib/item-actions.ts
import { ComponentManager, getComponentItems } from "./components/ComponentManager.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { getPluginToolStatus, togglePluginComponent } from "./lib/plugin-status.js";
import { syncPluginInstances, uninstallPluginFromInstance } from "./lib/install.js";
import { resolvePluginSourcePaths, type PluginDrift } from "./lib/plugin-drift.js";
import { computeItemDrift } from "./lib/item-drift.js";
import { buildFileDiffTarget } from "./lib/diff.js";
import { getToolLifecycleCommand, detectInstallMethodMismatch } from "./lib/tool-lifecycle.js";
import { getPackageManager } from "./lib/config.js";
import { setupSourceRepository, shouldShowSourceSetupWizard } from "./lib/source-setup.js";
import { ItemList, FILE_COLUMNS, PLUGIN_COLUMNS } from "./components/ItemList.js";
import { ItemDetail, PluginMetadata, FileMetadata, PiPackageMetadata, type ItemAction } from "./components/ItemDetail.js";
import { pluginToManagedItem, fileToManagedItem, piPackageToManagedItem } from "./lib/managed-item.js";
import type { ManagedItem } from "./lib/managed-item.js";
import { getMarketplaceDetailActions, type MarketplaceDetailContext } from "./lib/marketplace-detail.js";
import { buildMarketplaceRows, type MarketplaceRow } from "./lib/marketplace-row.js";
import { useDetailInput, useDiffInput, useListInput } from "./lib/input-hooks.js";
import { handleItemAction } from "./lib/action-dispatch.js";
import type { Tab, SyncPreviewItem, Plugin, PiPackage, PiMarketplace, DiffInstanceRef, DiscoverSection, DiscoverSubView, ManagedToolRow, FileStatus, Marketplace } from "./lib/types.js";

const TABS: Tab[] = ["sync", "tools", "discover", "installed", "marketplaces", "settings"];
const TAB_REFRESH_TTL_MS = 30000;

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    managedItems,
    installedPlugins: legacyInstalledPlugins,
    installedPluginsLoaded,
    files: legacyFiles,
    tools,
    managedTools,
    toolDetection,
    toolDetectionPending,
    toolActionInProgress,
    toolActionOutput,
    search,
    setSearch,
    selectedIndex,
    setSelectedIndex,
    loading,
    error,
    detailPlugin,
    detailMarketplace,
    setDetailPlugin,
    setDetailMarketplace,
    loadMarketplaces,
    loadInstalledPlugins,
    loadFiles,
    refreshManagedTools,
    refreshToolDetection,
    installPlugin: doInstall,
    uninstallPlugin: doUninstall,
    updatePlugin: doUpdate,
    updateMarketplace,
    toggleMarketplaceEnabled,
    removeMarketplace,
    addMarketplace,
    toggleToolEnabled,
    updateToolConfigDir,
    installToolAction,
    updateToolAction,
    uninstallToolAction,
    cancelToolAction,
    getSyncPreview,
    syncTools,
    notify,
    notifications,
    clearNotification,
    // Diff view
    diffTarget,
    missingSummary,
    openDiffForFile,
    openMissingSummaryForFile,
    openDiffFromSyncItem,
    closeDiff,
    closeMissingSummary,
    pullbackFileInstance,
    // Pi packages
    piPackages: legacyPiPackages,
    piPackagesLoaded,
    piMarketplaces,
    detailPiPackage,
    setDetailPiPackage,
    loadPiPackages,
    refreshAll,
    installPiPackage: doInstallPiPkg,
    uninstallPiPackage: doUninstallPiPkg,
    updatePiPackage: doUpdatePiPkg,
    togglePiMarketplaceEnabled,
    addPiMarketplace,
    removePiMarketplace,
    // Section navigation
    currentSection,
    setCurrentSection,
    discoverSubView,
    setDiscoverSubView,
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [componentManagerMode, setComponentManagerMode] = useState(false);
  const [componentIndex, setComponentIndex] = useState(0);
  const [detailPluginDrift, setDetailPluginDrift] = useState<PluginDrift | null>(null);
  const [pluginDriftMap, setPluginDriftMap] = useState<Record<string, PluginDrift>>({});
  const [detailFile, setDetailFile] = useState<FileStatus | null>(null);
  const [detailPiMarketplace, setDetailPiMarketplace] = useState<PiMarketplace | null>(null);
  const [detailToolKey, setDetailToolKey] = useState<string | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState<"addMarketplace" | "addPiMarketplace" | "sourceSetupWizard" | null>(null);
  const showAddMarketplace = modalVisible === "addMarketplace";
  const showAddPiMarketplace = modalVisible === "addPiMarketplace";
  const showSourceSetupWizard = modalVisible === "sourceSetupWizard";
  const setShowAddMarketplace = (v: boolean) => setModalVisible(v ? "addMarketplace" : null);
  const setShowAddPiMarketplace = (v: boolean) => setModalVisible(v ? "addPiMarketplace" : null);
  const setShowSourceSetupWizard = (v: boolean) => setModalVisible(v ? "sourceSetupWizard" : null);
  const [toolModal, setToolModal] = useState<{
    action: ToolModalAction | null; warning: string | null; migrate: boolean;
    running: boolean; done: boolean; success: boolean;
  }>({ action: null, warning: null, migrate: false, running: false, done: false, success: false });
  // Destructure for backward compat within this component
  const { action: toolModalAction, warning: toolModalWarning, migrate: toolModalMigrate,
    running: toolModalRunning, done: toolModalDone, success: toolModalSuccess } = toolModal;
  const setToolModalAction = (v: ToolModalAction | null) => setToolModal((s) => ({ ...s, action: v }));
  const setToolModalWarning = (v: string | null) => setToolModal((s) => ({ ...s, warning: v }));
  const setToolModalMigrate = (v: boolean | ((b: boolean) => boolean)) =>
    setToolModal((s) => ({ ...s, migrate: typeof v === "function" ? v(s.migrate) : v }));
  const setToolModalRunning = (v: boolean) => setToolModal((s) => ({ ...s, running: v }));
  const setToolModalDone = (v: boolean) => setToolModal((s) => ({ ...s, done: v }));
  const setToolModalSuccess = (v: boolean) => setToolModal((s) => ({ ...s, success: v }));
  const resetToolModal = () => setToolModal({ action: null, warning: null, migrate: false, running: false, done: false, success: false });
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[]>([]);
  const [syncSelection, setSyncSelection] = useState<Set<string>>(new Set());
  const [syncArmed, setSyncArmed] = useState(false);
  const [sort, setSort] = useState<{ by: "default" | "name" | "installed" | "popularity"; dir: "asc" | "desc" }>({ by: "default", dir: "asc" });
  const sortBy = sort.by; const sortDir = sort.dir;
  const setSortBy = (v: typeof sortBy | ((p: typeof sortBy) => typeof sortBy)) =>
    setSort((s) => ({ ...s, by: typeof v === "function" ? v(s.by) : v }));
  const setSortDir = (v: typeof sortDir | ((p: typeof sortDir) => typeof sortDir)) =>
    setSort((s) => ({ ...s, dir: typeof v === "function" ? v(s.dir) : v }));
  const [searchFocused, setSearchFocused] = useState(false);
  const [subViewIndex, setSubViewIndex] = useState(0);
  const [marketplaceBrowseContext, setMarketplaceBrowseContext] = useState<Marketplace | null>(null);
  const [tabRefreshInProgress, setTabRefreshInProgress] = useState(false);
  const tabRefreshCounterRef = useRef(0);
  const lastTabRefreshRef = useRef<Record<Tab, number>>({
    sync: 0,
    tools: 0,
    discover: 0,
    installed: 0,
    marketplaces: 0,
    settings: 0,
  });
  const tabRefreshInFlightRef = useRef<Record<Tab, boolean>>({
    sync: false,
    tools: false,
    discover: false,
    installed: false,
    marketplaces: false,
    settings: false,
  });

  // Refs to break the feedback loop in the sync preview useEffect.
  // These values are read inside the effect but must NOT be deps,
  // because the effect itself sets them — listing them as deps
  // causes infinite re-renders during incremental toolDetection updates.
  const syncPreviewRef = useRef(syncPreview);
  syncPreviewRef.current = syncPreview;
  const syncArmedRef = useRef(syncArmed);
  syncArmedRef.current = syncArmed;

  const getSyncItemKey = (item: SyncPreviewItem) => {
    if (item.kind === "plugin") {
      return `plugin:${item.plugin.marketplace}:${item.plugin.name}`;
    }
    if (item.kind === "tool") {
      return `tool:${item.toolId}`;
    }
    return `file:${item.file.name}`;
  };

  const installedPlugins = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _plugin: Plugin } => item.kind === "plugin" && !!item._plugin)
      .map((item) => item._plugin);
    return fromManaged.length > 0 ? fromManaged : legacyInstalledPlugins;
  }, [managedItems, legacyInstalledPlugins]);

  const files = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _file: FileStatus } =>
        (item.kind === "file" || item.kind === "config" || item.kind === "asset") && !!item._file)
      .map((item) => item._file);
    return fromManaged.length > 0 ? fromManaged : legacyFiles;
  }, [managedItems, legacyFiles]);

  const piPackages = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _piPackage: PiPackage } => item.kind === "pi-package" && !!item._piPackage)
      .map((item) => item._piPackage);
    return fromManaged.length > 0 ? fromManaged : legacyPiPackages;
  }, [managedItems, legacyPiPackages]);

  const toFileSyncItem = (file: typeof files[number]): SyncPreviewItem => {
    const missingInstances = file.instances
      .filter((i) => i.status === "missing")
      .map((i) => i.instanceName);
    const driftedInstances = file.instances
      .filter((i) => i.status === "drifted")
      .map((i) => i.instanceName);
    return { kind: "file", file, missingInstances, driftedInstances };
  };

  const enabledToolNames = useMemo(
    () => tools.filter((tool) => tool.enabled).map((tool) => tool.name),
    [tools]
  );

  const isBrewManagedTool = (binaryPath: string | null | undefined): boolean =>
    Boolean(binaryPath && (binaryPath.startsWith("/opt/homebrew/") || binaryPath.startsWith("/usr/local/")));

  const showPiFeatures = useMemo(() => {
    const piEnabled = tools.some((tool) => tool.toolId === "pi" && tool.enabled);
    const piInstalled = toolDetection.pi?.installed === true;
    return piEnabled || piInstalled;
  }, [tools, toolDetection]);

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

  // Helper to calculate visible range for section headings
  const getRange = (selectedIdx: number, totalCount: number, maxHeight: number): string => {
    if (totalCount === 0) return "";
    if (totalCount <= maxHeight) return `(${totalCount})`;
    
    const effectiveIndex = selectedIdx >= 0 ? selectedIdx : 0;
    const maxStart = Math.max(0, totalCount - maxHeight);
    const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);
    const end = Math.min(start + maxHeight, totalCount);
    
    return `(showing ${start + 1}-${end} of ${totalCount})`;
  };

  const refreshTabData = async (targetTab: Tab, options?: { force?: boolean }) => {
    const force = options?.force === true;
    const now = Date.now();

    if (tabRefreshInFlightRef.current[targetTab]) {
      return;
    }

    if (!force) {
      const lastRefresh = lastTabRefreshRef.current[targetTab];
      if (now - lastRefresh < TAB_REFRESH_TTL_MS) {
        return;
      }
    }

    tabRefreshInFlightRef.current[targetTab] = true;
    tabRefreshCounterRef.current += 1;
    setTabRefreshInProgress(true);

    let refreshed = false;
    try {
      switch (targetTab) {
        case "settings":
          await refreshAll();
          break;
        case "discover":
        case "marketplaces": await Promise.all([loadMarketplaces(), loadPiPackages()]); break;
        case "installed":
          await Promise.all([loadInstalledPlugins(), loadPiPackages()]);
          void loadFiles(); // background — Installed stays responsive
          break;
        case "tools":
          refreshManagedTools();
          await refreshToolDetection();
          break;
        case "sync":
        default:
          // Sync: refresh only sync-relevant data to avoid expensive cross-tab reload.
          refreshManagedTools();
          await Promise.all([loadInstalledPlugins(), loadFiles(), refreshToolDetection()]);
          break;
      }
      refreshed = true;
    } catch (error) {
      notify(`Failed to refresh ${targetTab} tab: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      if (refreshed) lastTabRefreshRef.current[targetTab] = Date.now();
      tabRefreshInFlightRef.current[targetTab] = false;
      tabRefreshCounterRef.current -= 1;
      if (tabRefreshCounterRef.current <= 0) {
        tabRefreshCounterRef.current = 0;
        setTabRefreshInProgress(false);
      }
    }
  };

  useEffect(() => {
    setShowSourceSetupWizard(shouldShowSourceSetupWizard());
  }, []);

  // Single startup scan for all item/update state; no navigation-triggered refreshes.
  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (tab !== "sync") return;
    const preview = getSyncPreview();

    // Compare against the ref (not the state dep) to avoid self-triggering.
    const prev = syncPreviewRef.current;
    const isSame =
      preview.length === prev.length &&
      preview.every((item, index) => {
        const existing = prev[index];
        if (!existing) return false;
        if (existing.kind !== item.kind) return false;
        if (item.kind === "plugin" && existing.kind === "plugin") {
          return (
            existing.plugin.name === item.plugin.name &&
            existing.missingInstances.join("|") === item.missingInstances.join("|")
          );
        }
        if (item.kind === "file" && existing.kind === "file") {
          return (
            existing.file.name === item.file.name &&
            existing.missingInstances.join("|") === item.missingInstances.join("|") &&
            existing.driftedInstances.join("|") === item.driftedInstances.join("|")
          );
        }
        if (item.kind === "tool" && existing.kind === "tool") {
          return (
            existing.toolId === item.toolId &&
            existing.installedVersion === item.installedVersion &&
            existing.latestVersion === item.latestVersion
          );
        }
        return false;
      });

    if (isSame) return;

    setSyncPreview(preview);
    setSyncSelection(() => {
      const next = new Set<string>();
      for (const item of preview) {
        next.add(getSyncItemKey(item));
      }
      return next;
    });

    if (syncArmedRef.current) {
      setSyncArmed(false);
    }
    // Only react to input data changes — NOT syncPreview/syncArmed (written here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, marketplaces, installedPlugins, managedTools, toolDetection]);

  useEffect(() => {
    if (!detailFile) return;
    const refreshed = files.find((f) => f.name === detailFile.name);
    if (refreshed && refreshed !== detailFile) {
      setDetailFile(refreshed);
    }
  }, [files, detailFile]);

  // Compute drift for all installed plugins (for list badges + detail view)
  useEffect(() => {
    if (installedPlugins.length === 0) return;
    let cancelled = false;
    void (async () => {
      const map: Record<string, PluginDrift> = {};
      await Promise.all(
        installedPlugins.map(async (p) => {
          const drift = await computeItemDrift(pluginToManagedItem(p));
          if (!cancelled && drift.kind === "plugin") map[p.name] = drift.plugin;
        })
      );
      if (!cancelled) setPluginDriftMap(map);
    })();
    return () => { cancelled = true; };
  }, [installedPlugins]);

  useEffect(() => {
    if (!syncArmed) return;
    const timeoutId = setTimeout(() => {
      setSyncArmed(false);
    }, 1500);
    return () => clearTimeout(timeoutId);
  }, [syncArmed]);

  const selectedSyncCount = useMemo(() => {
    let count = 0;
    for (const item of syncPreview) {
      if (syncSelection.has(getSyncItemKey(item))) count += 1;
    }
    return count;
  }, [syncPreview, syncSelection]);


  const allPlugins = useMemo(() => {
    return marketplaces.flatMap((m) => m.plugins);
  }, [marketplaces]);

  const filteredPlugins = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? installedPlugins : allPlugins;
    let filtered = base;
    if (search) {
      filtered = base.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.description.toLowerCase().includes(lowerSearch) ||
          p.marketplace.toLowerCase().includes(lowerSearch)
      );
    }
    
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      } else {
        const aInstalled = a.installed ? 1 : 0;
        const bInstalled = b.installed ? 1 : 0;
        const cmp = bInstalled - aInstalled;
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      }
    });
    
    return sorted;
  }, [tab, allPlugins, installedPlugins, search, sortBy, sortDir]);

  const marketplaceBrowsePlugins = useMemo(() => {
    if (!marketplaceBrowseContext) return filteredPlugins;
    return filteredPlugins.filter((p) => p.marketplace === marketplaceBrowseContext.name);
  }, [filteredPlugins, marketplaceBrowseContext]);

  const managedBrowsePlugins = useMemo(
    () => marketplaceBrowsePlugins.map((p) => pluginToManagedItem(p)),
    [marketplaceBrowsePlugins],
  );

  const filteredPiPackages = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? piPackages.filter((p) => p.installed) : piPackages;
    let filtered = base;
    if (search) {
      filtered = base.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.description.toLowerCase().includes(lowerSearch) ||
          p.marketplace.toLowerCase().includes(lowerSearch)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "default") {
        // Default sort: installed first (alpha), then local/git (alpha), then npm (by popularity)
        // 1. Installed packages first
        if (a.installed !== b.installed) {
          return a.installed ? -1 : 1;
        }
        // 2. Among non-installed: local/git before npm
        if (!a.installed && !b.installed) {
          const aIsNpm = a.sourceType === "npm";
          const bIsNpm = b.sourceType === "npm";
          if (aIsNpm !== bIsNpm) {
            return aIsNpm ? 1 : -1; // local/git comes first
          }
          // 3. Within same source type
          if (aIsNpm && bIsNpm) {
            // npm: sort by popularity (most popular first)
            const aDownloads = a.weeklyDownloads ?? 0;
            const bDownloads = b.weeklyDownloads ?? 0;
            if (aDownloads !== bDownloads) return bDownloads - aDownloads;
          }
        }
        // Fallback: alphabetical
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "popularity") {
        // Sort by weekly downloads (desc = most popular first, asc = least popular first)
        const aDownloads = a.weeklyDownloads ?? 0;
        const bDownloads = b.weeklyDownloads ?? 0;
        const cmp = bDownloads - aDownloads;
        if (cmp !== 0) return sortDir === "desc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      }
      // installed sort
      const aInstalled = a.installed ? 1 : 0;
      const bInstalled = b.installed ? 1 : 0;
      const cmp = bInstalled - aInstalled;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [tab, piPackages, search, sortBy, sortDir]);

  const maxLength = (values: number[], fallback: number) => {
    if (values.length === 0) return fallback;
    return Math.max(...values, fallback);
  };

  const marketplaceWidth = useMemo(() => {
    return maxLength(filteredPlugins.map((p) => p.marketplace.length), 10);
  }, [filteredPlugins]);

  const isInstalledFile = (file: FileStatus): boolean => {
    if (file.instances.length === 0) return false;
    return file.instances.some((i) => {
      if (i.status === "missing") return false;
      if (i.status === "failed") {
        try {
          return existsSync(i.targetPath);
        } catch {
          return false;
        }
      }
      return true;
    });
  };

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered =
      q.length === 0
        ? files
        : files.filter((file) => {
            const toolScope = file.tools?.join(", ") ?? "";
            return (
              file.name.toLowerCase().includes(q) ||
              file.source.toLowerCase().includes(q) ||
              file.target.toLowerCase().includes(q) ||
              toolScope.toLowerCase().includes(q)
            );
          });

    const sorted = [...filtered].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [tab, files, search, sortBy, sortDir]);

  const fileTotalCount = files.length;
  const installedFileCount = useMemo(
    () => files.filter(isInstalledFile).length,
    [files]
  );

  // ManagedItem conversions for generic ItemList
  const managedFiles = useMemo(
    () => filteredFiles.map((f) => fileToManagedItem(f)),
    [filteredFiles],
  );
  const managedPlugins = useMemo(
    () => filteredPlugins.map((p) => {
      const item = pluginToManagedItem(p);
      // Apply drift data to instance statuses
      const drift = pluginDriftMap[p.name];
      if (drift && Object.values(drift).some((s) => s !== "in-sync")) {
        return { ...item, instances: item.instances.map((inst) => ({ ...inst, status: "changed" as const })) };
      }
      return item;
    }),
    [filteredPlugins, pluginDriftMap],
  );
  const managedPiPackages = useMemo(
    () => filteredPiPackages.map((p) => piPackageToManagedItem(p)),
    [filteredPiPackages],
  );

  const libraryNameWidth = useMemo(() => {
    const pluginWidth = Math.min(30, maxLength(filteredPlugins.map((p) => p.name.length), 10));
    const fileWidth = Math.min(30, maxLength(filteredFiles.map((f) => f.name.length), 10));
    const piPkgWidth = Math.min(30, maxLength(filteredPiPackages.map((p) => p.name.length), 10));
    return Math.max(pluginWidth, fileWidth, piPkgWidth);
  }, [filteredPlugins, filteredFiles, filteredPiPackages]);

  const fileCount = filteredFiles.length;
  const pluginCount = filteredPlugins.length;
  const piPkgCount = filteredPiPackages.length;

  // In Discover tab: Plugins and PiPackages are summary cards (1 item each if they have content)
  // In Installed tab: sections are inline lists
  const pluginSectionCount = tab === "discover" ? (pluginCount > 0 ? 1 : 0) : pluginCount;
  const piPkgSectionCount = tab === "discover" ? (piPkgCount > 0 ? 1 : 0) : piPkgCount;

  const libraryCount = tab === "installed"
    ? fileCount + pluginCount + piPkgCount
    : pluginSectionCount + piPkgSectionCount;

  // Section boundaries for Tab/Shift+Tab navigation
  const sections = useMemo(() => {
    const result: Array<{ id: DiscoverSection; start: number; end: number }> = [];
    let offset = 0;

    if (tab === "installed") {
      if (fileCount > 0) {
        result.push({ id: "files", start: offset, end: offset + fileCount - 1 });
        offset += fileCount;
      }
      if (pluginCount > 0) {
        result.push({ id: "plugins", start: offset, end: offset + pluginCount - 1 });
        offset += pluginCount;
      }
      if (piPkgCount > 0) {
        result.push({ id: "piPackages", start: offset, end: offset + piPkgCount - 1 });
      }
      return result;
    }

    if (pluginSectionCount > 0) {
      result.push({ id: "plugins", start: offset, end: offset + pluginSectionCount - 1 });
      offset += pluginSectionCount;
    }
    if (piPkgSectionCount > 0) {
      result.push({ id: "piPackages", start: offset, end: offset + piPkgSectionCount - 1 });
    }

    return result;
  }, [tab, fileCount, pluginCount, piPkgCount, pluginSectionCount, piPkgSectionCount]);

  const currentSectionInfo = useMemo(() => {
    return sections.find((s) => selectedIndex >= s.start && selectedIndex <= s.end);
  }, [sections, selectedIndex]);

  const marketplaceRows = useMemo(
    () => buildMarketplaceRows(marketplaces, piMarketplaces, showPiFeatures),
    [marketplaces, piMarketplaces, showPiFeatures],
  );

  const selectedMarketplaceRow = useMemo(() => {
    if (tab !== "marketplaces") return null;
    return marketplaceRows[selectedIndex] ?? null;
  }, [tab, marketplaceRows, selectedIndex]);

  const maxIndex = useMemo(() => {
    if (tab === "marketplaces") {
      return Math.max(0, marketplaceRows.length - 1);
    }
    if (tab === "tools") {
      return Math.max(0, managedTools.length - 1);
    }
    if (tab === "sync") {
      return Math.max(0, syncPreview.length - 1);
    }
    return Math.max(0, libraryCount - 1);
  }, [tab, marketplaceRows, managedTools, syncPreview, libraryCount]);

  useEffect(() => {
    if (selectedIndex > maxIndex) {
      setSelectedIndex(maxIndex);
    }
  }, [selectedIndex, maxIndex, setSelectedIndex]);

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

  const selectedLibraryItem = useMemo(
    ():
      | { kind: "plugin"; plugin: Plugin }
      | { kind: "piPackage"; piPackage: PiPackage }
      | { kind: "file"; file: FileStatus }
      | { kind: "pluginSummary" }
      | { kind: "piPackageSummary" }
      | null => {
      if (tab !== "discover" && tab !== "installed") return null;

      // In Discover: plugins/piPackages are summary cards
      // In Installed: files/plugins/piPackages are inline lists
      if (tab === "discover") {
        if (pluginSectionCount > 0 && selectedIndex === 0) {
          return { kind: "pluginSummary" };
        }
        if (piPkgSectionCount > 0 && selectedIndex === pluginSectionCount) {
          return { kind: "piPackageSummary" };
        }
        return null;
      }

      // Installed tab - inline lists (order: files, plugins, piPackages)
      if (selectedIndex < fileCount) {
        const file = filteredFiles[selectedIndex];
        return file ? { kind: "file", file } : null;
      }

      if (selectedIndex < fileCount + pluginCount) {
        const plugin = filteredPlugins[selectedIndex - fileCount];
        return plugin ? { kind: "plugin", plugin } : null;
      }

      const piPkg =
        filteredPiPackages[selectedIndex - fileCount - pluginCount];
      return piPkg ? { kind: "piPackage", piPackage: piPkg } : null;
    },
    [
      tab,
      selectedIndex,
      filteredPlugins,
      filteredFiles,
      filteredPiPackages,
      fileCount,
      pluginCount,
      piPkgCount,
      pluginSectionCount,
      piPkgSectionCount,
    ]
  );

  const toPiPkgItemActions = getPiPackageActions; // kept for down-arrow handler

  // ManagedItem for currently open detail views
  const detailPluginItem = useMemo((): ManagedItem | null => {
    if (!detailPlugin) return null;
    const item = pluginToManagedItem(detailPlugin);
    const drift = detailPluginDrift ?? pluginDriftMap[detailPlugin.name];
    if (drift && Object.values(drift).some((s) => s !== "in-sync")) {
      return { ...item, instances: item.instances.map((inst) => ({ ...inst, status: "changed" as const })) };
    }
    return item;
  }, [detailPlugin, detailPluginDrift, pluginDriftMap]);

  const detailFileItem = useMemo((): ManagedItem | null => {
    if (!detailFile) return null;
    return fileToManagedItem(detailFile);
  }, [detailFile]);

  const detailPiPkgItem = useMemo((): ManagedItem | null => {
    if (!detailPiPackage) return null;
    return piPackageToManagedItem(detailPiPackage);
  }, [detailPiPackage]);

  /** Active detail context — the currently-open entity + its actions + metadata node. */
  const activeDetail = useMemo((): { item: ManagedItem; actions: ItemAction[]; metadata: React.ReactNode } | null => {
    const drift = detailPlugin ? (detailPluginDrift ?? pluginDriftMap[detailPlugin.name]) : undefined;
    if (detailFile && detailFileItem) {
      return { item: detailFileItem, actions: buildItemActions(detailFileItem), metadata: <FileMetadata item={detailFileItem} /> };
    }
    if (detailPlugin && detailPluginItem) {
      return { item: detailPluginItem, actions: buildItemActions(detailPluginItem, drift), metadata: <PluginMetadata item={detailPluginItem} /> };
    }
    if (detailPiPackage && detailPiPkgItem) {
      return { item: detailPiPkgItem, actions: buildItemActions(detailPiPkgItem), metadata: <PiPackageMetadata item={detailPiPkgItem} /> };
    }
    return null;
  }, [detailFile, detailFileItem, detailPlugin, detailPluginItem, detailPluginDrift, pluginDriftMap, detailPiPackage, detailPiPkgItem]);

  const activeMarketplaceDetail = useMemo((): { detail: MarketplaceDetailContext; actions: ReturnType<typeof getMarketplaceDetailActions> } | null => {
    if (detailMarketplace) {
      const detail: MarketplaceDetailContext = { kind: "plugin", marketplace: detailMarketplace };
      return { detail, actions: getMarketplaceDetailActions(detail) };
    }
    if (detailPiMarketplace) {
      const detail: MarketplaceDetailContext = { kind: "pi", marketplace: detailPiMarketplace };
      return { detail, actions: getMarketplaceDetailActions(detail) };
    }
    return null;
  }, [detailMarketplace, detailPiMarketplace]);

  const refreshDetailPlugin = (plugin: Plugin) => {
    const state = useStore.getState();
    const fromMarketplace = state.marketplaces
      .find((m) => m.name === plugin.marketplace)
      ?.plugins.find((p) => p.name === plugin.name);
    const fromInstalled = state.installedPlugins.find(
      (p) => p.name === plugin.name && p.marketplace === plugin.marketplace
    );
    const resolved = fromMarketplace || fromInstalled || plugin;
    setDetailPlugin(resolved);
    setDetailPluginDrift(null);
    void computeItemDrift(pluginToManagedItem(resolved)).then((drift) => {
      if (drift.kind === "plugin") setDetailPluginDrift(drift.plugin);
    });
  };

  const refreshDetailPiPackage = (pkg: PiPackage) => {
    const state = useStore.getState();
    // For local packages, compare by name and marketplace since source paths may differ
    // due to symlink resolution or path normalization
    const refreshed = state.piPackages.find((p) =>
      p.source === pkg.source ||
      (p.name === pkg.name && p.marketplace === pkg.marketplace)
    );
    setDetailPiPackage(refreshed || pkg);
  };

  // ── Extracted input handlers ───────────────────────────────────────────

  const closeDetail = () => { setActionIndex(0); };
  const handleEscape = () => {
    if (detailPlugin) {
      setDetailPlugin(null); setDetailPluginDrift(null);
      setComponentManagerMode(false); closeDetail();
    } else if (detailFile) { setDetailFile(null); closeDetail();
    } else if (activeMarketplaceDetail) { setDetailMarketplace(null); setDetailPiMarketplace(null); closeDetail();
    } else if (detailPiPackage) { setDetailPiPackage(null); closeDetail();
    } else if (detailTool) { setDetailToolKey(null);
    } else if (discoverSubView) {
      if (tab === "marketplaces" && marketplaceBrowseContext) {
        setDiscoverSubView(null); setSubViewIndex(0);
        setDetailMarketplace(marketplaceBrowseContext); setMarketplaceBrowseContext(null); setSearch("");
      } else { setDiscoverSubView(null); setSubViewIndex(0); }
    } else if (tab === "marketplaces" && marketplaceBrowseContext) {
      setDetailMarketplace(marketplaceBrowseContext); setMarketplaceBrowseContext(null); setSearch("");
    }
  };

  const handleEnterOnList = () => {
    // Marketplaces tab
    if (tab === "marketplaces") {
      if (!selectedMarketplaceRow) return;
      switch (selectedMarketplaceRow.kind) {
        case "add-plugin":
          setShowAddMarketplace(true);
          break;
        case "plugin":
          setDetailMarketplace(selectedMarketplaceRow.marketplace);
          setActionIndex(0);
          break;
        case "add-pi":
          setShowAddPiMarketplace(true);
          break;
        case "pi":
          setDetailPiMarketplace(selectedMarketplaceRow.marketplace);
          setActionIndex(0);
          break;
      }
      return;
    }

    // Tools tab
    if (tab === "tools") {
      const tool = managedTools[selectedIndex];
      if (tool) setDetailToolKey(`${tool.toolId}:${tool.instanceId}`);
      return;
    }

    // Sync tab
    if (tab === "sync" && !diffTarget && !missingSummary) {
      const item = syncPreview[selectedIndex];
      if (item) {
        if (item.kind === "plugin") {
          openPluginDetail(item.plugin);
        } else if (item.kind === "tool") {
          const tool = managedTools.find((entry) => entry.toolId === item.toolId);
          if (tool) setDetailToolKey(`${tool.toolId}:${tool.instanceId}`);
        } else if (item.kind === "file") {
          setDetailFile(item.file);
          setActionIndex(0);
        }
      }
      return;
    }

    // Installed / Discover tabs — open item detail
    if (selectedLibraryItem?.kind === "plugin") {
      openPluginDetail(selectedLibraryItem.plugin);
    } else if (selectedLibraryItem?.kind === "piPackage") {
      setDetailPiPackage(selectedLibraryItem.piPackage);
      setActionIndex(0);
    } else if (selectedLibraryItem?.kind === "file") {
      setDetailFile(selectedLibraryItem.file);
      setActionIndex(0);
    } else if (selectedLibraryItem?.kind === "pluginSummary") {
      setDiscoverSubView("plugins");
      setSubViewIndex(0);
    } else if (selectedLibraryItem?.kind === "piPackageSummary") {
      setDiscoverSubView("piPackages");
      setSubViewIndex(0);
    }
  };

  const openPluginDetail = (plugin: Plugin) => {
    setDetailPlugin(plugin); setDetailPluginDrift(null);
    void computeItemDrift(pluginToManagedItem(plugin)).then((drift) => {
      if (drift.kind === "plugin") setDetailPluginDrift(drift.plugin);
    });
    setActionIndex(0);
  };

  const toggleInstall = (plugin: Plugin) => plugin.installed ? doUninstall(plugin) : doInstall(plugin);
  const toggleInstallPiPkg = (pkg: PiPackage) => pkg.installed ? doUninstallPiPkg(pkg) : doInstallPiPkg(pkg);

  const handleSpaceToggle = () => {
    if (tab === "sync") {
      const item = syncPreview[selectedIndex];
      if (!item) return;
      const k = getSyncItemKey(item);
      setSyncSelection((current) => {
        const next = new Set(current);
        if (next.has(k)) next.delete(k); else next.add(k);
        return next;
      });
      setSyncArmed(false);
      return;
    }

    if (tab === "tools") {
      const tool = managedTools[selectedIndex];
      if (tool) void toggleToolEnabled(tool.toolId, tool.instanceId);
      return;
    }

    if (tab === "marketplaces") {
      if (selectedMarketplaceRow?.kind === "plugin") {
        void toggleMarketplaceEnabled(selectedMarketplaceRow.marketplace.name);
        return;
      }
      if (selectedMarketplaceRow?.kind === "pi") {
        void togglePiMarketplaceEnabled(selectedMarketplaceRow.marketplace.name);
        return;
      }
    }

    // Sub-views: toggle install/uninstall
    if (discoverSubView === "plugins") {
      const plugin = filteredPlugins[subViewIndex];
      if (plugin) toggleInstall(plugin);
      return;
    }
    if (discoverSubView === "piPackages") {
      const pkg = filteredPiPackages[subViewIndex];
      if (pkg) toggleInstallPiPkg(pkg);
      return;
    }

    // Library items
    if (selectedLibraryItem?.kind === "plugin") toggleInstall(selectedLibraryItem.plugin);
    else if (selectedLibraryItem?.kind === "piPackage") toggleInstallPiPkg(selectedLibraryItem.piPackage);
  };

  /** True when any detail/diff/missing overlay is open — blocks global navigation. */
  const isOverlayOpen = !!(activeDetail || activeMarketplaceDetail || detailTool || diffTarget || missingSummary);

  const handleToolModalInput = (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
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

  const handleComponentManagerInput = (input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) => {
    if (!detailPlugin) return;
    if (key.escape) { setComponentManagerMode(false); return; }
    const items = getComponentItems(detailPlugin);
    if (items.length === 0) { setComponentManagerMode(false); return; }
    if (key.upArrow) { setComponentIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setComponentIndex((i) => Math.min(items.length - 1, i + 1)); return; }
    if (key.return || input === " ") {
      const item = items[componentIndex];
      if (item) { togglePluginComponent(detailPlugin, item.kind, item.name, !item.enabled); refreshDetailPlugin(detailPlugin); }
    }
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

  const handleMarketplaceShortcut = (input: string): boolean => {
    if (!selectedMarketplaceRow) return false;
    if (input === "u") {
      if (selectedMarketplaceRow.kind === "plugin") {
        void updateMarketplace(selectedMarketplaceRow.marketplace.name);
      }
      return true;
    }
    if (input === "r") {
      if (selectedMarketplaceRow.kind === "plugin" && selectedMarketplaceRow.marketplace.source !== "claude") {
        removeMarketplace(selectedMarketplaceRow.marketplace.name);
      } else if (selectedMarketplaceRow.kind === "pi" && !selectedMarketplaceRow.marketplace.builtIn) {
        void removePiMarketplace(selectedMarketplaceRow.marketplace.name);
      }
      return true;
    }
    return false;
  };

  const handleSyncShortcut = (input: string): boolean => {
    if (input === "y") {
      if (syncArmed) {
        const items = syncPreview.filter((item) => syncSelection.has(getSyncItemKey(item)));
        if (items.length === 0) {
          notify("Select at least one item to sync.", "warning");
          setSyncArmed(false);
          return true;
        }
        void syncTools(items);
        setSyncArmed(false);
      } else {
        setSyncArmed(true);
      }
      return true;
    }
    if (input === "d") {
      const item = syncPreview[selectedIndex];
      if (item) openDiffFromSyncItem(item);
      return true;
    }
    return false;
  };

  const handleDiffInput = useDiffInput(diffTarget, missingSummary);
  const handleDetailInput = useDetailInput({
    activeDetail,
    activeMarketplaceDetail,
    detailToolOpen: !!detailTool,
    detailFile,
    actionIndex,
    diffTarget,
    missingSummary,
    setActionIndex,
    onEntityAction: (index) => { void handleEntityAction(index); },
    onMarketplaceAction: (index) => handleMarketplaceDetailAction(index),
    onPullback: (file, instance) => { void pullbackFileInstance(file, instance); },
  });
  const handleListInput = useListInput({
    discoverSubView,
    tab,
    subViewIndex,
    maxIndex,
    selectedIndex,
    filteredPlugins,
    marketplaceBrowsePlugins,
    filteredPiPackages,
    isOverlayOpen,
    setSubViewIndex,
    setSelectedIndex,
    setDetailPiPackage: (pkg) => { void setDetailPiPackage(pkg); },
    setActionIndex,
    setSyncArmed,
    onOpenPluginDetail: openPluginDetail,
    onEnterList: handleEnterOnList,
    onSpaceToggle: handleSpaceToggle,
  });

  useInput((input, key) => {
    if (toolModalAction) { handleToolModalInput(input, key); return; }

    // Sticky notifications (warnings/errors) are acknowledged with any key.
    const stickyNotifications = notifications.filter(
      (n) => (n.type === "warning" || n.type === "error") && !n.spinner
    );
    if (stickyNotifications.length > 0) {
      stickyNotifications.forEach((n) => clearNotification(n.id));
      return;
    }

    // Don't handle input when modal is open (modal handles its own input)
    if (modalVisible || editingToolId) { return; }

    // Component manager mode
    if (componentManagerMode && detailPlugin) { handleComponentManagerInput(input, key); return; }

    // Manual refresh of current tab
    if (input === "R") {
      void refreshTabData(tab, { force: true });
      return;
    }

    // Quit
    if (input === "q" && !search) {
      exit();
      return;
    }

    // Tab/Shift+Tab for section navigation in Discover/Installed tabs
    if (key.tab && (tab === "discover" || tab === "installed") && !discoverSubView && !isOverlayOpen) {
      if (sections.length > 0) {
        const currentIdx = sections.findIndex((s) => selectedIndex >= s.start && selectedIndex <= s.end);
        if (key.shift) {
          const prevIdx = currentIdx <= 0 ? sections.length - 1 : currentIdx - 1;
          setSelectedIndex(sections[prevIdx].start);
        } else {
          const nextIdx = currentIdx >= sections.length - 1 ? 0 : currentIdx + 1;
          setSelectedIndex(sections[nextIdx].start);
        }
        return;
      }
    }

    // Left/Right arrows for main tab navigation (blocked when overlays are open)
    if (key.rightArrow && !isOverlayOpen) {
      const idx = TABS.indexOf(tab); setTab(TABS[(idx + 1) % TABS.length]); return;
    }
    if (key.leftArrow && !isOverlayOpen) {
      const idx = TABS.indexOf(tab); setTab(TABS[(idx - 1 + TABS.length) % TABS.length]); return;
    }

    // Settings tab: SettingsPanel handles its own input (up/down/enter/esc)
    if (tab === "settings") {
      return;
    }

    // Escape - close the topmost overlay / go back
    if (key.escape) {
      handleEscape();
      return;
    }

    if (handleDiffInput(input, key)) return;
    if (handleDetailInput(input, key)) return;
    if (handleListInput(input, key)) return;

    // Tab-specific shortcuts
    if (tab === "tools" || detailTool) {
      if (handleToolShortcut(input)) return;
    }
    if (tab === "marketplaces" && !activeMarketplaceDetail) {
      if (handleMarketplaceShortcut(input)) return;
    }
    if (tab === "sync" && !activeDetail && !activeMarketplaceDetail && !diffTarget && !missingSummary) {
      if (handleSyncShortcut(input)) return;
    }
    if (tab === "installed" && !activeDetail && !activeMarketplaceDetail && !detailTool && !diffTarget && !missingSummary && !discoverSubView) {
      if (input === "d" && selectedLibraryItem?.kind === "file") {
        openDiffFromSyncItem(toFileSyncItem(selectedLibraryItem.file));
        return;
      }
    }

    // Sort shortcuts (s to cycle sort, r to reverse) - only when search not focused
    if ((tab === "discover" || tab === "installed") && !isOverlayOpen && !searchFocused) {
      if (input === "s") {
        setSort((s) => {
          if (s.by === "default") return { by: "name", dir: "asc" };
          if (s.by === "name") return { by: "installed", dir: s.dir };
          if (s.by === "installed") return { by: "popularity", dir: "desc" };
          return { by: "default", dir: "asc" };
        });
        return;
      }
      if (input === "r") {
        setSort((s) => ({ ...s, dir: s.dir === "asc" ? "desc" : "asc" }));
        return;
      }
    }
  });

  // Build plugin diff target for unified action dispatch
  const buildPluginDiffTargetCb = async (plugin: Plugin, toolId: string, instanceId: string) => {
    const sourcePaths = resolvePluginSourcePaths(plugin);
    if (!sourcePaths) return null;
    const pluginDrift = detailPluginDrift ?? pluginDriftMap[plugin.name];
    if (!pluginDrift) return null;
    const inst = tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    if (!inst) return null;

    const allFiles: import("./lib/types.js").DiffFileSummary[] = [];
    const instance: DiffInstanceRef = {
      toolId: inst.toolId, instanceId: inst.instanceId,
      instanceName: inst.name, configDir: inst.configDir,
    };
    for (const [key, status] of Object.entries(pluginDrift)) {
      if (status === "in-sync") continue;
      const [kind, name] = key.split(":");
      const subdir = kind === "skill" ? inst.skillsSubdir : kind === "command" ? inst.commandsSubdir : inst.agentsSubdir;
      if (!subdir) continue;
      const srcSuffix = kind === "skill" ? name : `${name}.md`;
      try {
        const dt = buildFileDiffTarget(`${kind}s/${name}`, srcSuffix,
          join(sourcePaths.pluginDir, `${kind}s`, srcSuffix),
          join(inst.configDir, subdir, srcSuffix), instance);
        allFiles.push(...dt.files);
      } catch { /* skip */ }
    }
    return { kind: "file" as const, title: `${plugin.name} — ${inst.name}`, instance, files: allFiles };
  };

  // Install plugin to specific tool instance (for unified dispatch)
  const installPluginToInstanceCb = async (plugin: Plugin, toolId: string, instanceId: string) => {
    const toolStatus = getPluginToolStatus(plugin).find((s) => s.toolId === toolId && s.instanceId === instanceId);
    if (!toolStatus) return;
    const mkt = marketplaces.find((m) => m.name === plugin.marketplace);
    const { notify: n, clearNotification: cn } = useStore.getState();
    const result = await withSpinner(`Installing ${plugin.name} to ${toolStatus.name}...`,
      () => syncPluginInstances(plugin, mkt?.url, [toolStatus]), n, cn);
    const count = result.syncedInstances[`${toolStatus.toolId}:${toolStatus.instanceId}`] ?? 0;
    n(count > 0
      ? `✓ Installed ${plugin.name} to ${toolStatus.name} (${count})`
      : `✗ Failed to install ${plugin.name} to ${toolStatus.name}: ${result.errors.join("; ") || "No components linked"}`,
      count > 0 ? "success" : "error");
    await useStore.getState().refreshAll();
  };

  // Uninstall plugin from specific tool instance (for unified dispatch)
  const uninstallPluginFromInstanceCb = async (plugin: Plugin, toolId: string, instanceId: string) => {
    const toolStatus = getPluginToolStatus(plugin).find((s) => s.toolId === toolId && s.instanceId === instanceId);
    const { notify: n, clearNotification: cn } = useStore.getState();
    const name = toolStatus?.name ?? instanceId;
    await withSpinner(`Uninstalling ${plugin.name} from ${name}...`,
      () => Promise.resolve(uninstallPluginFromInstance(plugin, toolId, instanceId)), n, cn);
    n(`✓ Uninstalled ${plugin.name} from ${name}`, "success");
    await useStore.getState().refreshAll();
  };

  // Unified action handler for file, plugin, and pi-package detail views
  const handleEntityAction = async (index: number) => {
    if (!activeDetail) return;
    const { item, actions } = activeDetail;
    const action = actions[index];
    if (!action) return;

    await handleItemAction(item, action, {
      closeDetail: () => { setDetailFile(null); setDetailPlugin(null); setDetailPiPackage(null); closeDetail(); },
      openDiffForFile,
      openMissingSummaryForFile,
      setDiffTarget: (target) => useStore.setState({ diffTarget: target }),
      installPlugin: doInstall,
      uninstallPlugin: doUninstall,
      updatePlugin: doUpdate,
      installPluginToInstance: installPluginToInstanceCb,
      uninstallPluginFromInstance: uninstallPluginFromInstanceCb,
      refreshDetailPlugin,
      syncFiles: syncTools,
      pullbackFileInstance,
      installPiPackage: doInstallPiPkg,
      uninstallPiPackage: doUninstallPiPkg,
      updatePiPackage: doUpdatePiPkg,
      refreshDetailPiPackage,
      buildPluginDiffTarget: buildPluginDiffTargetCb,
    });
  };

  const handleMarketplaceDetailAction = (index: number) => {
    if (!activeMarketplaceDetail) return;
    const { detail, actions } = activeMarketplaceDetail;
    const action = actions[index];
    if (!action) return;

    switch (action.type) {
      case "browse":
        if (detail.kind === "plugin") {
          setMarketplaceBrowseContext(detail.marketplace);
          setDiscoverSubView("plugins");
          setSubViewIndex(0);
          setSearch(detail.marketplace.name);
        } else {
          setDiscoverSubView("piPackages");
          setSubViewIndex(0);
          setTab("discover");
        }
        setDetailMarketplace(null);
        setDetailPiMarketplace(null);
        break;
      case "update":
        if (detail.kind === "plugin") {
          void updateMarketplace(detail.marketplace.name);
        }
        break;
      case "remove":
        if (detail.kind === "plugin") {
          removeMarketplace(detail.marketplace.name);
          setDetailMarketplace(null);
        } else {
          void removePiMarketplace(detail.marketplace.name);
          setDetailPiMarketplace(null);
        }
        break;
      case "back":
        setDetailPiMarketplace(null);
        setActionIndex(0);
        break;
    }
  };

  const statusMessage = loading
    ? "Loading..."
    : `${allPlugins.length} plugins, ${piPackages.length} pi-pkgs, ${fileTotalCount} files from ${marketplaces.length} marketplaces`;

  const showGlobalLoadingIndicator = loading || tabRefreshInProgress;
  const shouldShowDiscoverLoading =
    loading && marketplaces.length === 0 && piPackages.length === 0;
  const shouldShowMarketplacesLoading = loading && marketplaces.length === 0 && piMarketplaces.length === 0;

  const refreshTabLabel =
    tab === "discover"
      ? "Discover"
      : tab === "installed"
        ? "Installed"
        : tab === "marketplaces"
          ? "Marketplaces"
          : tab === "tools"
            ? "Tools"
            : "Sync";

  const handleAddMarketplace = (name: string, url: string) => {
    addMarketplace(name, url);
    setShowAddMarketplace(false);
  };

  const handleToolConfigSave = (toolId: string, instanceId: string, configDir: string) => {
    void updateToolConfigDir(toolId, instanceId, configDir);
    setEditingToolId(null);
  };

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
    await refreshAll();
  };

  const handleSourceWizardComplete = async (source: string) => {
    const loadingId = notify("Configuring source repository...", "info", { spinner: true });
    try {
      const result = await setupSourceRepository(source);
      clearNotification(loadingId);
      setShowSourceSetupWizard(false);
      await refreshAll();

      if (result.importedConfig) {
        notify(
          `Using blackbook config from ${result.importedConfigPath}${result.cloned ? " (repo cloned)" : ""}`,
          "success"
        );
      } else {
        notify(
          `Source repository set to ${result.sourceRepo}${result.cloned ? " (repo cloned)" : ""}`,
          "success"
        );
      }
    } catch (error) {
      clearNotification(loadingId);
      notify(`Failed to configure source repository: ${error instanceof Error ? error.message : String(error)}`, "error");
      throw error;
    }
  };

  const handleSourceWizardSkip = () => {
    setShowSourceSetupWizard(false);
  };

  // Memoize instances for missing summary view (instance picker still needed there)
  const missingInstances = useMemo((): DiffInstanceRef[] => {
    return [];
  }, [missingSummary]);

  const handleMissingInstanceSelect = (instance: DiffInstanceRef) => {
    // No-op for now - asset/config removed
  };

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar activeTab={tab} onTabChange={setTab} />

      <Box marginBottom={1}>
        {showGlobalLoadingIndicator ? (
          <Text color="cyan">↻ {tabRefreshInProgress ? `Refreshing ${refreshTabLabel}...` : "Loading..."}</Text>
        ) : (
          <Text color="gray"> </Text>
        )}
      </Box>

      {/* Diff view overlay */}
      {showSourceSetupWizard ? (
        <SourceSetupWizard
          onComplete={handleSourceWizardComplete}
          onSkip={handleSourceWizardSkip}
        />
      ) : diffTarget ? (
        <DiffView
          target={diffTarget}
          onClose={closeDiff}
        />
      ) : missingSummary ? (
        <MissingSummaryView
          summary={missingSummary}
          instances={missingInstances}
          onSelectInstance={handleMissingInstanceSelect}
          onClose={closeMissingSummary}
        />
      ) : editingToolId ? (
        <EditToolModal
          tool={editingTool}
          onSubmit={handleToolConfigSave}
          onCancel={() => setEditingToolId(null)}
        />
      ) : modalVisible === "addMarketplace" ? (
        <AddMarketplaceModal onSubmit={handleAddMarketplace} onCancel={() => setModalVisible(null)} />
      ) : modalVisible === "addPiMarketplace" ? (
        <AddMarketplaceModal type="pi" onSubmit={(name, source) => { void addPiMarketplace(name, source); setModalVisible(null); }} onCancel={() => setModalVisible(null)} />
      ) : toolModalAction && activeToolForModal ? (
        <ToolActionModal
          toolName={activeToolForModal.displayName}
          action={toolModalAction}
          command={getToolActionCommand(activeToolForModal, toolModalAction)}
          warning={toolModalWarning}
          preferredPackageManager={getPackageManager()}
          migrateSelected={toolModalMigrate}
          inProgress={toolModalRunning || toolActionInProgress === activeToolForModal.toolId}
          done={toolModalDone}
          success={toolModalSuccess}
          output={toolActionOutput}
        />
      ) : detailTool ? (
        <ToolDetail
          tool={detailTool}
          detection={toolDetection[detailTool.toolId] || null}
          pending={toolDetectionPending[detailTool.toolId] === true}
        />
      ) : detailPlugin && componentManagerMode ? (
        <ComponentManager
          plugin={detailPlugin}
          selectedIndex={componentIndex}
        />
      ) : activeDetail && !componentManagerMode ? (
        <ItemDetail
          item={activeDetail.item}
          selectedAction={actionIndex}
          actions={activeDetail.actions}
          metadata={activeDetail.metadata}
        />
      ) : activeMarketplaceDetail ? (
        <MarketplaceDetailView
          detail={activeMarketplaceDetail.detail}
          selectedIndex={actionIndex}
        />
      ) : (
        <Box flexDirection="column" height={(({ sync: 19, discover: 20, installed: 20 } as Record<string, number>)[tab] ?? 25)}>
          {(tab === "installed" || (tab === "discover" && discoverSubView)) && (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexGrow={1}>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder={
                    discoverSubView === "plugins"
                      ? "Search plugins..."
                      : discoverSubView === "piPackages"
                        ? "Search pi packages..."
                        : "Search installed files and plugins..."
                  }
                  focus={searchFocused}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    setSearchFocused(false);
                    setSearch("");
                  }}
                />
              </Box>
              <Box marginLeft={2}>
                <Text color="gray">
                  Sort: {sortBy === "default" ? "Default" : sortBy === "name" ? "Name" : sortBy === "installed" ? "Installed" : "Popular"} {sortBy !== "default" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </Text>
              </Box>
            </Box>
          )}

          {tab === "discover" && (
            <>
              {shouldShowDiscoverLoading ? (
                <Box marginY={1}><Text color="cyan">⠋ Loading plugins from marketplaces...</Text></Box>
              ) : discoverSubView === "plugins" ? (
                <Box flexDirection="column">
                  <Box marginBottom={1}><Text color="cyan" bold>Plugins </Text><Text color="gray" dimColor>{getRange(subViewIndex, managedPlugins.length, 12)}</Text><Text color="gray"> · Press Esc to go back</Text></Box>
                  <ItemList items={managedPlugins} selectedIndex={subViewIndex} maxHeight={12} columns={PLUGIN_COLUMNS} />
                </Box>
              ) : discoverSubView === "piPackages" ? (
                <Box flexDirection="column">
                  <Box marginBottom={1}><Text color="cyan" bold>Pi Packages </Text><Text color="gray" dimColor>{getRange(subViewIndex, managedPiPackages.length, 12)}</Text><Text color="gray"> · Press Esc to go back</Text></Box>
                  <ItemList items={managedPiPackages} selectedIndex={subViewIndex} maxHeight={12} columns={PLUGIN_COLUMNS} />
                </Box>
              ) : (
                // Dashboard view - inline lists for Configs/Assets, summary cards for Plugins/PiPackages
                <Box flexDirection="column">
                  {filteredPlugins.length > 0 && (
                    <Box flexDirection="column">
                      <PluginSummary
                        plugins={filteredPlugins}
                        selected={selectedLibraryItem?.kind === "pluginSummary"}
                      />
                    </Box>
                  )}
                  {filteredPiPackages.length > 0 && (
                    <Box flexDirection="column" marginTop={filteredPlugins.length > 0 ? 1 : 0}>
                      <PiPackageSummary
                        packages={filteredPiPackages}
                        selected={selectedLibraryItem?.kind === "piPackageSummary"}
                      />
                    </Box>
                  )}
                </Box>
              )}
            </>
          )}

          {tab === "installed" && (
            <Box flexDirection="column">
              {managedFiles.length > 0 && (
                <Box flexDirection="column">
                  <Box><Text color="gray">  Files </Text><Text color="gray" dimColor>{getRange(selectedIndex < fileCount ? selectedIndex : 0, managedFiles.length, 5)}</Text></Box>
                  <ItemList items={managedFiles} selectedIndex={selectedIndex < fileCount ? selectedIndex : -1} maxHeight={5} columns={FILE_COLUMNS} />
                </Box>
              )}

              {(managedPlugins.length > 0 || !installedPluginsLoaded) && (
                <Box flexDirection="column" marginTop={managedFiles.length > 0 ? 1 : 0}>
                  <Box>
                    <Text color="gray">  Plugins </Text>
                    <Text color="gray" dimColor>
                      {managedPlugins.length > 0
                        ? getRange(selectedIndex >= fileCount && selectedIndex < fileCount + pluginCount ? selectedIndex - fileCount : 0, managedPlugins.length, 4)
                        : "(loading...)"}
                    </Text>
                  </Box>
                  {managedPlugins.length > 0 ? (
                    <ItemList items={managedPlugins} selectedIndex={selectedIndex >= fileCount && selectedIndex < fileCount + pluginCount ? selectedIndex - fileCount : -1} maxHeight={4} columns={PLUGIN_COLUMNS} />
                  ) : (
                    <Box marginLeft={2}><Text color="cyan">⠋ Loading plugins...</Text></Box>
                  )}
                </Box>
              )}

              {(managedPiPackages.length > 0 || !piPackagesLoaded) && (
                <Box flexDirection="column" marginTop={(managedFiles.length > 0 || managedPlugins.length > 0 || !installedPluginsLoaded) ? 1 : 0}>
                  <Box>
                    <Text color="gray">  Pi Packages </Text>
                    <Text color="gray" dimColor>
                      {managedPiPackages.length > 0
                        ? getRange(selectedIndex >= fileCount + pluginCount ? selectedIndex - fileCount - pluginCount : 0, managedPiPackages.length, 3)
                        : "(loading...)"}
                    </Text>
                  </Box>
                  {managedPiPackages.length > 0 ? (
                    <ItemList items={managedPiPackages} selectedIndex={selectedIndex >= fileCount + pluginCount ? selectedIndex - fileCount - pluginCount : -1} maxHeight={3} columns={PLUGIN_COLUMNS} />
                  ) : (
                    <Box marginLeft={2}><Text color="cyan">⠋ Loading pi packages...</Text></Box>
                  )}
                </Box>
              )}
            </Box>
          )}

          {tab === "marketplaces" && (
            <>
              {shouldShowMarketplacesLoading ? (
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading marketplaces...</Text>
                </Box>
              ) : discoverSubView === "plugins" && marketplaceBrowseContext ? (
                <Box flexDirection="column">
                  <Box marginBottom={1}>
                    <Text color="cyan" bold>{marketplaceBrowseContext.name} plugins </Text>
                    <Text color="gray" dimColor>{getRange(subViewIndex, marketplaceBrowsePlugins.length, 12)}</Text>
                    <Text color="gray"> · Press Esc to go back</Text>
                  </Box>
                  <ItemList
                    items={managedBrowsePlugins}
                    selectedIndex={subViewIndex}
                    maxHeight={12}
                    columns={PLUGIN_COLUMNS}
                  />
                  <Box marginTop={1}>
                    <PluginPreview plugin={marketplaceBrowsePlugins[subViewIndex]} />
                  </Box>
                </Box>
              ) : (
                <Box flexDirection="column">
                  <MarketplaceList
                    rows={marketplaceRows}
                    selectedIndex={selectedIndex}
                  />
                </Box>
              )}
            </>
          )}

          {tab === "tools" && (
            <ToolsList
              tools={managedTools}
              selectedIndex={selectedIndex}
              detection={toolDetection}
              detectionPending={toolDetectionPending}
              actionInProgress={toolActionInProgress}
            />
          )}

          {tab === "sync" && (
            <>
              {syncPreview.length > 0 && (
                <Box>
                  <Text color={syncArmed ? "yellow" : "gray"}>
                    {syncArmed
                      ? `Press y again to confirm sync (${selectedSyncCount} selected)`
                      : `Space to toggle · Press y to sync (${selectedSyncCount} selected)`}
                  </Text>
                </Box>
              )}
              <SyncList
                items={syncPreview}
                selectedIndex={selectedIndex}
                selectedKeys={syncSelection}
                getItemKey={getSyncItemKey}
              />
            </>
          )}

          {tab === "settings" && (
            <SettingsPanel />
          )}
        </Box>
      )}

      {(tab === "discover" || tab === "installed") && !isOverlayOpen && (
        discoverSubView === "plugins" ? (
          <PluginPreview plugin={filteredPlugins[subViewIndex] ?? null} />
        ) : discoverSubView === "piPackages" ? (
          <PiPackagePreview pkg={filteredPiPackages[subViewIndex] ?? null} />
        ) : selectedLibraryItem?.kind === "plugin" ? (
          <PluginPreview plugin={selectedLibraryItem.plugin} />
        ) : selectedLibraryItem?.kind === "piPackage" ? (
          <PiPackagePreview pkg={selectedLibraryItem.piPackage} />
        ) : selectedLibraryItem?.kind === "file" ? (
          <FilePreview file={selectedLibraryItem.file} />
        ) : null
      )}

      {tab === "sync" && !isOverlayOpen && (
        <SyncPreview item={syncPreview[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar
        tab={tab}
        hasDetail={isOverlayOpen}
        toolsHint={toolsHint}
      />
      <StatusBar
        loading={loading}
        message={statusMessage}
        error={error}
        enabledTools={enabledToolNames}
      />
    </Box>
  );
}
