import React, { useEffect, useState, useMemo, useRef } from "react";
import { join, dirname } from "path";
import { existsSync, lstatSync, rmSync, cpSync, copyFileSync, mkdirSync } from "fs";
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
import { ToolsTab } from "./tabs/ToolsTab.js";
import { SettingsTab } from "./tabs/SettingsTab.js";
import { MarketplacesTab } from "./tabs/MarketplacesTab.js";
import { SyncTab } from "./tabs/SyncTab.js";
import { DiscoverTab } from "./tabs/DiscoverTab.js";
import { InstalledTab } from "./tabs/InstalledTab.js";
import { getPluginToolStatus, togglePluginComponent } from "./lib/plugin-status.js";
import {
  syncPluginInstances,
  uninstallPluginFromInstance,
  uninstallSkillAllInstances,
  uninstallSkillFromInstance,
  installSkillToInstance,
  installSkillToAllMissing,
  pullbackSkillToSource,
  deleteSkillEverywhere,
  deletePluginEverywhere,
  deleteFileEverywhere,
} from "./lib/install.js";
import { resolvePluginSourcePaths, type PluginDrift } from "./lib/plugin-drift.js";
import { computeItemDrift } from "./lib/item-drift.js";
import { buildFileDiffTarget } from "./lib/diff.js";
import { getToolLifecycleCommand, detectInstallMethodMismatch } from "./lib/tool-lifecycle.js";
import { getPackageManager } from "./lib/config.js";
import { setupSourceRepository, shouldShowSourceSetupWizard } from "./lib/source-setup.js";
import { ItemList, FILE_COLUMNS, PLUGIN_COLUMNS } from "./components/ItemList.js";
import { ItemDetail, PluginMetadata, FileMetadata, PiPackageMetadata, SkillMetadata, type ItemAction } from "./components/ItemDetail.js";
import { pluginToManagedItem, fileToManagedItem, piPackageToManagedItem } from "./lib/managed-item.js";
import type { ManagedItem } from "./lib/managed-item.js";
import { getMarketplaceDetailActions, type MarketplaceDetailContext } from "./lib/marketplace-detail.js";
import { buildMarketplaceRows, type MarketplaceRow } from "./lib/marketplace-row.js";
import { useDetailInput, useDiffInput, useListInput } from "./lib/input-hooks.js";
import { handleItemAction } from "./lib/action-dispatch.js";
import type { Tab, SyncPreviewItem, Plugin, PiPackage, PiMarketplace, DiffInstanceRef, DiscoverSection, DiscoverSubView, ManagedToolRow, FileStatus, Marketplace } from "./lib/types.js";
import { countAppRender } from "./lib/perf.js";

const TABS: Tab[] = ["sync", "tools", "discover", "installed", "marketplaces", "settings"];
const TAB_REFRESH_TTL_MS = 30000;

export function App() {
  countAppRender();
  const { exit } = useApp();

  // ── Navigation ──
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  // ── Search / Selection ──
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const setSelectedIndex = useStore((s) => s.setSelectedIndex);

  // ── Loading / Error ──
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  // ── Data: Marketplaces & Plugins ──
  const marketplaces = useStore((s) => s.marketplaces);
  const installedPlugins = useStore((s) => s.installedPlugins);
  const standaloneSkills = useStore((s) => s.standaloneSkills);
  const installedPluginsLoaded = useStore((s) => s.installedPluginsLoaded);

  // ── Data: Files ──
  const files = useStore((s) => s.files);
  const filesLoaded = useStore((s) => s.filesLoaded);

  // ── Data: Tools ──
  const tools = useStore((s) => s.tools);
  const managedTools = useStore((s) => s.managedTools);
  const toolDetection = useStore((s) => s.toolDetection);
  const toolDetectionPending = useStore((s) => s.toolDetectionPending);
  const toolActionInProgress = useStore((s) => s.toolActionInProgress);
  const toolActionOutput = useStore((s) => s.toolActionOutput);

  // ── Data: Pi Packages ──
  const piPackages = useStore((s) => s.piPackages);
  const piPackagesLoaded = useStore((s) => s.piPackagesLoaded);
  const piMarketplaces = useStore((s) => s.piMarketplaces);

  // ── Data: Managed Items (legacy bridge) ──
  const managedItems = useStore((s) => s.managedItems);

  // ── Detail State (unified) ──
  // Single discriminated-union state for the currently-open detail view.
  // Replaces the previous detailPlugin / detailFile / detailSkill / detailPiPackage states.
  const detail = useStore((s) => s.detail);
  const setDetail = useStore((s) => s.setDetail);
  const refreshDetail = useStore((s) => s.refreshDetail);

  // Convenience accessors (computed views into `detail` for backward-compat with existing code).
  const detailPlugin = detail?.kind === "plugin" ? detail.data : null;
  const detailFile = detail?.kind === "file" ? detail.data : null;
  const detailSkill = detail?.kind === "skill" ? detail.data : null;
  const detailPiPackage = detail?.kind === "piPackage" ? detail.data : null;
  const detailPluginDrift = detail?.kind === "plugin" ? (detail.drift ?? null) : null;
  // Setters that delegate to the unified setDetail.
  const setDetailPlugin = (p: Plugin | null) => setDetail(p ? { kind: "plugin", data: p, drift: detailPluginDrift ?? undefined } : null);
  const setDetailFile = (f: FileStatus | null) => setDetail(f ? { kind: "file", data: f } : null);
  const setDetailSkill = (s: import("./lib/install.js").StandaloneSkill | null) => setDetail(s ? { kind: "skill", data: s } : null);
  const setDetailPluginDrift = (drift: PluginDrift | null) => {
    if (detail?.kind !== "plugin") return;
    setDetail({ kind: "plugin", data: detail.data, drift: drift ?? undefined });
  };

  const detailMarketplace = useStore((s) => s.detailMarketplace);
  const setDetailMarketplace = useStore((s) => s.setDetailMarketplace);
  // detailPiPackage now derived from `detail` above. The store still has a setDetailPiPackage
  // that fetches npm version info async; route through it for piPackages specifically.
  const setDetailPiPackageRaw = useStore((s) => s.setDetailPiPackage);
  const setDetailPiPackage = async (pkg: PiPackage | null) => {
    await setDetailPiPackageRaw(pkg);
    // Mirror into unified detail.
    if (pkg) setDetail({ kind: "piPackage", data: pkg });
    else if (detail?.kind === "piPackage") setDetail(null);
  };

  // ── Diff View ──
  const diffTarget = useStore((s) => s.diffTarget);
  const missingSummary = useStore((s) => s.missingSummary);
  const openDiffForFile = useStore((s) => s.openDiffForFile);
  const openMissingSummaryForFile = useStore((s) => s.openMissingSummaryForFile);
  const openDiffFromSyncItem = useStore((s) => s.openDiffFromSyncItem);
  const closeDiff = useStore((s) => s.closeDiff);
  const closeMissingSummary = useStore((s) => s.closeMissingSummary);
  const pullbackFileInstance = useStore((s) => s.pullbackFileInstance);

  // ── Section Navigation ──
  const currentSection = useStore((s) => s.currentSection);
  const setCurrentSection = useStore((s) => s.setCurrentSection);
  const discoverSubView = useStore((s) => s.discoverSubView);
  const setDiscoverSubView = useStore((s) => s.setDiscoverSubView);

  // ── Notifications (used in input handler) ──
  const notifications = useStore((s) => s.notifications);

  // ── Actions (stable references — selectors here for explicitness) ──
  const loadMarketplaces = useStore((s) => s.loadMarketplaces);
  const loadInstalledPlugins = useStore((s) => s.loadInstalledPlugins);
  const loadFiles = useStore((s) => s.loadFiles);
  const refreshManagedTools = useStore((s) => s.refreshManagedTools);
  const refreshToolDetection = useStore((s) => s.refreshToolDetection);
  const doInstall = useStore((s) => s.installPlugin);
  const doUninstall = useStore((s) => s.uninstallPlugin);
  const doUpdate = useStore((s) => s.updatePlugin);
  const updateMarketplace = useStore((s) => s.updateMarketplace);
  const toggleMarketplaceEnabled = useStore((s) => s.toggleMarketplaceEnabled);
  const removeMarketplace = useStore((s) => s.removeMarketplace);
  const addMarketplace = useStore((s) => s.addMarketplace);
  const toggleToolEnabled = useStore((s) => s.toggleToolEnabled);
  const updateToolConfigDir = useStore((s) => s.updateToolConfigDir);
  const installToolAction = useStore((s) => s.installToolAction);
  const updateToolAction = useStore((s) => s.updateToolAction);
  const uninstallToolAction = useStore((s) => s.uninstallToolAction);
  const cancelToolAction = useStore((s) => s.cancelToolAction);
  const getSyncPreview = useStore((s) => s.getSyncPreview);
  const syncTools = useStore((s) => s.syncTools);
  const notify = useStore((s) => s.notify);
  const clearNotification = useStore((s) => s.clearNotification);
  const loadPiPackages = useStore((s) => s.loadPiPackages);
  const refreshAll = useStore((s) => s.refreshAll);
  const doInstallPiPkg = useStore((s) => s.installPiPackage);
  const doUninstallPiPkg = useStore((s) => s.uninstallPiPackage);
  const doUpdatePiPkg = useStore((s) => s.updatePiPackage);
  const doRepairPiPkg = useStore((s) => s.repairPiPackage);
  const togglePiMarketplaceEnabled = useStore((s) => s.togglePiMarketplaceEnabled);
  const addPiMarketplace = useStore((s) => s.addPiMarketplace);
  const removePiMarketplace = useStore((s) => s.removePiMarketplace);

  const [actionIndex, setActionIndex] = useState(0);
  const [componentManagerMode, setComponentManagerMode] = useState(false);
  const [componentIndex, setComponentIndex] = useState(0);
  // detailPluginDrift / detailFile / detailSkill are now derived from `detail` above.
  const pluginDriftMap = useStore((s) => s.pluginDriftMap);
  const setPluginDriftMap = useStore((s) => s.setPluginDriftMap);
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
  const sortBy = useStore((s) => s.sortBy);
  const sortDir = useStore((s) => s.sortDir);
  const setSortBy = useStore((s) => s.setSortBy);
  const setSortDir = useStore((s) => s.setSortDir);
  const syncArmed = useStore((s) => s.syncArmed);
  const setSyncArmed = useStore((s) => s.setSyncArmed);
  const syncSelection = useStore((s) => s.syncSelection);
  const toggleSyncSelection = useStore((s) => s.toggleSyncSelection);
  const [searchFocused, setSearchFocused] = useState(false);
  const syncPreview = useMemo(() => getSyncPreview(), [getSyncPreview]);
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



  const effectiveInstalledPlugins = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _plugin: Plugin } => item.kind === "plugin" && !!item._plugin)
      .map((item) => item._plugin);
    return fromManaged.length > 0 ? fromManaged : installedPlugins;
  }, [managedItems, installedPlugins]);

  const effectiveFiles = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _file: FileStatus } =>
        (item.kind === "file" || item.kind === "config" || item.kind === "asset") && !!item._file)
      .map((item) => item._file);
    return fromManaged.length > 0 ? fromManaged : files;
  }, [managedItems, files]);

  const effectivePiPackages = useMemo(() => {
    const fromManaged = managedItems
      .filter((item): item is ManagedItem & { _piPackage: PiPackage } => item.kind === "pi-package" && !!item._piPackage)
      .map((item) => item._piPackage);
    return fromManaged.length > 0 ? fromManaged : piPackages;
  }, [managedItems, piPackages]);

  const toFileSyncItem = (file: typeof effectiveFiles[number]): SyncPreviewItem => {
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
          // Sync: load plugins/tools first (fast), then files in background (slow).
          refreshManagedTools();
          await Promise.all([loadInstalledPlugins(), refreshToolDetection()]);
          void loadFiles(); // background — files are slow, don't block UI
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

  // Manual-only mode: do not auto-load anything on startup.
  // User triggers loading explicitly with "R" on the current tab.
  useEffect(() => {
    // Intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detailFile) return;
    const refreshed = effectiveFiles.find((f) => f.name === detailFile.name);
    if (refreshed && refreshed !== detailFile) {
      setDetailFile(refreshed);
    }
  }, [files, detailFile]);

  // Manual-only mode: skip expensive background drift scans.
  // Drift is still computed on-demand when opening plugin detail.
  useEffect(() => {
    setPluginDriftMap({});
  }, [setPluginDriftMap]);

  useEffect(() => {
    if (!syncArmed) return;
    const timeoutId = setTimeout(() => {
      setSyncArmed(false);
    }, 1500);
    return () => clearTimeout(timeoutId);
  }, [syncArmed]);

  const getSyncItemKey = (item: import("./lib/types.js").SyncPreviewItem) => {
    if (item.kind === "plugin") return `plugin:${item.plugin.marketplace}:${item.plugin.name}`;
    if (item.kind === "tool") return `tool:${item.toolId}`;
    if (item.kind === "skill") return `skill:${item.skill.name}`;
    return `file:${item.file.name}`;
  };

  const selectedSyncCount = useMemo(() => {
    let count = 0;
    for (const item of syncPreview) {
      if (syncSelection.includes(getSyncItemKey(item))) count += 1;
    }
    return count;
  }, [syncPreview, syncSelection]);


  const allPlugins = useMemo(() => {
    return marketplaces.flatMap((m) => m.plugins);
  }, [marketplaces]);

  const filteredPlugins = useMemo(() => {
    if (tab !== "discover" && tab !== "installed") return [];

    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? effectiveInstalledPlugins : allPlugins;
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
  }, [tab, allPlugins, effectiveInstalledPlugins, search, sortBy, sortDir]);

  const marketplaceBrowsePlugins = useMemo(() => {
    if (!marketplaceBrowseContext) return filteredPlugins;
    return filteredPlugins.filter((p) => p.marketplace === marketplaceBrowseContext.name);
  }, [filteredPlugins, marketplaceBrowseContext]);

  const managedBrowsePlugins = useMemo(
    () => marketplaceBrowsePlugins.map((p) => pluginToManagedItem(p)),
    [marketplaceBrowsePlugins],
  );

  const filteredPiPackages = useMemo(() => {
    if (tab !== "discover" && tab !== "installed") return [];

    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? effectivePiPackages.filter((p) => p.installed) : effectivePiPackages;
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
  }, [tab, effectivePiPackages, search, sortBy, sortDir]);

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
    if (tab !== "installed") return [];

    const q = search.trim().toLowerCase();

    const filtered =
      q.length === 0
        ? effectiveFiles
        : effectiveFiles.filter((file) => {
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
  }, [tab, effectiveFiles, search, sortBy, sortDir]);

  const fileTotalCount = effectiveFiles.length;
  const installedFileCount = useMemo(
    () => effectiveFiles.filter(isInstalledFile).length,
    [effectiveFiles]
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

  const filteredStandaloneSkills = useMemo(() => {
    if (tab !== "installed") return [];
    const lowerSearch = search.toLowerCase();
    return search
      ? standaloneSkills.filter((s) => s.name.toLowerCase().includes(lowerSearch))
      : standaloneSkills;
  }, [tab, standaloneSkills, search]);

  const fileCount = filteredFiles.length;
  const skillCount = filteredStandaloneSkills.length;
  const pluginCount = filteredPlugins.length;
  const piPkgCount = filteredPiPackages.length;

  // In Discover tab: Plugins and PiPackages are summary cards (1 item each if they have content)
  // In Installed tab: sections are inline lists
  const pluginSectionCount = tab === "discover" ? (pluginCount > 0 ? 1 : 0) : pluginCount;
  const piPkgSectionCount = tab === "discover" ? (piPkgCount > 0 ? 1 : 0) : piPkgCount;

  const libraryCount = tab === "installed"
    ? fileCount + skillCount + pluginCount + piPkgCount
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
      if (skillCount > 0) {
        result.push({ id: "skills", start: offset, end: offset + skillCount - 1 });
        offset += skillCount;
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
  }, [tab, fileCount, skillCount, pluginCount, piPkgCount, pluginSectionCount, piPkgSectionCount]);

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
      | { kind: "skill"; skill: import("./lib/install.js").StandaloneSkill }
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

      // Installed tab - inline lists (visual order: files, skills, plugins, piPackages)
      if (selectedIndex < fileCount) {
        const file = filteredFiles[selectedIndex];
        return file ? { kind: "file", file } : null;
      }

      if (selectedIndex < fileCount + skillCount) {
        const skill = filteredStandaloneSkills[selectedIndex - fileCount];
        return skill ? { kind: "skill", skill } : null;
      }

      if (selectedIndex < fileCount + skillCount + pluginCount) {
        const plugin = filteredPlugins[selectedIndex - fileCount - skillCount];
        return plugin ? { kind: "plugin", plugin } : null;
      }

      const piPkg =
        filteredPiPackages[selectedIndex - fileCount - skillCount - pluginCount];
      return piPkg ? { kind: "piPackage", piPackage: piPkg } : null;
    },
    [
      tab,
      selectedIndex,
      filteredPlugins,
      filteredFiles,
      filteredPiPackages,
      fileCount,
      skillCount,
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

  const detailSkillItem = useMemo((): ManagedItem | null => {
    if (!detailSkill) return null;
    const uniqueTools = Array.from(new Set(detailSkill.installations.map((i) => i.toolId)));
    const isInstalled = detailSkill.installations.length > 0;
    return {
      name: detailSkill.name,
      kind: "file" as const,
      marketplace: isInstalled ? uniqueTools.join(", ") : "source only",
      description: `Standalone skill`,
      installed: isInstalled,
      incomplete: false,
      scope: "user" as const,
      tools: uniqueTools,
      instances: detailSkill.installations.map((i) => ({
        toolId: i.toolId,
        instanceId: i.instanceId,
        instanceName: i.instanceName,
        configDir: i.diskPath,
        status: "synced" as const,
        sourcePath: i.diskPath,
        targetPath: i.diskPath,
        linesAdded: 0,
        linesRemoved: 0,
      })),
      _skill: detailSkill,
    };
  }, [detailSkill]);

  const detailPiPkgItem = useMemo((): ManagedItem | null => {
    if (!detailPiPackage) return null;
    return piPackageToManagedItem(detailPiPackage);
  }, [detailPiPackage]);

  /** Active detail context — the currently-open entity + its actions + metadata node. */
  /**
   * Active detail — single switch on the unified `detail` union.
   * Returns the ManagedItem (for rendering), the action list (kind-specific via buildItemActions),
   * and the metadata node (per-kind small component).
   */
  const activeDetail = useMemo((): { item: ManagedItem; actions: ItemAction[]; metadata: React.ReactNode } | null => {
    if (!detail) return null;
    switch (detail.kind) {
      case "file": {
        if (!detailFileItem) return null;
        return { item: detailFileItem, actions: buildItemActions(detailFileItem), metadata: <FileMetadata item={detailFileItem} /> };
      }
      case "skill": {
        if (!detailSkillItem) return null;
        return { item: detailSkillItem, actions: buildItemActions(detailSkillItem), metadata: <SkillMetadata item={detailSkillItem} /> };
      }
      case "plugin": {
        if (!detailPluginItem) return null;
        const drift = detail.drift ?? pluginDriftMap[detail.data.name];
        return { item: detailPluginItem, actions: buildItemActions(detailPluginItem, drift), metadata: <PluginMetadata item={detailPluginItem} /> };
      }
      case "piPackage": {
        if (!detailPiPkgItem) return null;
        return { item: detailPiPkgItem, actions: buildItemActions(detailPiPkgItem), metadata: <PiPackageMetadata item={detailPiPkgItem} /> };
      }
    }
  }, [detail, detailFileItem, detailSkillItem, detailPluginItem, detailPiPkgItem, pluginDriftMap]);

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

  // Thin shims around the unified store.refreshDetail() for plugins (which need drift
  // recomputed) and piPackages (which need the legacy mirror updated).
  const refreshDetailPlugin = (plugin: Plugin) => {
    refreshDetail();
    // Recompute plugin drift after refresh.
    void computeItemDrift(pluginToManagedItem(plugin)).then((drift) => {
      if (drift.kind === "plugin") setDetailPluginDrift(drift.plugin);
    });
  };

  const refreshDetailPiPackage = (pkg: PiPackage) => {
    refreshDetail();
    // Legacy mirror for components that still subscribe to the old detailPiPackage field.
    const state = useStore.getState();
    const refreshed = state.piPackages.find((p) =>
      p.source === pkg.source ||
      (p.name === pkg.name && p.marketplace === pkg.marketplace)
    );
    void setDetailPiPackage(refreshed || pkg);
  };

  // ── Extracted input handlers ───────────────────────────────────────────

  const closeDetail = () => { setActionIndex(0); };
  const handleEscape = () => {
    // Any kind of item detail open? Close it via the unified setter.
    if (detail) {
      setDetail(null);
      setComponentManagerMode(false);
      closeDetail();
      return;
    }
    if (activeMarketplaceDetail) { setDetailMarketplace(null); setDetailPiMarketplace(null); closeDetail(); return; }
    if (detailTool) { setDetailToolKey(null); return; }
    if (discoverSubView) {
      if (tab === "marketplaces" && marketplaceBrowseContext) {
        setDiscoverSubView(null); setSubViewIndex(0);
        setDetailMarketplace(marketplaceBrowseContext); setMarketplaceBrowseContext(null); setSearch("");
      } else { setDiscoverSubView(null); setSubViewIndex(0); }
      return;
    }
    if (tab === "marketplaces" && marketplaceBrowseContext) {
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

    // Installed / Discover tabs — open item detail via the unified setter.
    // Only one detail can be open at a time; setDetail replaces any prior state.
    if (selectedLibraryItem?.kind === "plugin") {
      openPluginDetail(selectedLibraryItem.plugin);
    } else if (selectedLibraryItem?.kind === "piPackage") {
      void setDetailPiPackage(selectedLibraryItem.piPackage);
      setActionIndex(0);
    } else if (selectedLibraryItem?.kind === "file") {
      setDetail({ kind: "file", data: selectedLibraryItem.file });
      setActionIndex(0);
    } else if (selectedLibraryItem?.kind === "skill") {
      setDetail({ kind: "skill", data: selectedLibraryItem.skill });
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
    // If this plugin is installed, prefer the merged installed version — it has the
    // scanned hooks/components, not just what the marketplace declares. This matters
    // when entering from Marketplaces browse, where the plugin object comes straight
    // from marketplace metadata.
    const installedPlugins = useStore.getState().installedPlugins;
    const merged = installedPlugins.find(
      (p) => p.name === plugin.name && p.marketplace === plugin.marketplace,
    );
    const resolved = merged || plugin;
    setDetailPlugin(resolved); setDetailPluginDrift(null);
    void computeItemDrift(pluginToManagedItem(resolved)).then((drift) => {
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
      toggleSyncSelection(getSyncItemKey(item));
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
        const items = syncPreview.filter((item) => syncSelection.includes(getSyncItemKey(item)));
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
      if (!item) return true;
      if (item.kind === "plugin") {
        openPluginDetail(item.plugin);
      } else {
        openDiffFromSyncItem(item);
      }
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
    detailPlugin,
    actionIndex,
    diffTarget,
    missingSummary,
    setActionIndex,
    onEntityAction: (index) => { void handleEntityAction(index); },
    onMarketplaceAction: (index) => handleMarketplaceDetailAction(index),
    onPullbackFile: (file, instance) => { void pullbackFileInstance(file, instance); },
    onPullbackPlugin: (plugin, instance) => { void pullbackPluginInstanceCb(plugin, instance); },
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
    setSyncArmed: () => setSyncArmed(false),
    onOpenPluginDetail: openPluginDetail,
    onEnterList: handleEnterOnList,
    onSpaceToggle: handleSpaceToggle,
  });

  useInput((input, key) => {
    if (toolModalAction) { handleToolModalInput(input, key); return; }

    // Esc must always close the topmost overlay — it takes priority over notification
    // dismissal so users can back out even when a notification is showing.
    const stickyNotifications = notifications.filter(
      (n) => (n.type === "warning" || n.type === "error") && !n.spinner
    );
    if (key.escape) {
      stickyNotifications.forEach((n) => clearNotification(n.id));
      handleEscape();
      return;
    }

    // Sticky notifications (warnings/errors) are acknowledged with any other key.
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
        if (sortBy === "default") { setSortBy("name"); setSortDir("asc"); }
        else if (sortBy === "name") { setSortBy("installed"); }
        else if (sortBy === "installed") { setSortBy("popularity"); setSortDir("desc"); }
        else { setSortBy("default"); setSortDir("asc"); }
        return;
      }
      if (input === "r") {
        setSortDir(sortDir === "asc" ? "desc" : "asc");
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
    await useStore.getState().refreshAll({ silent: true });
  };

  // Uninstall plugin from specific tool instance (for unified dispatch)
  const uninstallPluginFromInstanceCb = async (plugin: Plugin, toolId: string, instanceId: string) => {
    const toolStatus = getPluginToolStatus(plugin).find((s) => s.toolId === toolId && s.instanceId === instanceId);
    const { notify: n, clearNotification: cn } = useStore.getState();
    const name = toolStatus?.name ?? instanceId;
    await withSpinner(`Uninstalling ${plugin.name} from ${name}...`,
      () => Promise.resolve(uninstallPluginFromInstance(plugin, toolId, instanceId)), n, cn);
    n(`✓ Uninstalled ${plugin.name} from ${name}`, "success");
    await useStore.getState().refreshAll({ silent: true });
  };

  const pullbackPluginInstanceCb = async (plugin: Plugin, instance: DiffInstanceRef) => {
    const { notify: n, clearNotification: cn } = useStore.getState();
    const sourcePaths = resolvePluginSourcePaths(plugin);
    if (!sourcePaths) {
      n(`✗ Cannot pull ${plugin.name}: source repo path not found`, "error");
      return false;
    }

    const tool = tools.find((t) => t.toolId === instance.toolId && t.instanceId === instance.instanceId);
    if (!tool) {
      n(`✗ Unknown tool instance: ${instance.toolId}:${instance.instanceId}`, "error");
      return false;
    }

    const pluginDrift = detailPluginDrift ?? pluginDriftMap[plugin.name];
    if (!pluginDrift) {
      n(`✗ No drift info available for ${plugin.name}`, "error");
      return false;
    }

    let copied = 0;

    await withSpinner(`Pulling ${plugin.name} from ${tool.name}...`, async () => {
      for (const [driftKey, status] of Object.entries(pluginDrift)) {
        if (status === "in-sync") continue;

        const [kind, name] = driftKey.split(":");
        if (kind !== "skill" && kind !== "command" && kind !== "agent") continue;

        const subdir = kind === "skill" ? tool.skillsSubdir : kind === "command" ? tool.commandsSubdir : tool.agentsSubdir;
        if (!subdir) continue;

        const suffix = kind === "skill" ? name : `${name}.md`;
        const sourcePath = join(sourcePaths.pluginDir, `${kind}s`, suffix);
        const targetPath = join(tool.configDir, subdir, suffix);

        if (!existsSync(targetPath)) continue;

        let hasDiff = false;
        try {
          const dt = buildFileDiffTarget(`${plugin.name}/${name}`, suffix, sourcePath, targetPath, instance);
          hasDiff = dt.files.length > 0;
        } catch {
          hasDiff = false;
        }
        if (!hasDiff) continue;

        if (kind === "skill") {
          rmSync(sourcePath, { recursive: true, force: true });
          cpSync(targetPath, sourcePath, { recursive: true });
        } else {
          mkdirSync(dirname(sourcePath), { recursive: true });
          copyFileSync(targetPath, sourcePath);
        }
        copied += 1;
      }
    }, n, cn);

    if (copied > 0) {
      n(`✓ Pulled ${plugin.name} from ${tool.name} (${copied})`, "success");
    } else {
      n(`⚠ No changed components to pull from ${tool.name}`, "warning");
    }

    await useStore.getState().refreshAll({ silent: true });
    return copied > 0;
  };

  // Unified action handler for file, plugin, and pi-package detail views
  const handleEntityAction = async (index: number) => {
    if (!activeDetail) return;
    const { item, actions } = activeDetail;
    const action = actions[index];
    if (!action) return;

    await handleItemAction(item, action, {
      closeDetail: () => { setDetailFile(null); setDetailSkill(null); setDetailPlugin(null); setDetailPiPackage(null); closeDetail(); },
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
      pullbackPluginInstance: pullbackPluginInstanceCb,
      installPiPackage: doInstallPiPkg,
      uninstallPiPackage: doUninstallPiPkg,
      updatePiPackage: doUpdatePiPkg,
      refreshDetailPiPackage,
      buildPluginDiffTarget: buildPluginDiffTargetCb,
      // Skill mutations — wrap with spinner since copies may be slow for large skills.
      uninstallSkillAll: async (skill) => {
        const store = useStore.getState();
        await withSpinner(
          `Uninstalling ${skill.name} from all tools...`,
          async () => { uninstallSkillAllInstances(skill); },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
        setDetailSkill(null);
        closeDetail();
      },
      uninstallSkillFromInstance: async (skill, toolId, instanceId) => {
        const store = useStore.getState();
        await withSpinner(
          `Uninstalling ${skill.name} from ${toolId}...`,
          async () => { uninstallSkillFromInstance(skill, toolId, instanceId); },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
      },
      installSkillToInstance: async (skill, toolId, instanceId) => {
        const store = useStore.getState();
        await withSpinner(
          `Syncing ${skill.name} to ${toolId}...`,
          async () => { installSkillToInstance(skill, toolId, instanceId); },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
      },
      installSkillToAll: async (skill) => {
        const store = useStore.getState();
        let result: { installed: number; skipped: number; failed: number } = { installed: 0, skipped: 0, failed: 0 };
        await withSpinner(
          `Syncing ${skill.name} to all missing tools...`,
          async () => { result = installSkillToAllMissing(skill); },
          store.notify, store.clearNotification,
        );
        const parts: string[] = [];
        if (result.installed > 0) parts.push(`installed to ${result.installed}`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        store.notify(`${skill.name}: ${parts.join(", ") || "nothing to do"}`, result.failed > 0 ? "warning" : "info");
        await useStore.getState().loadInstalledPlugins({ silent: true });
      },
      pullbackSkillFromInstance: async (skill, toolId, instanceId) => {
        const store = useStore.getState();
        await withSpinner(
          `Pulling ${skill.name} from ${toolId} to source repo...`,
          async () => { pullbackSkillToSource(skill, toolId, instanceId); },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
      },
      deleteSkillEverywhere: async (skill) => {
        const store = useStore.getState();
        await withSpinner(
          `Deleting ${skill.name} everywhere...`,
          async () => {
            const result = deleteSkillEverywhere(skill);
            if (result.ok) {
              const parts = [`${result.tools} tool installs`];
              if (result.source) parts.push(`source repo (uncommitted — review & commit manually)`);
              store.notify(`Deleted ${skill.name}: ${parts.join(", ")}`, "info");
            } else {
              store.notify(`Delete failed: ${result.error}`, "error");
            }
          },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
        setDetailSkill(null);
        closeDetail();
      },
      deletePluginEverywhere: async (plugin) => {
        const store = useStore.getState();
        await withSpinner(
          `Deleting ${plugin.name} everywhere...`,
          async () => {
            const result = await deletePluginEverywhere(plugin);
            if (result.ok) {
              const parts = [`${result.tools} tool installs`];
              if (result.cache) parts.push("plugin cache");
              store.notify(`Deleted ${plugin.name}: ${parts.join(", ")}`, "info");
            } else {
              store.notify(`Delete failed: ${result.error}`, "error");
            }
          },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadInstalledPlugins({ silent: true });
        setDetailPlugin(null);
        setDetailPluginDrift(null);
        closeDetail();
      },
      deleteFileEverywhere: async (file) => {
        const store = useStore.getState();
        await withSpinner(
          `Deleting ${file.name} everywhere...`,
          async () => {
            const result = deleteFileEverywhere(file);
            if (result.ok) {
              const parts = [`${result.targets} tool targets`];
              if (result.source) parts.push("source file (uncommitted)");
              if (result.config) parts.push("config.yaml entry");
              store.notify(`Deleted ${file.name}: ${parts.join(", ")}`, "info");
            } else {
              store.notify(`Delete failed: ${result.error}`, "error");
            }
          },
          store.notify, store.clearNotification,
        );
        await useStore.getState().loadFiles({ silent: true });
        setDetailFile(null);
        closeDetail();
      },
      refreshDetailSkill: (skill) => {
        const refreshed = useStore.getState().standaloneSkills.find((s) => s.name === skill.name);
        if (refreshed) setDetailSkill(refreshed);
        else { setDetailSkill(null); closeDetail(); }
      },
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
    await refreshAll({ silent: true });
  };

  const handleSourceWizardComplete = async (source: string) => {
    const loadingId = notify("Configuring source repository...", "info", { spinner: true });
    try {
      const result = await setupSourceRepository(source);
      clearNotification(loadingId);
      setShowSourceSetupWizard(false);
      await refreshAll({ silent: true });

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

  const handleDiffPullBack = () => {
    if (!diffTarget) return;
    const instance = diffTarget.instance;

    const fallbackFile = files.find((f) => f.name === diffTarget.title) || null;
    const pullFile = detailFile || fallbackFile;

    if (pullFile) {
      void pullbackFileInstance(pullFile, instance);
      return;
    }

    if (detailPlugin) {
      void pullbackPluginInstanceCb(detailPlugin, instance);
      return;
    }

    notify("Pullback is only available from file or plugin details.", "warning");
  };

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar />

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
          onPullBack={handleDiffPullBack}
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
        <Box flexDirection="column" height={(({ sync: 30, discover: 20, installed: 34 } as Record<string, number>)[tab] ?? 25)}>
          {tab === "discover" && <DiscoverTab />}

          {tab === "installed" && <InstalledTab />}

          {tab === "marketplaces" && <MarketplacesTab />}

          {tab === "tools" && <ToolsTab />}

          {tab === "sync" && <SyncTab />}

          {tab === "settings" && <SettingsTab />}
        </Box>
      )}

      <Notifications />
      <HintBar
        tab={tab}
        hasDetail={isOverlayOpen}
        toolsHint={toolsHint}
      />
      <StatusBar />
    </Box>
  );
}
