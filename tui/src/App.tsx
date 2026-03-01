import React, { useEffect, useState, useMemo, useRef } from "react";
import { existsSync } from "fs";
import { Box, Text, useInput, useApp } from "ink";
import { useStore } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginList } from "./components/PluginList.js";
import { PluginPreview } from "./components/PluginPreview.js";
import { PluginDetail } from "./components/PluginDetail.js";
import { MarketplaceList } from "./components/MarketplaceList.js";
import { MarketplaceDetail } from "./components/MarketplaceDetail.js";
import { PiMarketplaceList } from "./components/PiMarketplaceList.js";
import { PiMarketplaceDetail, getPiMarketplaceActions } from "./components/PiMarketplaceDetail.js";
import { AddMarketplaceModal } from "./components/AddMarketplaceModal.js";
import { SourceSetupWizard } from "./components/SourceSetupWizard.js";
import { EditToolModal } from "./components/EditToolModal.js";
import { ToolsList } from "./components/ToolsList.js";
import { ToolDetail } from "./components/ToolDetail.js";
import { ToolActionModal, type ToolModalAction } from "./components/ToolActionModal.js";
import { SyncList } from "./components/SyncList.js";
import { SyncPreview } from "./components/SyncPreview.js";
import { FileList } from "./components/FileList.js";
import { FilePreview } from "./components/FilePreview.js";
import { FileDetail, getFileActions } from "./components/FileDetail.js";
import { HintBar } from "./components/HintBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Notifications } from "./components/Notifications.js";
import { DiffView } from "./components/DiffView.js";
import { MissingSummaryView } from "./components/MissingSummary.js";
import { PluginSummary } from "./components/PluginSummary.js";
import { PiPackageSummary } from "./components/PiPackageSummary.js";
import { PiPackageList } from "./components/PiPackageList.js";
import { PiPackagePreview } from "./components/PiPackagePreview.js";
import { PiPackageDetail, getPiPackageActions } from "./components/PiPackageDetail.js";
import { ComponentManager, getComponentItems } from "./components/ComponentManager.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { getPluginToolStatus, togglePluginComponent } from "./lib/plugin-status.js";
import { getToolLifecycleCommand, detectInstallMethodMismatch } from "./lib/tool-lifecycle.js";
import { getPackageManager } from "./lib/config.js";
import { setupSourceRepository, shouldShowSourceSetupWizard } from "./lib/source-setup.js";
import type { Tab, SyncPreviewItem, Plugin, PiPackage, PiMarketplace, DiffInstanceRef, DiscoverSection, DiscoverSubView, ManagedToolRow, FileStatus, Marketplace } from "./lib/types.js";

const TABS: Tab[] = ["sync", "tools", "discover", "installed", "marketplaces", "settings"];
const TAB_REFRESH_TTL_MS = 30000;

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    installedPlugins,
    files,
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
    piPackages,
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
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [showSourceSetupWizard, setShowSourceSetupWizard] = useState(false);
  const [showAddPiMarketplace, setShowAddPiMarketplace] = useState(false);
  const [detailPiMarketplace, setDetailPiMarketplace] = useState<PiMarketplace | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [detailToolKey, setDetailToolKey] = useState<string | null>(null);
  const [detailFile, setDetailFile] = useState<FileStatus | null>(null);
  const [toolModalAction, setToolModalAction] = useState<ToolModalAction | null>(null);
  const [toolModalWarning, setToolModalWarning] = useState<string | null>(null);
  const [toolModalMigrate, setToolModalMigrate] = useState(false);
  const [toolModalRunning, setToolModalRunning] = useState(false);
  const [toolModalDone, setToolModalDone] = useState(false);
  const [toolModalSuccess, setToolModalSuccess] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[]>([]);
  const [syncSelection, setSyncSelection] = useState<Set<string>>(new Set());
  const [syncArmed, setSyncArmed] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "name" | "installed" | "popularity">("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
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
      if (targetTab === "settings") {
        // Settings reads config on mount — no async load needed.
        refreshed = true;
        return;
      }

      if (targetTab === "discover") {
        await Promise.all([loadMarketplaces(), loadPiPackages()]);
        refreshed = true;
        return;
      }

      if (targetTab === "installed") {
        await Promise.all([loadInstalledPlugins(), loadPiPackages()]);
        // Load file statuses in the background so Installed is responsive immediately.
        void loadFiles();
        refreshed = true;
        return;
      }

      if (targetTab === "tools") {
        refreshManagedTools();
        await refreshToolDetection();
        refreshed = true;
        return;
      }

      if (targetTab === "marketplaces") {
        await Promise.all([loadMarketplaces(), loadPiPackages()]);
        refreshed = true;
        return;
      }

      // Sync tab: refresh only sync-relevant data and avoid full cross-tab reload.
      // This keeps first navigation responsive and prevents expensive refresh chains.
      refreshManagedTools();
      await Promise.all([loadInstalledPlugins(), loadFiles(), refreshToolDetection()]);
      refreshed = true;
    } catch (error) {
      notify(`Failed to refresh ${targetTab} tab: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      if (refreshed) {
        lastTabRefreshRef.current[targetTab] = Date.now();
      }
      tabRefreshInFlightRef.current[targetTab] = false;
      tabRefreshCounterRef.current -= 1;
      if (tabRefreshCounterRef.current <= 0) {
        tabRefreshCounterRef.current = 0;
        setTabRefreshInProgress(false);
      }
    }
  };

  useEffect(() => {
    void refreshTabData(tab);
  }, [tab]);

  useEffect(() => {
    setShowSourceSetupWizard(shouldShowSourceSetupWizard());
  }, []);

  useEffect(() => {
    void refreshToolDetection();
  }, [refreshToolDetection]);

  useEffect(() => {
    void loadPiPackages();
  }, [loadPiPackages, showPiFeatures]);

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

  // Pi section starts after plugin section: 0=AddPlugin, 1..N=plugins, N+1=AddPi, N+2..M=piMarketplaces
  const piSectionOffset = marketplaces.length + 1;

  const maxIndex = useMemo(() => {
    if (tab === "marketplaces") {
      if (!showPiFeatures) {
        // Plugin section only: Add(0) + marketplaces(N)
        return marketplaces.length;
      }
      // Plugin: Add(0) + marketplaces(N) + Pi: Add(1) + piMarketplaces(M)
      return marketplaces.length + 1 + piMarketplaces.length;
    }
    if (tab === "tools") {
      return Math.max(0, managedTools.length - 1);
    }
    if (tab === "sync") {
      return Math.max(0, syncPreview.length - 1);
    }
    return Math.max(0, libraryCount - 1);
  }, [tab, marketplaces, piMarketplaces, managedTools, syncPreview, libraryCount, showPiFeatures]);

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

    const supportsMigration = (detection: typeof toolDetection[string] | undefined) => {
      const path = detection?.binaryPath;
      if (!path || !detection?.installed) return false;
      const detectedMethod =
        path.startsWith("/opt/homebrew/") || path.startsWith("/usr/local/") ? "brew" : "unknown";
      return detectedMethod === "brew";
    };

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

  const fileActions = useMemo(() => {
    return detailFile ? getFileActions(detailFile) : [];
  }, [detailFile]);

  const getPluginActions = (plugin: typeof detailPlugin) => {
    if (!plugin) return [] as string[];
    if (!plugin.installed) return ["Install", "Back to plugin list"];

    const toolStatuses = getPluginToolStatus(plugin);
    const supportedTools = toolStatuses.filter(t => t.supported && t.enabled);
    const installedCount = supportedTools.filter(t => t.installed).length;
    const needsRepair = installedCount < supportedTools.length && supportedTools.length > 0;
    const hasComponents = plugin.skills.length > 0 || plugin.commands.length > 0 || plugin.agents.length > 0;
    const actions = ["Uninstall", "Update now"];
    if (hasComponents) actions.push("Manage components");
    if (needsRepair) actions.push("Install to all tools");
    actions.push("Back to plugin list");
    return actions;
  };

  const getPluginActionCount = (plugin: typeof detailPlugin) => {
    return getPluginActions(plugin).length;
  };

  const refreshDetailPlugin = (plugin: Plugin) => {
    const state = useStore.getState();
    const fromMarketplace = state.marketplaces
      .find((m) => m.name === plugin.marketplace)
      ?.plugins.find((p) => p.name === plugin.name);
    const fromInstalled = state.installedPlugins.find(
      (p) => p.name === plugin.name && p.marketplace === plugin.marketplace
    );
    setDetailPlugin(fromMarketplace || fromInstalled || plugin);
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

  useInput((input, key) => {
    if (toolModalAction) {
      if (toolModalDone) {
        if (!toolModalSuccess && (input === "m" || input === "M") && toolModalWarning) {
          setToolModalMigrate((current) => !current);
          return;
        }

        if (!toolModalSuccess && key.return && activeToolForModal) {
          setToolModalDone(false);
          void runToolAction(activeToolForModal, toolModalAction, toolModalMigrate);
          return;
        }

        setToolModalAction(null);
        setToolModalWarning(null);
        setToolModalMigrate(false);
        setToolModalDone(false);
        setToolModalSuccess(false);
        return;
      }

      if (toolModalRunning) {
        if (key.escape) {
          cancelToolAction();
        }
        return;
      }

      if (key.escape) {
        setToolModalAction(null);
        setToolModalWarning(null);
        setToolModalMigrate(false);
        return;
      }

      if ((input === "m" || input === "M") && toolModalWarning) {
        setToolModalMigrate((current) => !current);
        return;
      }

      if (key.return && activeToolForModal) {
        void runToolAction(activeToolForModal, toolModalAction, toolModalMigrate);
      }
      return;
    }

    // Sticky notifications (warnings/errors) are acknowledged with any key.
    const stickyNotifications = notifications.filter(
      (n) => (n.type === "warning" || n.type === "error") && !n.spinner
    );
    if (stickyNotifications.length > 0) {
      stickyNotifications.forEach((n) => clearNotification(n.id));
      return;
    }

    // Don't handle input when modal is open (modal handles its own input)
    if (showSourceSetupWizard || showAddMarketplace || showAddPiMarketplace || editingToolId) {
      return;
    }

    // Component manager mode input handling
    if (componentManagerMode && detailPlugin) {
      if (key.escape) {
        setComponentManagerMode(false);
        return;
      }

      const items = getComponentItems(detailPlugin);
      if (items.length === 0) {
        setComponentManagerMode(false);
        return;
      }

      if (key.upArrow) {
        setComponentIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setComponentIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (key.return || input === " ") {
        const item = items[componentIndex];
        if (item) {
          togglePluginComponent(detailPlugin, item.kind, item.name, !item.enabled);
          // Force re-render by refreshing the detail plugin
          refreshDetailPlugin(detailPlugin);
        }
        return;
      }
      return;
    }

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
    if (key.tab && (tab === "discover" || tab === "installed") && !discoverSubView) {
      if (!detailPlugin && !detailFile && !detailMarketplace && !detailPiMarketplace && !detailPiPackage && !detailTool && !diffTarget && !missingSummary) {
        if (sections.length > 0) {
          const currentIdx = sections.findIndex((s) => selectedIndex >= s.start && selectedIndex <= s.end);
          if (key.shift) {
            // Shift+Tab: go to previous section
            const prevIdx = currentIdx <= 0 ? sections.length - 1 : currentIdx - 1;
            setSelectedIndex(sections[prevIdx].start);
          } else {
            // Tab: go to next section
            const nextIdx = currentIdx >= sections.length - 1 ? 0 : currentIdx + 1;
            setSelectedIndex(sections[nextIdx].start);
          }
          return;
        }
      }
    }

    // Left/Right arrows for main tab navigation (blocked when overlays are open)
    if (key.rightArrow) {
      if (!detailPlugin && !detailFile && !detailMarketplace && !detailPiMarketplace && !detailPiPackage && !detailTool && !diffTarget && !missingSummary) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx + 1) % TABS.length]);
        return;
      }
    }
    if (key.leftArrow) {
      if (!detailPlugin && !detailFile && !detailMarketplace && !detailPiMarketplace && !detailPiPackage && !detailTool && !diffTarget && !missingSummary) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx - 1 + TABS.length) % TABS.length]);
        return;
      }
    }

    // Settings tab: SettingsPanel handles its own input (up/down/enter/esc)
    if (tab === "settings") {
      return;
    }

    // Escape - go back
    if (key.escape) {
      if (detailPlugin) {
        setDetailPlugin(null);
        setActionIndex(0);
        setComponentManagerMode(false);
      } else if (detailFile) {
        setDetailFile(null);
        setActionIndex(0);
      } else if (detailMarketplace) {
        setDetailMarketplace(null);
        setActionIndex(0);
      } else if (detailPiMarketplace) {
        setDetailPiMarketplace(null);
        setActionIndex(0);
      } else if (detailPiPackage) {
        setDetailPiPackage(null);
        setActionIndex(0);
      } else if (detailTool) {
        setDetailToolKey(null);
      } else if (discoverSubView) {
        if (tab === "marketplaces" && marketplaceBrowseContext) {
          // Return to marketplace detail when browsing plugins from Marketplaces flow.
          setDiscoverSubView(null);
          setSubViewIndex(0);
          setDetailMarketplace(marketplaceBrowseContext);
          setMarketplaceBrowseContext(null);
          setSearch("");
        } else {
          // Close sub-view and return to Discover dashboard
          setDiscoverSubView(null);
          setSubViewIndex(0);
        }
      } else if (tab === "marketplaces" && marketplaceBrowseContext) {
        // Safety path: if browse context remains but sub-view is closed, return to detail.
        setDetailMarketplace(marketplaceBrowseContext);
        setMarketplaceBrowseContext(null);
        setSearch("");
      }
      return;
    }

    // Up/Down navigation
    if (key.upArrow) {
      if (diffTarget || missingSummary) {
        // DiffView and MissingSummaryView handle their own navigation
        return;
      }
      if (detailPlugin || detailFile || detailMarketplace || detailPiMarketplace || detailPiPackage) {
        setActionIndex((i) => Math.max(0, i - 1));
      } else if (detailTool) {
        return;
      } else if (discoverSubView) {
        // Navigate within sub-view
        setSubViewIndex((i) => Math.max(0, i - 1));
      } else {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        if (tab === "sync") {
          setSyncArmed(false);
        }
      }
      return;
    }
    if (key.downArrow) {
      if (diffTarget || missingSummary) {
        // DiffView and MissingSummaryView handle their own navigation
        return;
      }
      if (detailFile) {
        setActionIndex((i) => Math.min(fileActions.length - 1, i + 1));
      } else if (detailPlugin) {
        const actionCount = getPluginActionCount(detailPlugin);
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailPiPackage) {
        const actions = getPiPackageActions(detailPiPackage);
        setActionIndex((i) => Math.min(actions.length - 1, i + 1));
      } else if (detailMarketplace) {
        const actionCount = detailMarketplace.source === "claude" ? 2 : 3;
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailPiMarketplace) {
        const piMktActions = getPiMarketplaceActions(detailPiMarketplace);
        setActionIndex((i) => Math.min(piMktActions.length - 1, i + 1));
      } else if (detailTool) {
        return;
      } else if (discoverSubView) {
        // Navigate within sub-view
        const pluginList = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
        const maxSubViewIndex = discoverSubView === "plugins" ? pluginList.length - 1 : filteredPiPackages.length - 1;
        setSubViewIndex((i) => Math.min(maxSubViewIndex, i + 1));
      } else {
        setSelectedIndex(Math.min(maxIndex, selectedIndex + 1));
        if (tab === "sync") {
          setSyncArmed(false);
        }
      }
      return;
    }

    // p - pull to source from drifted instance
    if (input === "p" && detailFile && !diffTarget && !missingSummary) {
      const pullAction = fileActions.find((a) => a.type === "pullback");
      if (pullAction?.instance) {
        void pullbackFileInstance(detailFile, pullAction.instance as DiffInstanceRef);
      }
      return;
    }

    // Enter - select
    if (key.return) {
      if (detailFile) {
        handleFileAction(actionIndex);
        return;
      }

      if (detailPlugin) {
        handlePluginAction(actionIndex);
        return;
      }

      if (detailPiPackage) {
        handlePiPackageAction(actionIndex);
        return;
      }

      if (detailMarketplace) {
        handleMarketplaceAction(actionIndex);
        return;
      }

      if (detailPiMarketplace) {
        handlePiMarketplaceAction(actionIndex);
        return;
      }

      if (detailTool) {
        return;
      }

      // Handle sub-view selection (Enter on item in sub-view opens detail)
      if (discoverSubView) {
        if (discoverSubView === "plugins") {
          const list = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
          const plugin = list[subViewIndex];
          if (plugin) {
            setDetailPlugin(plugin);
            setActionIndex(0);
          }
        } else if (discoverSubView === "piPackages") {
          const pkg = filteredPiPackages[subViewIndex];
          if (pkg) {
            setDetailPiPackage(pkg);
            setActionIndex(0);
          }
        }
        return;
      }

      if (tab === "marketplaces") {
        if (selectedIndex === 0) {
          setShowAddMarketplace(true);
          return;
        }
        if (selectedIndex <= marketplaces.length) {
          const m = marketplaces[selectedIndex - 1];
          if (m) {
            setDetailMarketplace(m);
            setActionIndex(0);
          }
          return;
        }
        if (!showPiFeatures) {
          return;
        }
        if (selectedIndex === piSectionOffset) {
          setShowAddPiMarketplace(true);
          return;
        }
        const piIdx = selectedIndex - piSectionOffset - 1;
        const pm = piMarketplaces[piIdx];
        if (pm) {
          setDetailPiMarketplace(pm);
          setActionIndex(0);
        }
        return;
      }

      if (tab === "tools") {
        const tool = managedTools[selectedIndex];
        if (tool) {
          setDetailToolKey(`${tool.toolId}:${tool.instanceId}`);
        }
        return;
      }

      if (tab === "sync" && !diffTarget && !missingSummary) {
        const item = syncPreview[selectedIndex];
        if (item) {
          if (item.kind === "plugin") {
            setDetailPlugin(item.plugin);
            setActionIndex(0);
          } else if (item.kind === "tool") {
            const tool = managedTools.find((entry) => entry.toolId === item.toolId);
            if (tool) {
              setDetailToolKey(`${tool.toolId}:${tool.instanceId}`);
            }
          } else if (item.kind === "file") {
            setDetailFile(item.file);
            setActionIndex(0);
          }
        }
        return;
      }

      if (selectedLibraryItem?.kind === "plugin") {
        setDetailPlugin(selectedLibraryItem.plugin);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "piPackage") {
        setDetailPiPackage(selectedLibraryItem.piPackage);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "file") {
        setDetailFile(selectedLibraryItem.file);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "pluginSummary") {
        // Open plugins sub-view
        setDiscoverSubView("plugins");
        setSubViewIndex(0);
      } else if (selectedLibraryItem?.kind === "piPackageSummary") {
        // Open Pi packages sub-view
        setDiscoverSubView("piPackages");
        setSubViewIndex(0);
      }
      return;
    }

    // Space - toggle install/uninstall
    if (input === " " && !detailPlugin && !detailFile && !detailMarketplace && !detailPiMarketplace && !detailPiPackage && !detailTool && !diffTarget && !missingSummary) {
      if (tab === "sync") {
        const item = syncPreview[selectedIndex];
        if (!item) return;
        const key = getSyncItemKey(item);
        setSyncSelection((current) => {
          const next = new Set(current);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        setSyncArmed(false);
        return;
      }

      if (tab === "tools") {
        const tool = managedTools[selectedIndex];
        if (tool) {
          void toggleToolEnabled(tool.toolId, tool.instanceId);
        }
        return;
      }

      // Handle Space for marketplaces (toggle enabled)
      if (tab === "marketplaces") {
        if (selectedIndex >= 1 && selectedIndex <= marketplaces.length) {
          const m = marketplaces[selectedIndex - 1];
          if (m) {
            void toggleMarketplaceEnabled(m.name);
          }
          return;
        }
        if (showPiFeatures && selectedIndex > piSectionOffset) {
          const piIdx = selectedIndex - piSectionOffset - 1;
          const pm = piMarketplaces[piIdx];
          if (pm) {
            void togglePiMarketplaceEnabled(pm.name);
          }
          return;
        }
      }

      // Handle Space in sub-views
      if (discoverSubView === "plugins") {
        const plugin = filteredPlugins[subViewIndex];
        if (plugin) {
          if (plugin.installed) {
            doUninstall(plugin);
          } else {
            doInstall(plugin);
          }
        }
        return;
      }

      if (discoverSubView === "piPackages") {
        const pkg = filteredPiPackages[subViewIndex];
        if (pkg) {
          if (pkg.installed) {
            doUninstallPiPkg(pkg);
          } else {
            doInstallPiPkg(pkg);
          }
        }
        return;
      }

      if (selectedLibraryItem?.kind === "plugin") {
        const plugin = selectedLibraryItem.plugin;
        if (plugin.installed) {
          doUninstall(plugin);
        } else {
          doInstall(plugin);
        }
      } else if (selectedLibraryItem?.kind === "piPackage") {
        const pkg = selectedLibraryItem.piPackage;
        if (pkg.installed) {
          doUninstallPiPkg(pkg);
        } else {
          doInstallPiPkg(pkg);
        }
      }
      return;
    }

    // Shortcuts
    if (tab === "tools" || detailTool) {
      const tool = detailTool || managedTools[selectedIndex];
      const detection = tool ? toolDetection[tool.toolId] : null;

      if (input === "i" && tool && (!detection || !detection.installed)) {
        setToolModalAction("install");
        setToolModalWarning(null);
        setToolModalMigrate(false);
        setToolModalDone(false);
        setToolModalSuccess(false);
        return;
      }

      if (input === "u" && tool && detection?.installed && detection.hasUpdate) {
        setToolModalAction("update");
        setToolModalWarning(null);
        setToolModalMigrate(false);
        setToolModalDone(false);
        setToolModalSuccess(false);
        return;
      }

      if (input === "d" && tool && detection?.installed) {
        setToolModalAction("uninstall");
        setToolModalWarning(null);
        setToolModalMigrate(false);
        setToolModalDone(false);
        setToolModalSuccess(false);
        return;
      }

      if (input === "m" && tool && detection?.installed) {
        const path = detection.binaryPath || "";
        const detectedMethod =
          path.startsWith("/opt/homebrew/") || path.startsWith("/usr/local/") ? "brew" : "unknown";
        const canMigrate = detectedMethod === "brew";
        if (canMigrate) {
          setToolModalAction("update");
          setToolModalWarning(null);
          setToolModalMigrate(true);
          setToolModalDone(false);
          setToolModalSuccess(false);
        }
        return;
      }

      if (input === "e" && tool) {
        setEditingToolId(`${tool.toolId}:${tool.instanceId}`);
        return;
      }

      if (input === " " && tool) {
        void toggleToolEnabled(tool.toolId, tool.instanceId);
        return;
      }
    }

    if (input === "u" && tab === "marketplaces" && !detailMarketplace && !detailPiMarketplace) {
      if (selectedIndex >= 1 && selectedIndex <= marketplaces.length) {
        const m = marketplaces[selectedIndex - 1];
        if (m) updateMarketplace(m.name);
      }
      return;
    }

    if (input === "r" && tab === "marketplaces" && !detailMarketplace && !detailPiMarketplace) {
      if (selectedIndex >= 1 && selectedIndex <= marketplaces.length) {
        const m = marketplaces[selectedIndex - 1];
        if (m && m.source !== "claude") removeMarketplace(m.name);
      } else if (showPiFeatures && selectedIndex > piSectionOffset) {
        const piIdx = selectedIndex - piSectionOffset - 1;
        const pm = piMarketplaces[piIdx];
        if (pm && !pm.builtIn) {
          void removePiMarketplace(pm.name);
        }
      }
      return;
    }

    if (input === "y" && tab === "sync" && !detailPlugin && !detailMarketplace && !diffTarget && !missingSummary) {
      if (syncArmed) {
        const items = syncPreview.filter((item) => syncSelection.has(getSyncItemKey(item)));
        if (items.length === 0) {
          notify("Select at least one item to sync.", "warning");
          setSyncArmed(false);
          return;
        }
        void syncTools(items);
        setSyncArmed(false);
        return;
      }
      setSyncArmed(true);
      return;
    }

    // Open diff/missing summary for sync items
    if (input === "d" && tab === "sync" && !detailPlugin && !detailMarketplace && !diffTarget && !missingSummary) {
      const item = syncPreview[selectedIndex];
      if (item) {
        openDiffFromSyncItem(item);
      }
      return;
    }

    // Open diff/missing summary for installed managed file entries
    if (input === "d" && tab === "installed" && !detailPlugin && !detailFile && !detailMarketplace && !detailPiMarketplace && !detailPiPackage && !detailTool && !diffTarget && !missingSummary && !discoverSubView) {
      if (selectedLibraryItem?.kind === "file") {
        openDiffFromSyncItem(toFileSyncItem(selectedLibraryItem.file));
        return;
      }
    }

    // Sort shortcuts (s to cycle sort, r to reverse) - only when search not focused
    if ((tab === "discover" || tab === "installed") && !detailPlugin && !detailFile && !searchFocused) {
      if (input === "s") {
        setSortBy((prev) => {
          if (prev === "default") {
            setSortDir("asc");
            return "name";
          }
          if (prev === "name") return "installed";
          if (prev === "installed") {
            // Default to descending for popularity (most popular first)
            setSortDir("desc");
            return "popularity";
          }
          // Back to default
          setSortDir("asc");
          return "default";
        });
        return;
      }
      if (input === "r") {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
    }
  });

  const handleFileAction = async (index: number) => {
    if (!detailFile) return;
    const action = fileActions[index];
    if (!action) return;

    switch (action.type) {
      case "diff":
        if (action.instance) {
          openDiffForFile(detailFile, action.instance as DiffInstanceRef);
        }
        break;
      case "missing":
        if (action.instance) {
          openMissingSummaryForFile(detailFile, action.instance as DiffInstanceRef);
        }
        break;
      case "sync":
        await syncTools([toFileSyncItem(detailFile)]);
        break;
      case "pullback":
        if (action.instance) {
          await pullbackFileInstance(detailFile, action.instance as DiffInstanceRef);
        }
        break;
      case "back":
        setDetailFile(null);
        setActionIndex(0);
        break;
      case "status":
        break;
    }
  };

  const handlePluginAction = async (index: number) => {
    if (!detailPlugin) return;
    const actions = getPluginActions(detailPlugin);
    const action = actions[index];
    if (!action) return;

    switch (action) {
      case "Uninstall":
        await doUninstall(detailPlugin);
        refreshDetailPlugin(detailPlugin);
        break;
      case "Update now":
        await doUpdate(detailPlugin);
        refreshDetailPlugin(detailPlugin);
        break;
      case "Install to all tools":
      case "Install":
        await doInstall(detailPlugin);
        refreshDetailPlugin(detailPlugin);
        break;
      case "Manage components":
        setComponentManagerMode(true);
        setComponentIndex(0);
        break;
      case "Back to plugin list":
        setDetailPlugin(null);
        setActionIndex(0);
        break;
      default:
        break;
    }
  };

  const handlePiPackageAction = async (index: number) => {
    if (!detailPiPackage) return;
    const actions = getPiPackageActions(detailPiPackage);
    const action = actions[index];
    if (!action) return;

    switch (action.type) {
      case "install":
        await doInstallPiPkg(detailPiPackage);
        refreshDetailPiPackage(detailPiPackage);
        break;
      case "uninstall":
        await doUninstallPiPkg(detailPiPackage);
        refreshDetailPiPackage(detailPiPackage);
        break;
      case "update":
        await doUpdatePiPkg(detailPiPackage);
        refreshDetailPiPackage(detailPiPackage);
        break;
      case "back":
        setDetailPiPackage(null);
        setActionIndex(0);
        break;
    }
  };

  const handlePiMarketplaceAction = (index: number) => {
    if (!detailPiMarketplace) return;
    const actions = getPiMarketplaceActions(detailPiMarketplace);
    const action = actions[index];
    if (!action) return;

    switch (action) {
      case "browse":
        setDiscoverSubView("piPackages");
        setSubViewIndex(0);
        setTab("discover");
        setDetailPiMarketplace(null);
        break;
      case "remove":
        void removePiMarketplace(detailPiMarketplace.name);
        setDetailPiMarketplace(null);
        break;
      case "back":
        setDetailPiMarketplace(null);
        setActionIndex(0);
        break;
    }
  };

  const handleMarketplaceAction = (index: number) => {
    if (!detailMarketplace) return;
    const isReadOnly = detailMarketplace.source === "claude";

    switch (index) {
      case 0: // Browse plugins (stay in Marketplaces flow)
        setMarketplaceBrowseContext(detailMarketplace);
        setDiscoverSubView("plugins");
        setSubViewIndex(0);
        setSearch(detailMarketplace.name);
        setDetailMarketplace(null);
        break;
      case 1: // Update
        void updateMarketplace(detailMarketplace.name);
        break;
      case 2: // Remove (only for non-Claude marketplaces)
        if (!isReadOnly) {
          removeMarketplace(detailMarketplace.name);
          setDetailMarketplace(null);
        }
        break;
    }
  };

  const statusMessage = loading
    ? "Loading..."
    : `${allPlugins.length} plugins, ${piPackages.length} pi-pkgs, ${fileTotalCount} files from ${marketplaces.length} marketplaces`;

  const showGlobalLoadingIndicator = loading || tabRefreshInProgress;
  const shouldShowDiscoverLoading =
    loading && marketplaces.length === 0 && piPackages.length === 0;
  const shouldShowInstalledLoading =
    loading &&
    installedPlugins.length === 0 &&
    piPackages.filter((pkg) => pkg.installed).length === 0 &&
    installedFileCount === 0;
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
    setToolModalRunning(true);
    setToolModalDone(false);

    const success =
      action === "install"
        ? await installToolAction(tool.toolId, { migrate })
        : action === "update"
          ? await updateToolAction(tool.toolId, { migrate })
          : await uninstallToolAction(tool.toolId);

    setToolModalRunning(false);
    setToolModalDone(true);
    setToolModalSuccess(success);
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
      ) : showAddMarketplace ? (
        <AddMarketplaceModal
          onSubmit={handleAddMarketplace}
          onCancel={() => setShowAddMarketplace(false)}
        />
      ) : showAddPiMarketplace ? (
        <AddMarketplaceModal
          type="pi"
          onSubmit={(name, source) => {
            void addPiMarketplace(name, source);
            setShowAddPiMarketplace(false);
          }}
          onCancel={() => setShowAddPiMarketplace(false)}
        />
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
      ) : detailPlugin ? (
        <PluginDetail
          plugin={detailPlugin}
          selectedAction={actionIndex}
          onAction={() => {}}
        />
      ) : detailMarketplace ? (
        <MarketplaceDetail
          marketplace={detailMarketplace}
          selectedIndex={actionIndex}
        />
      ) : detailPiMarketplace ? (
        <PiMarketplaceDetail
          marketplace={detailPiMarketplace}
          selectedIndex={actionIndex}
        />
      ) : detailFile ? (
        <FileDetail
          file={detailFile}
          selectedAction={actionIndex}
          actions={fileActions}
        />
      ) : detailPiPackage ? (
        <PiPackageDetail
          pkg={detailPiPackage}
          selectedIndex={actionIndex}
        />
      ) : (
        <Box flexDirection="column" height={tab === "sync" ? 19 : (tab === "discover" || tab === "installed") ? 20 : 25}>
          {(tab === "discover" || tab === "installed") && (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexGrow={1}>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder={
                    tab === "discover"
                      ? "Search plugins..."
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
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading plugins from marketplaces...</Text>
                </Box>
              ) : discoverSubView === "plugins" ? (
                // Plugins sub-view - full list
                <Box flexDirection="column">
                  <Box marginBottom={1}>
                    <Text color="cyan" bold>Plugins </Text>
                    <Text color="gray" dimColor>{getRange(subViewIndex, filteredPlugins.length, 12)}</Text>
                    <Text color="gray"> · Press Esc to go back</Text>
                  </Box>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={subViewIndex}
                    maxHeight={12}
                    nameColumnWidth={libraryNameWidth}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                </Box>
              ) : discoverSubView === "piPackages" ? (
                // Pi Packages sub-view - full list
                <Box flexDirection="column">
                  <Box marginBottom={1}>
                    <Text color="cyan" bold>Pi Packages </Text>
                    <Text color="gray" dimColor>{getRange(subViewIndex, filteredPiPackages.length, 12)}</Text>
                    <Text color="gray"> · Press Esc to go back</Text>
                  </Box>
                  <PiPackageList
                    packages={filteredPiPackages}
                    selectedIndex={subViewIndex}
                    maxHeight={12}
                    nameColumnWidth={libraryNameWidth}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
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
            <>
              {shouldShowInstalledLoading ? (
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading installed plugins...</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {filteredFiles.length > 0 && (
                    <Box flexDirection="column">
                      <Box>
                        <Text color="gray">  Files </Text>
                        <Text color="gray" dimColor>{getRange(selectedIndex < fileCount ? selectedIndex : 0, filteredFiles.length, 5)}</Text>
                      </Box>
                      <FileList
                        files={filteredFiles}
                        selectedIndex={selectedIndex < fileCount ? selectedIndex : -1}
                        maxHeight={5}
                        nameColumnWidth={libraryNameWidth}
                        scopeColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredPlugins.length > 0 && (
                    <Box flexDirection="column" marginTop={filteredFiles.length > 0 ? 1 : 0}>
                      <Box>
                        <Text color="gray">  Plugins </Text>
                        <Text color="gray" dimColor>{getRange(selectedIndex >= fileCount && selectedIndex < fileCount + pluginCount ? selectedIndex - fileCount : 0, filteredPlugins.length, 4)}</Text>
                      </Box>
                      <PluginList
                        plugins={filteredPlugins}
                        selectedIndex={selectedIndex >= fileCount && selectedIndex < fileCount + pluginCount ? selectedIndex - fileCount : -1}
                        maxHeight={4}
                        nameColumnWidth={libraryNameWidth}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredPiPackages.length > 0 && (
                    <Box flexDirection="column" marginTop={(filteredFiles.length > 0 || filteredPlugins.length > 0) ? 1 : 0}>
                      <Box>
                        <Text color="gray">  Pi Packages </Text>
                        <Text color="gray" dimColor>{getRange(selectedIndex >= fileCount + pluginCount ? selectedIndex - fileCount - pluginCount : 0, filteredPiPackages.length, 3)}</Text>
                      </Box>
                      <PiPackageList
                        packages={filteredPiPackages}
                        selectedIndex={selectedIndex >= fileCount + pluginCount ? selectedIndex - fileCount - pluginCount : -1}
                        maxHeight={3}
                        nameColumnWidth={libraryNameWidth}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                </Box>
              )}
            </>
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
                  <PluginList
                    plugins={marketplaceBrowsePlugins}
                    selectedIndex={subViewIndex}
                    maxHeight={12}
                    nameColumnWidth={libraryNameWidth}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                  <Box marginTop={1}>
                    <PluginPreview plugin={marketplaceBrowsePlugins[subViewIndex]} />
                  </Box>
                </Box>
              ) : (
                <Box flexDirection="column">
                  <MarketplaceList
                    marketplaces={marketplaces}
                    selectedIndex={selectedIndex <= marketplaces.length ? selectedIndex : -1}
                  />

                  {showPiFeatures && (
                    <Box marginTop={1}>
                      <PiMarketplaceList
                        marketplaces={piMarketplaces}
                        selectedIndex={selectedIndex}
                        indexOffset={piSectionOffset}
                      />
                    </Box>
                  )}
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

      {(tab === "discover" || tab === "installed") && !detailPlugin && !detailFile && !detailMarketplace && !detailPiPackage && !detailTool && (
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

      {tab === "sync" && !detailPlugin && !detailMarketplace && !detailPiPackage && !detailTool && (
        <SyncPreview item={syncPreview[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar
        tab={tab}
        hasDetail={Boolean(detailPlugin || detailFile || detailMarketplace || detailPiMarketplace || detailPiPackage || detailTool)}
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
