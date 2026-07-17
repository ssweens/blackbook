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
import { ToolActionModal } from "./components/ToolActionModal.js";
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
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ToolsTab } from "./tabs/ToolsTab.js";
import { SettingsTab } from "./tabs/SettingsTab.js";
import { MarketplacesTab } from "./tabs/MarketplacesTab.js";
import { SyncTab } from "./tabs/SyncTab.js";
import { DiscoverTab } from "./tabs/DiscoverTab.js";
import { InstalledTab } from "./tabs/InstalledTab.js";
import { ProjectsTab } from "./tabs/ProjectsTab.js";
import { AddProjectModal } from "./components/AddProjectModal.js";
import { AdoptModal } from "./components/AdoptModal.js";
import { ProfilePickerModal } from "./components/ProfilePickerModal.js";
import { getPluginToolStatus } from "./lib/plugin-status.js";
import {
  syncPluginInstances,
  uninstallPluginFromInstance,
  groupSkillsByNamespace,
} from "./lib/install.js";
import { resolvePluginSourcePaths, type PluginDrift } from "./lib/plugin-drift.js";
import { resolveInstalledPluginComponentPath } from "./lib/pi-bridge.js";
import { computeItemDrift } from "./lib/item-drift.js";
import { buildFileDiffTarget } from "./lib/diff.js";
import { getPackageManager } from "./lib/config.js";
import { setupSourceRepository, shouldShowSourceSetupWizard, pullSourceRepo } from "./lib/source-setup.js";
import { ItemList, FILE_COLUMNS, PLUGIN_COLUMNS } from "./components/ItemList.js";
import { ItemDetail, PluginMetadata, FileMetadata, PiPackageMetadata, SkillMetadata, NamespaceMetadata, type ItemAction } from "./components/ItemDetail.js";
import { NamespaceDetail } from "./components/NamespaceDetail.js";
import { pluginToManagedItem, fileToManagedItem, piPackageToManagedItem } from "./lib/managed-item.js";
import type { ManagedItem } from "./lib/managed-item.js";
import { getMarketplaceDetailActions, type MarketplaceDetailContext } from "./lib/marketplace-detail.js";
import { buildMarketplaceRows, type MarketplaceRow } from "./lib/marketplace-row.js";
import { useDetailInput, useDiffInput, useListInput } from "./lib/input-hooks.js";
import { handleItemAction } from "./lib/action-dispatch.js";
import type { Tab, SyncPreviewItem, Plugin, PiPackage, PiMarketplace, DiffInstanceRef, DiscoverSection, DiscoverSubView, FileStatus, Marketplace } from "./lib/types.js";
import { countAppRender } from "./lib/perf.js";
import { useContentHeight } from "./lib/use-content-height.js";
import { useToolActions } from "./lib/use-tool-actions.js";
import { useNamespaceTree } from "./lib/use-namespace-tree.js";
import { buildDetailCallbacks } from "./lib/detail-callbacks.js";
import { getSyncItemKey, sortAndFilterPiPackages } from "./lib/derived.js";
import { buildProjectSkillRows, collectUnmanagedSkills } from "./lib/projects.js";

const TABS: Tab[] = ["sync", "tools", "discover", "installed", "marketplaces", "projects", "settings"];

interface TabContentProps {
  tab: Tab;
  searchFocused: boolean;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
}

function TabContent({ tab, searchFocused, onSearchFocus, onSearchBlur }: TabContentProps) {
  const contentHeight = useContentHeight();
  switch (tab) {
    case "discover":
      return (
        <DiscoverTab
          contentHeight={contentHeight}
          searchFocused={searchFocused}
          onSearchFocus={onSearchFocus}
          onSearchBlur={onSearchBlur}
        />
      );
    case "installed":
      return (
        <InstalledTab
          contentHeight={contentHeight}
          searchFocused={searchFocused}
          onSearchFocus={onSearchFocus}
          onSearchBlur={onSearchBlur}
        />
      );
    case "marketplaces":
      return <MarketplacesTab contentHeight={contentHeight} />;
    case "tools":
      return <ToolsTab contentHeight={contentHeight} />;
    case "sync":
      return <SyncTab contentHeight={contentHeight} />;
    case "projects":
      return <ProjectsTab contentHeight={contentHeight} />;
    case "settings":
      return <SettingsTab />;
  }
}

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

  // ── Data: Files ──
  const files = useStore((s) => s.files);

  // ── Data: Tools ──
  const tools = useStore((s) => s.tools);
  const managedTools = useStore((s) => s.managedTools);
  const toolDetection = useStore((s) => s.toolDetection);
  const toolDetectionPending = useStore((s) => s.toolDetectionPending);
  const toolActionInProgress = useStore((s) => s.toolActionInProgress);
  const toolActionOutput = useStore((s) => s.toolActionOutput);

  // ── Data: Pi Packages ──
  const piPackages = useStore((s) => s.piPackages);
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
  const detailNamespace = detail?.kind === "namespace" ? detail.data : null;
  const detailPiPackage = detail?.kind === "piPackage" ? detail.data : null;
  const detailPluginDrift = detail?.kind === "plugin" ? (detail.drift ?? null) : null;
  // Setters that delegate to the unified setDetail.
  const setDetailPluginDrift = (drift: PluginDrift | null) => {
    const current = useStore.getState().detail;
    if (current?.kind !== "plugin") return;
    setDetail({ kind: "plugin", data: current.data, drift: drift ?? undefined });
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

  // ── Actions (stable references — selectors here for explicitness) ──
  const loadMarketplaces = useStore((s) => s.loadMarketplaces);
  const loadInstalledPlugins = useStore((s) => s.loadInstalledPlugins);
  const loadFiles = useStore((s) => s.loadFiles);
  const refreshManagedTools = useStore((s) => s.refreshManagedTools);
  const refreshToolDetection = useStore((s) => s.refreshToolDetection);
  const doInstall = useStore((s) => s.installPlugin);
  const doUninstall = useStore((s) => s.uninstallPlugin);
  const doUpdate = useStore((s) => s.updatePlugin);
  const doTrackPlugin = useStore((s) => s.trackPluginInSource);
  const doRemovePluginFromGit = useStore((s) => s.removePluginFromGit);
  const updateMarketplace = useStore((s) => s.updateMarketplace);
  const toggleMarketplaceEnabled = useStore((s) => s.toggleMarketplaceEnabled);
  const removeMarketplace = useStore((s) => s.removeMarketplace);
  const addMarketplace = useStore((s) => s.addMarketplace);
  const toggleToolEnabled = useStore((s) => s.toggleToolEnabled);
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
  const doTrackPiPkg = useStore((s) => s.trackPiPackageInSource);
  const doRemovePiPkgFromGit = useStore((s) => s.removePiPackageFromGit);
  const doDeletePiPkg = useStore((s) => s.deletePiPackageEverywhere);
  const togglePiMarketplaceEnabled = useStore((s) => s.togglePiMarketplaceEnabled);
  const addPiMarketplace = useStore((s) => s.addPiMarketplace);
  const removePiMarketplace = useStore((s) => s.removePiMarketplace);
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);
  const addProject = useStore((s) => s.addProject);
  const removeProject = useStore((s) => s.removeProject);
  const projectDetailPath = useStore((s) => s.projectDetailPath);
  const setProjectDetailPath = useStore((s) => s.setProjectDetailPath);
  const pushProjectSkill = useStore((s) => s.pushProjectSkill);
  const pullProjectSkill = useStore((s) => s.pullProjectSkill);
  const toggleProjectSkill = useStore((s) => s.toggleProjectSkill);
  const removeProjectSkill = useStore((s) => s.removeProjectSkill);
  const adoptUnmanagedSkills = useStore((s) => s.adoptUnmanagedSkills);
  const unmanagedSkills = useMemo(() => collectUnmanagedSkills(projects), [projects]);
  const profiles = useStore((s) => s.profiles);
  const applyProfile = useStore((s) => s.applyProfile);
  const [profileTargetPath, setProfileTargetPath] = useState<string | null>(null);

  const [actionIndex, setActionIndex] = useState(0);
  const openSkillDetail = (skill: import("./lib/install.js").StandaloneSkill) => {
    setDetail({ kind: "skill", data: skill });
    setActionIndex(0);
  };
  const {
    expandedSkills,
    setExpandedSkills,
    closeDetail,
    handleNamespaceTreeInput,
  } = useNamespaceTree({ detail, detailNamespace, setDetail, actionIndex, setActionIndex, openSkillDetail });
  // detailPluginDrift / detailFile / detailSkill are now derived from `detail` above.
  const pluginDriftMap = useStore((s) => s.pluginDriftMap);
  const setPluginDriftMap = useStore((s) => s.setPluginDriftMap);
  const [detailPiMarketplace, setDetailPiMarketplace] = useState<PiMarketplace | null>(null);
  const [modalVisible, setModalVisible] = useState<"addMarketplace" | "addPiMarketplace" | "addProject" | "adoptSkills" | "applyProfile" | "sourceSetupWizard" | null>(null);
  const showAddMarketplace = modalVisible === "addMarketplace";
  const showAddPiMarketplace = modalVisible === "addPiMarketplace";
  const showSourceSetupWizard = modalVisible === "sourceSetupWizard";
  const setShowAddMarketplace = (v: boolean) => setModalVisible(v ? "addMarketplace" : null);
  const setShowAddPiMarketplace = (v: boolean) => setModalVisible(v ? "addPiMarketplace" : null);
  const setShowSourceSetupWizard = (v: boolean) => setModalVisible(v ? "sourceSetupWizard" : null);
  const {
    toolModalAction, toolModalWarning, toolModalMigrate,
    toolModalRunning, toolModalDone, toolModalSuccess,
    detailTool, setDetailToolKey, editingToolId, setEditingToolId, editingTool,
    selectedManagedTool, activeToolForModal, toolsHint,
    handleToolModalInput, handleToolShortcut, handleToolConfigSave,
    runToolAction, getToolActionCommand,
  } = useToolActions({ tab, selectedIndex });
  const sortBy = useStore((s) => s.sortBy);
  const sortDir = useStore((s) => s.sortDir);
  const setSortBy = useStore((s) => s.setSortBy);
  const setSortDir = useStore((s) => s.setSortDir);
  const syncArmed = useStore((s) => s.syncArmed);
  const setSyncArmed = useStore((s) => s.setSyncArmed);
  const syncSelection = useStore((s) => s.syncSelection);
  const toggleSyncSelection = useStore((s) => s.toggleSyncSelection);
  const [searchFocused, setSearchFocused] = useState(false);
  // Recompute when any data source the preview reads from changes. Without these
  // deps, maxIndex (computed from syncPreview.length) freezes to the first render
  // and caps cursor navigation — even though SyncTab itself renders the full list.
  const syncPreview = useMemo(
    () => getSyncPreview(),
    [getSyncPreview, managedTools, toolDetection, files, installedPlugins, standaloneSkills, marketplaces, piPackages],
  );
  const [marketplaceBrowseContext, setMarketplaceBrowseContext] = useState<Marketplace | null>(null);
  const [tabRefreshInProgress, setTabRefreshInProgress] = useState(false);
  const [showRefreshIndicator, setShowRefreshIndicator] = useState(false);
  const tabRefreshCounterRef = useRef(0);
  const initialRefreshStartedRef = useRef(false);
  const tabRefreshInFlightRef = useRef<Record<Tab, boolean>>({
    sync: false,
    tools: false,
    discover: false,
    installed: false,
    marketplaces: false,
    projects: false,
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

  const showPiFeatures = useMemo(() => {
    const piEnabled = tools.some((tool) => tool.toolId === "pi" && tool.enabled);
    const piInstalled = toolDetection.pi?.installed === true;
    return piEnabled || piInstalled;
  }, [tools, toolDetection]);

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

  const refreshTabData = async (targetTab: Tab) => {
    if (tabRefreshInFlightRef.current[targetTab]) {
      return;
    }

    tabRefreshInFlightRef.current[targetTab] = true;
    tabRefreshCounterRef.current += 1;
    useStore.setState({ loading: true });
    setTabRefreshInProgress(true);

    try {
      switch (targetTab) {
        case "settings":
          await refreshAll();
          break;
        case "discover":
        case "marketplaces": await Promise.all([loadMarketplaces(), loadPiPackages()]); break;
        case "installed":
          await Promise.all([loadInstalledPlugins(), loadPiPackages()]);
          void loadFiles().catch((error) => {
            notify(`Failed to load files in background: ${error instanceof Error ? error.message : String(error)}`, "error");
          }); // background — Installed stays responsive
          break;
        case "tools":
          refreshManagedTools();
          await refreshToolDetection();
          break;
        case "projects":
          await loadProjects();
          break;
        case "sync":
        default:
          // Sync: load plugins/tools first (fast), then files in background (slow).
          refreshManagedTools();
          await Promise.all([loadInstalledPlugins(), refreshToolDetection()]);
          void loadFiles().catch((error) => {
            notify(`Failed to load files in background: ${error instanceof Error ? error.message : String(error)}`, "error");
          }); // background — files are slow, don't block UI
          break;
      }
    } catch (error) {
      notify(`Failed to refresh ${targetTab} tab: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      tabRefreshInFlightRef.current[targetTab] = false;
      tabRefreshCounterRef.current -= 1;
      if (tabRefreshCounterRef.current <= 0) {
        tabRefreshCounterRef.current = 0;
        useStore.setState({ loading: false });
        setTabRefreshInProgress(false);
      }
    }
  };

  useEffect(() => {
    const shouldShowWizard = shouldShowSourceSetupWizard();
    setShowSourceSetupWizard(shouldShowWizard);

    if (shouldShowWizard || initialRefreshStartedRef.current) return;

    const state = useStore.getState();
    const initialTabAlreadyHydrated =
      tab === "discover" ? state.marketplaces.length > 0 || state.piPackages.length > 0
      : tab === "marketplaces" ? state.marketplaces.length > 0 || state.piMarketplaces.length > 0
      : tab === "installed" ? state.installedPluginsLoaded || state.filesLoaded || state.piPackagesLoaded
      : tab === "tools" ? state.managedTools.length > 0 && Object.keys(state.toolDetection).length > 0
      : tab === "projects" ? state.projectsLoaded
      : tab === "settings";
    if (initialTabAlreadyHydrated) return;

    initialRefreshStartedRef.current = true;
    void refreshTabData(tab);
    // Run exactly once on boot. Tab switches after boot do not auto-refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The store's setTab resets shared browse/detail state (detail, detailMarketplace,
  // discoverSubView, …) on every tab change, but these App-local overlay/context
  // states are NOT covered by that reset. Clear them here whenever the tab changes so
  // a stale value can't resurrect a closed overlay — e.g. a leftover
  // marketplaceBrowseContext re-opening the previous marketplace's detail when the
  // user returns to the Marketplaces tab and presses Esc.
  //
  // marketplaceBrowseContext is exempted while the tab is "discover" or
  // "marketplaces" — that pair is the intended round-trip for the "Browse
  // plugins/packages" action (marketplaces -> discover to view the filtered
  // list -> back to marketplaces to restore the detail via handleEscape, which
  // clears the context itself once it's actually consumed). Clearing it on the
  // very tab change that action performs would break that flow immediately;
  // navigating to any OTHER tab still clears it, since that's a genuine
  // "wandered away" case.
  useEffect(() => {
    if (tab !== "discover" && tab !== "marketplaces") {
      setMarketplaceBrowseContext(null);
    }
    setDetailPiMarketplace(null);
    setDetailToolKey(null);
  }, [tab]);

  useEffect(() => {
    if (!detailFile) return;
    const refreshed = effectiveFiles.find((f) => f.name === detailFile.name);
    if (refreshed && refreshed !== detailFile) {
      setDetail({ kind: "file", data: refreshed });
    }
  }, [files, detailFile]);

  // Manual-only mode: skip expensive background drift scans. Reset drift
  // state once at cold start only — not if it was already populated when the
  // app mounted (e.g. tests seeding it directly, or a future on-demand
  // computation), since that would wipe drift data meant to be shown.
  // Deliberately mount-once (checks pluginDriftMap's value only at the moment
  // this runs); `setPluginDriftMap` is a stable store action, so this never
  // re-fires on its own.
  useEffect(() => {
    if (Object.keys(pluginDriftMap).length > 0) return;
    setPluginDriftMap({});
  }, [setPluginDriftMap]);

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
    // Discover: use the canonical ordering shared with DiscoverTab's rendering so
    // the highlighted row and the Enter/Space target are always the same package.
    // DiscoverTab renders from the raw `piPackages` store slice, so key off that.
    if (tab === "discover") {
      return sortAndFilterPiPackages(piPackages, sortBy, sortDir, search);
    }
    if (tab !== "installed") return [];

    const lowerSearch = search.toLowerCase();
    const base = effectivePiPackages.filter((p) => p.installed || p.recommended);
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
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) return nameCmp;
        const sourceTypeCmp = a.sourceType.localeCompare(b.sourceType);
        if (sourceTypeCmp !== 0) return sourceTypeCmp;
        return a.source.localeCompare(b.source);
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
  }, [tab, piPackages, effectivePiPackages, search, sortBy, sortDir]);

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

  const { namespacedSkills, standaloneOnlySkills } = useMemo(() => {
    if (tab !== "installed") return { namespacedSkills: [] as import("./lib/install.js").StandaloneSkill[], standaloneOnlySkills: [] as import("./lib/install.js").StandaloneSkill[] };
    const lowerSearch = search.toLowerCase();
    const filtered = search
      ? standaloneSkills.filter((s) => s.name.toLowerCase().includes(lowerSearch) || (s.namespace && s.namespace.toLowerCase().includes(lowerSearch)))
      : standaloneSkills;
    return {
      namespacedSkills: filtered.filter((s) => s.namespace),
      standaloneOnlySkills: filtered.filter((s) => !s.namespace),
    };
  }, [tab, standaloneSkills, search]);

  const namespaceGroups = useMemo(() => groupSkillsByNamespace(namespacedSkills), [namespacedSkills]);

  const fileCount = filteredFiles.length;
  const namespaceCount = namespaceGroups.length;
  const skillCount = standaloneOnlySkills.length;
  const pluginCount = filteredPlugins.length;
  const piPkgCount = filteredPiPackages.length;

  // In Discover tab: Plugins and PiPackages are summary cards (1 item each if they have content)
  // In Installed tab: sections are inline lists
  const pluginSectionCount = tab === "discover" ? (pluginCount > 0 ? 1 : 0) : pluginCount;
  const piPkgSectionCount = tab === "discover" ? (piPkgCount > 0 ? 1 : 0) : piPkgCount;

  const libraryCount = tab === "installed"
    ? fileCount + namespaceCount + skillCount + pluginCount + piPkgCount
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
      if (namespaceCount > 0) {
        result.push({ id: "skills", start: offset, end: offset + namespaceCount - 1 });
        offset += namespaceCount;
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
  }, [tab, fileCount, namespaceCount, skillCount, pluginCount, piPkgCount, pluginSectionCount, piPkgSectionCount]);

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
    if (discoverSubView === "plugins") {
      const plugins = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
      return Math.max(0, plugins.length - 1);
    }
    if (discoverSubView === "piPackages") {
      return Math.max(0, filteredPiPackages.length - 1);
    }
    if (tab === "marketplaces") {
      return Math.max(0, marketplaceRows.length - 1);
    }
    if (tab === "tools") {
      return Math.max(0, managedTools.length - 1);
    }
    if (tab === "sync") {
      return Math.max(0, syncPreview.length - 1);
    }
    if (tab === "projects") {
      if (projectDetailPath) {
        const p = projects.find((pr) => pr.path === projectDetailPath);
        return Math.max(0, (p ? p.skills.length + p.available.length : 0) - 1);
      }
      return Math.max(0, projects.length - 1);
    }
    return Math.max(0, libraryCount - 1);
  }, [discoverSubView, tab, marketplaceBrowsePlugins, filteredPlugins, filteredPiPackages, marketplaceRows, managedTools, syncPreview, projects, projectDetailPath, libraryCount]);

  useEffect(() => {
    if (selectedIndex > maxIndex) {
      setSelectedIndex(maxIndex);
    }
  }, [selectedIndex, maxIndex, setSelectedIndex]);

  const selectedLibraryItem = useMemo(
    ():
      | { kind: "plugin"; plugin: Plugin }
      | { kind: "piPackage"; piPackage: PiPackage }
      | { kind: "file"; file: FileStatus }
      | { kind: "skill"; skill: import("./lib/install.js").StandaloneSkill }
      | { kind: "namespace"; namespace: import("./lib/install.js").NamespaceGroup }
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

      // Installed tab - inline lists (visual order: files, namespaces, skills, plugins, piPackages)
      if (selectedIndex < fileCount) {
        const file = filteredFiles[selectedIndex];
        return file ? { kind: "file", file } : null;
      }

      if (selectedIndex < fileCount + namespaceCount) {
        const ns = namespaceGroups[selectedIndex - fileCount];
        return ns ? { kind: "namespace", namespace: ns } : null;
      }

      if (selectedIndex < fileCount + namespaceCount + skillCount) {
        const skill = standaloneOnlySkills[selectedIndex - fileCount - namespaceCount];
        return skill ? { kind: "skill", skill } : null;
      }

      if (selectedIndex < fileCount + namespaceCount + skillCount + pluginCount) {
        const plugin = filteredPlugins[selectedIndex - fileCount - namespaceCount - skillCount];
        return plugin ? { kind: "plugin", plugin } : null;
      }

      const piPkg =
        filteredPiPackages[selectedIndex - fileCount - namespaceCount - skillCount - pluginCount];
      return piPkg ? { kind: "piPackage", piPackage: piPkg } : null;
    },
    [
      tab,
      selectedIndex,
      filteredPlugins,
      filteredFiles,
      filteredPiPackages,
      fileCount,
      namespaceCount,
      skillCount,
      pluginCount,
      piPkgCount,
      pluginSectionCount,
      piPkgSectionCount,
      namespaceGroups,
      standaloneOnlySkills,
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
    const displayName = detailSkill.namespace ? `${detailSkill.namespace}/${detailSkill.name}` : detailSkill.name;
    return {
      name: displayName,
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
        status: (i.drifted ? "changed" : "synced") as "changed" | "synced",
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

  const detailNamespaceItem = useMemo((): ManagedItem | null => {
    if (!detailNamespace) return null;
    const ns = detailNamespace;
    const isInstalled = ns.totalInstallations > 0;
    return {
      name: ns.name,
      kind: "namespace" as const,
      marketplace: ns.toolIds.join(", "),
      description: `${ns.skills.length} skill${ns.skills.length === 1 ? "" : "s"} · ${ns.toolIds.join(", ")}`,
      installed: isInstalled,
      incomplete: ns.missingCount > 0,
      scope: "user" as const,
      tools: ns.toolIds,
      instances: ns.toolIds.map((toolId) => ({
        toolId,
        instanceId: "default",
        instanceName: toolId,
        configDir: "",
        status: "synced" as const,
        sourcePath: null,
        targetPath: null,
        linesAdded: 0,
        linesRemoved: 0,
      })),
      _namespace: ns,
    };
  }, [detailNamespace]);

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
      case "namespace": {
        if (!detailNamespaceItem) return null;
        return { item: detailNamespaceItem, actions: buildItemActions(detailNamespaceItem), metadata: <NamespaceMetadata item={detailNamespaceItem} /> };
      }
    }
  }, [detail, detailFileItem, detailSkillItem, detailPluginItem, detailPiPkgItem, detailNamespaceItem, pluginDriftMap]);

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

  // ── Overlay registry ──────────────────────────────────────────────────────
  // Single ordered source of truth for "which overlay is open", in the SAME
  // priority order as the render switch (renderActiveOverlay) below. Every
  // consumer — the render decision, isOverlayOpen, the modal input guard, and
  // handleEscape — derives from THIS list so they can never disagree. That drift
  // (e.g. isOverlayOpen omitting an overlay that is actually on screen) is exactly
  // the class of bug this registry exists to eliminate by construction.
  //
  // inputMode:
  //  - "modal": overlay owns ALL input; App's useInput returns early (either the
  //    overlay's own useInput handles keys — wizard / edit+add modals — or, for
  //    toolActionModal, the dedicated top-of-useInput handleToolModalInput guard).
  //    Modals deliberately do NOT count as "detail overlays": they must not flip
  //    HintBar's detail hint or gate the tab-content shortcuts, matching today.
  //  - "detail": App-managed overlay. Counts toward isOverlayOpen — suppresses the
  //    tab-content shortcuts (/ search, digit tab-switch, Tab section nav, sort)
  //    and switches HintBar to the detail-navigation hint.
  //
  // escClose is defined ONLY for overlays whose Esc is owned by App's handleEscape
  // (toolDetail / itemDetail / marketplaceDetail). diff / missingSummary /
  // sourceSetupWizard / edit+add modals each have their OWN useInput that handles
  // Esc (internal navigation or self-close), and toolActionModal's Esc flows
  // through handleToolModalInput — so those intentionally omit escClose, exactly
  // as before this refactor.

  // Close the currently-open item detail. If it's a skill that belongs to a
  // namespace, go BACK to the namespace detail (breadcrumb) instead of all the way
  // to the list. Reads live store state so a stale input callback still closes the
  // detail actually on screen. Relocated verbatim from the old handleEscape.
  const closeItemDetail = () => {
    const state = useStore.getState();
    if (!state.detail) return;
    if (state.detail.kind === "skill" && state.detail.data.namespace) {
      const nsName = state.detail.data.namespace;
      const fresh = groupSkillsByNamespace(state.standaloneSkills).find(
        (n) => n.name === nsName,
      );
      if (fresh) {
        setDetail({ kind: "namespace", data: fresh });
        setExpandedSkills(new Set());
        setActionIndex(0);
        return;
      }
    }
    setDetail(null);
    closeDetail();
  };

  type OverlayKind =
    | "sourceSetupWizard" | "diff" | "missingSummary" | "editToolModal"
    | "addMarketplace" | "addPiMarketplace" | "addProject" | "adoptSkills" | "applyProfile" | "toolActionModal"
    | "toolDetail" | "itemDetail" | "marketplaceDetail";
  interface OverlayEntry {
    kind: OverlayKind;
    active: boolean;
    inputMode: "modal" | "detail";
    escClose?: () => void;
  }
  const overlayEntries: OverlayEntry[] = [
    { kind: "sourceSetupWizard", active: showSourceSetupWizard, inputMode: "modal" },
    // diff/missingSummary self-handle Esc via their own useInput (multi-step back
    // nav, then close). Without an escClose here, .find() below would skip past
    // them (they have none) to the next entry that DOES have one — itemDetail —
    // and close the detail UNDERNEATH in the same keypress as the diff's own
    // self-close. The no-op escClose makes the walk stop here and do nothing at
    // the App level, deferring entirely to the component's own handler.
    { kind: "diff", active: !!diffTarget, inputMode: "detail", escClose: () => {} },
    { kind: "missingSummary", active: !!missingSummary, inputMode: "detail", escClose: () => {} },
    { kind: "editToolModal", active: !!editingToolId, inputMode: "modal" },
    { kind: "addMarketplace", active: modalVisible === "addMarketplace", inputMode: "modal" },
    { kind: "addPiMarketplace", active: modalVisible === "addPiMarketplace", inputMode: "modal" },
    { kind: "addProject", active: modalVisible === "addProject", inputMode: "modal" },
    { kind: "adoptSkills", active: modalVisible === "adoptSkills", inputMode: "modal" },
    { kind: "applyProfile", active: modalVisible === "applyProfile", inputMode: "modal" },
    { kind: "toolActionModal", active: !!(toolModalAction && activeToolForModal), inputMode: "modal" },
    { kind: "toolDetail", active: !!detailTool, inputMode: "detail", escClose: () => setDetailToolKey(null) },
    { kind: "itemDetail", active: !!activeDetail, inputMode: "detail", escClose: closeItemDetail },
    {
      kind: "marketplaceDetail",
      active: !!activeMarketplaceDetail,
      inputMode: "detail",
      escClose: () => { setDetailMarketplace(null); setDetailPiMarketplace(null); closeDetail(); },
    },
  ];
  // First active entry wins — same priority as the old render ternary.
  const activeOverlay = overlayEntries.find((e) => e.active) ?? null;
  /** True when an App-managed detail/diff/missing overlay is open — blocks global navigation. */
  const isOverlayOpen = overlayEntries.some((e) => e.active && e.inputMode === "detail");

  // Thin shims around the unified store.refreshDetail() for plugins (which need drift
  // recomputed) and piPackages (which need the legacy mirror updated).
  const refreshDetailPlugin = (plugin: Plugin) => {
    refreshDetail();
    // Recompute plugin drift after refresh. Same guard as openPluginDetail —
    // late resolution must not resurrect / clobber detail if the user navigated.
    // Yield to the event loop so input handling stays responsive while drift's
    // git subprocesses run.
    setTimeout(() => {
      const current = useStore.getState().detail;
      if (current?.kind !== "plugin") return;
      if (current.data.name !== plugin.name || current.data.marketplace !== plugin.marketplace) return;
      void computeItemDrift(pluginToManagedItem(plugin)).then((drift) => {
        if (drift.kind !== "plugin") return;
        const c2 = useStore.getState().detail;
        if (c2?.kind !== "plugin") return;
        if (c2.data.name !== plugin.name || c2.data.marketplace !== plugin.marketplace) return;
        setDetailPluginDrift(drift.plugin);
      });
    }, 300);
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

  const handleEscape = () => {
    // Topmost App-owned overlay closes first, in registry (render z-order)
    // priority. Modal-mode overlays (wizard, edit+add modals, toolActionModal)
    // never reach here — they return early above. diff/missingSummary DO reach
    // here (they are "detail" mode) but carry a no-op escClose specifically so
    // this walk stops AT them rather than falling through to whatever detail
    // overlay (toolDetail / itemDetail / marketplaceDetail) sits underneath —
    // otherwise one Esc would close both layers at once (a diff opened from
    // within an item detail would dump you on the list instead of back on the
    // detail). Those three real escClose overlays are mutually exclusive with
    // each other in practice, but NOT with diff/missingSummary layered on top.
    const overlay = overlayEntries.find((e) => e.active && e.escClose);
    if (overlay) { overlay.escClose!(); return; }
    // List sub-views below are NOT render overlays (they render inside TabContent),
    // so they live outside the registry — handled here exactly as before.
    if (tab === "projects" && projectDetailPath) {
      // Land back on the project we just drilled out of, not unconditionally
      // the first row (Global) — a hardcoded reset made repeated drill-in/out
      // on any non-Global project always kick the cursor back to the top.
      const idx = projects.findIndex((p) => p.path === projectDetailPath);
      setProjectDetailPath(null);
      setSelectedIndex(idx >= 0 ? idx : 0);
      return;
    }
    if (discoverSubView) {
      if (marketplaceBrowseContext) {
        // The browse action now actually switches to the Discover tab (see
        // handleMarketplaceDetailAction's "browse" case), so Esc from the
        // sub-view must switch back — not just clear the sub-view in place.
        // setTab resets discoverSubView/search/detailMarketplace to defaults,
        // so it must run first; the restoration setters after it are what stick.
        setTab("marketplaces");
        setDiscoverSubView(null); setSelectedIndex(0);
        setDetailMarketplace(marketplaceBrowseContext); setMarketplaceBrowseContext(null); setSearch("");
      } else { setDiscoverSubView(null); setSelectedIndex(0); }
      return;
    }
    if (tab === "marketplaces" && marketplaceBrowseContext) {
      setDetailMarketplace(marketplaceBrowseContext); setMarketplaceBrowseContext(null); setSearch("");
    }
  };

  const handleEnterOnList = () => {
    // Projects tab: Enter drills into the selected project's skill list.
    if (tab === "projects") {
      if (!projectDetailPath) {
        const target = projects[selectedIndex];
        if (target) {
          setProjectDetailPath(target.path);
          setSelectedIndex(0);
        }
      }
      return;
    }

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
          setDetail({ kind: "file", data: item.file });
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
    } else if (selectedLibraryItem?.kind === "namespace") {
      setDetail({ kind: "namespace", data: selectedLibraryItem.namespace });
      setActionIndex(0);
    } else if (selectedLibraryItem?.kind === "pluginSummary") {
      setDiscoverSubView("plugins");
      setSelectedIndex(0);
    } else if (selectedLibraryItem?.kind === "piPackageSummary") {
      setDiscoverSubView("piPackages");
      setSelectedIndex(0);
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
    setDetail({ kind: "plugin", data: resolved });
    setDetailPluginDrift(null);
    setActionIndex(0);
    // Defer drift compute by 300ms. The drift indicator is non-critical UI;
    // delaying lets the user press Esc / navigate without competing with the
    // ~N × M git subprocesses drift fires off. Without this delay those
    // subprocesses saturate libuv's event queue and stall the next stdin
    // readable event (= Esc looks like "requires a second key").
    const driftTimer = setTimeout(() => {
      // Bail early if user already navigated away.
      const current = useStore.getState().detail;
      if (current?.kind !== "plugin") return;
      if (current.data.name !== resolved.name || current.data.marketplace !== resolved.marketplace) return;
      void computeItemDrift(pluginToManagedItem(resolved)).then((drift) => {
        if (drift.kind !== "plugin") return;
        const c2 = useStore.getState().detail;
        if (c2?.kind !== "plugin") return;
        if (c2.data.name !== resolved.name || c2.data.marketplace !== resolved.marketplace) return;
        setDetailPluginDrift(drift.plugin);
      });
    }, 300);
    // Best-effort cleanup if a later setDetail clears the timer—React will GC
    // unreferenced timers on unmount but we don't have a hook here. The
    // resolution path itself checks current detail, which is the durable guard.
    void driftTimer;
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
      const list = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
      const plugin = list[selectedIndex];
      if (plugin) toggleInstall(plugin);
      return;
    }
    if (discoverSubView === "piPackages") {
      const pkg = filteredPiPackages[selectedIndex];
      if (pkg) toggleInstallPiPkg(pkg);
      return;
    }

    // Library items
    if (selectedLibraryItem?.kind === "plugin") toggleInstall(selectedLibraryItem.plugin);
    else if (selectedLibraryItem?.kind === "piPackage") toggleInstallPiPkg(selectedLibraryItem.piPackage);
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
      if (selectedMarketplaceRow.kind === "plugin") {
        void removeMarketplace(selectedMarketplaceRow.marketplace.name);
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
    maxIndex,
    selectedIndex,
    filteredPlugins,
    marketplaceBrowsePlugins,
    filteredPiPackages,
    isOverlayOpen,
    setSelectedIndex,
    setDetailPiPackage: (pkg) => { void setDetailPiPackage(pkg); },
    setActionIndex,
    setSyncArmed: () => setSyncArmed(false),
    onOpenPluginDetail: openPluginDetail,
    onEnterList: handleEnterOnList,
    onSpaceToggle: handleSpaceToggle,
  });

  useInput((input, key) => {
    // toolActionModal (registry "modal" entry) captures input here. Keyed on the
    // raw toolModalAction — deliberately broader than the entry's render predicate
    // (toolModalAction && activeToolForModal) — so no key can leak through in the
    // transient instant where the modal state machine is engaged but no tool is
    // resolved yet. handleToolModalInput itself no-ops safely without a tool.
    if (toolModalAction) { handleToolModalInput(input, key); return; }

    // Terminals can emit ESC in multiple forms:
    // - key.escape=true
    // - raw "\u001b"
    // - Ctrl-[ (same codepoint as ESC)
    // Treat any of these as immediate back-navigation.
    const isEscape = key.escape || (typeof input === "string" && input.length > 0 && input.charCodeAt(0) === 27) || (key.ctrl && input === "[");

    // While the search box owns input, the TextInput consumes every character.
    // Only Esc / Enter are handled here (both exit search focus); every other key
    // must NOT trigger a global single-key shortcut (digits switch tabs, `q`
    // quits, Space toggles installs, `s`/`r` cycle sort, `R` refreshes, etc.).
    if (searchFocused) {
      // Esc cancels (clears the filter); Enter accepts (keeps the filter). Both
      // return focus to list navigation.
      if (isEscape) { setSearch(""); setSearchFocused(false); return; }
      if (key.return) { setSearchFocused(false); return; }
      return;
    }

    // A "modal" overlay (SourceSetupWizard, EditToolModal, Add(Pi)MarketplaceModal)
    // owns input while open and handles its own Esc to close itself. Return early
    // for EVERY key — including Esc — so App's own Esc handling below does not ALSO
    // close the view underneath the modal, which would collapse two overlay layers
    // at once (the modal closes itself via its own useInput; the guard must run
    // first). Derived from the overlay registry so this set can't drift from what
    // is actually rendered. (toolActionModal is also a "modal" entry, but is
    // already captured by the toolModalAction guard at the top of this handler.)
    if (overlayEntries.some((e) => e.active && e.inputMode === "modal")) { return; }

    // Esc must always close the topmost overlay — it takes priority over notification
    // dismissal so users can back out even when a notification is showing. Read the
    // live notification list here via getState() instead of subscribing at the top
    // level, so the whole app doesn't re-render on every notification add/clear.
    const stickyNotifications = useStore.getState().notifications.filter(
      (n) => (n.type === "warning" || n.type === "error") && !n.spinner
    );
    if (isEscape) {
      stickyNotifications.forEach((n) => clearNotification(n.id));
      handleEscape();
      return;
    }

    // Sticky notifications (warnings/errors) are acknowledged with any other key.
    if (stickyNotifications.length > 0) {
      stickyNotifications.forEach((n) => clearNotification(n.id));
      return;
    }

    // Focus the search box (Discover/Installed only). Handled here — on the same
    // global input path as every other shortcut — so focus is reliable. The
    // searchFocused guard above then routes all subsequent keystrokes to the
    // TextInput until Esc/Enter exits.
    if (input === "/" && (tab === "discover" || tab === "installed") && !isOverlayOpen) {
      setSearchFocused(true);
      return;
    }

    // Manual refresh: git pull source repo + reload everything. Settings owns its
    // own "R" (a read-only remote fetch that recomputes the on-screen repo status
    // — ahead/behind, changed files) — falls through so SettingsPanel's useInput
    // gets it below, instead of this pull+refreshAll leaving that widget stale
    // (Settings already has an explicit, confirm-gated pull/reset menu action for
    // actually mutating the repo, so this isn't a loss of capability).
    if (input === "R" && tab !== "settings") {
      void pullSourceRepo()
        .then(() => refreshTabData(tab))
        .catch((error) => {
          notify(`Failed to refresh from source repo: ${error instanceof Error ? error.message : String(error)}`, "error");
        });
      return;
    }

    // Quit. Global shortcuts (including this one) are already suppressed while the
    // search box is focused via the searchFocused guard above. Also gated on
    // !isOverlayOpen — a detail/diff/tool-detail overlay is "detail" mode, not
    // "modal", so it doesn't hit the modal early-return above; without this guard
    // a reflexive `q` while reviewing a diff or item detail exits the ENTIRE app
    // (irreversibly losing all navigation state) instead of just backing out.
    if (input === "q" && !isOverlayOpen) {
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

    // Number keys 1-7 for tab navigation
    if (!isOverlayOpen) {
      const tabIdx = parseInt(input, 10);
      if (tabIdx >= 1 && tabIdx <= TABS.length) {
        setTab(TABS[tabIdx - 1]);
        return;
      }
    }

    // Settings tab: SettingsPanel handles its own input (up/down/enter/esc)
    if (tab === "settings") {
      return;
    }


    if (handleDiffInput(input, key)) return;

    // Namespace tree: handle right/enter (expand), left (collapse), cursor movement,
    // and action dispatch. Owns (swallows) all keys while a namespace tree is open.
    if (handleNamespaceTreeInput(input, key)) return;

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

    // Projects tab shortcuts.
    if (tab === "projects" && !isOverlayOpen) {
      // Apply a profile to the current workspace (works in list or drill-in).
      if (input === "P") {
        const target = projectDetailPath ? projects.find((p) => p.path === projectDetailPath) : projects[selectedIndex];
        if (target) {
          setProfileTargetPath(target.path);
          setModalVisible("applyProfile");
        }
        return;
      }
      const detailProject = projectDetailPath ? projects.find((p) => p.path === projectDetailPath) : null;
      if (detailProject) {
        // Drilled into a project — per-skill provisioning on the highlighted row.
        const row = buildProjectSkillRows(detailProject)[selectedIndex];
        if (!row) return;
        if (input === "p") {
          // Push source → project (add an available skill, or reset a present one).
          if (row.kind === "available") {
            void pushProjectSkill(detailProject.path, row.available.name, row.available.sourcePath);
          } else if (row.skill.sourcePath) {
            void pushProjectSkill(detailProject.path, row.skill.name, row.skill.sourcePath);
          } else {
            notify(`${row.skill.name} has no source-repo copy to push from`, "warning");
          }
          return;
        }
        if (row.kind === "present") {
          if (input === "u") {
            void pullProjectSkill(detailProject.path, row.skill.name, row.skill.diskPath, row.skill.sourcePath);
            return;
          }
          if (input === "e") {
            void toggleProjectSkill(detailProject.path, row.skill.name, row.skill.enabled);
            return;
          }
          if (input === "d") {
            void removeProjectSkill(row.skill.name, row.skill.diskPath);
            return;
          }
        }
        return;
      }
      // Project list.
      if (input === "a") {
        setModalVisible("addProject");
        return;
      }
      if (input === "A") {
        // Adopt sweep: capture unmanaged .agents/skills across all workspaces.
        setModalVisible("adoptSkills");
        return;
      }
      if (input === "d") {
        const target = projects[selectedIndex];
        // The synthetic global workspace isn't registered — can't be removed.
        if (target && !target.synthetic) void removeProject(target.path);
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
      const srcSuffix = kind === "skill" ? name : `${name}.md`;
      const targetPath = resolveInstalledPluginComponentPath(inst, plugin, kind as "skill" | "command" | "agent", name);
      if (!targetPath) continue;
      try {
        const dt = buildFileDiffTarget(`${kind}s/${name}`, srcSuffix,
          join(sourcePaths.pluginDir, `${kind}s`, srcSuffix),
          targetPath, instance);
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

        const suffix = kind === "skill" ? name : `${name}.md`;
        const sourcePath = join(sourcePaths.pluginDir, `${kind}s`, suffix);
        const targetPath = resolveInstalledPluginComponentPath(tool, plugin, kind, name);

        if (!targetPath || !existsSync(targetPath)) continue;

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

    // Any dispatched action can rebuild the detail's action list with a different
    // shape (e.g. "Uninstall from all tools" replaces per-instance rows with
    // Sync rows and shifts everything after them up). actionIndex is a raw numeric
    // position with no reclamp against the new list, so leaving it untouched can
    // silently land the cursor on a DIFFERENT, more destructive row than the one
    // just used (e.g. landing on "Delete everywhere" right after an uninstall,
    // one keypress from wiping the source-repo copy too — with no confirm gate).
    // Every action-list builder places bulk/destructive actions after the
    // per-instance status rows, so index 0 is always the safe row to land on.
    setActionIndex(0);
    await handleItemAction(item, action, buildDetailCallbacks({
      detail,
      setDetail,
      setDetailPluginDrift,
      closeDetail,
      openSkillDetail,
      openDiffForFile,
      openMissingSummaryForFile,
      installPlugin: doInstall,
      uninstallPlugin: doUninstall,
      updatePlugin: doUpdate,
      trackPluginInSource: doTrackPlugin,
      removePluginFromGit: doRemovePluginFromGit,
      installPluginToInstance: installPluginToInstanceCb,
      uninstallPluginFromInstance: uninstallPluginFromInstanceCb,
      refreshDetailPlugin,
      syncFiles: syncTools,
      pullbackFileInstance,
      pullbackPluginInstance: pullbackPluginInstanceCb,
      installPiPackage: doInstallPiPkg,
      uninstallPiPackage: doUninstallPiPkg,
      updatePiPackage: doUpdatePiPkg,
      trackPiPackageInSource: doTrackPiPkg,
      removePiPackageFromGit: doRemovePiPkgFromGit,
      deletePiPackageEverywhere: doDeletePiPkg,
      refreshDetailPiPackage,
      buildPluginDiffTarget: buildPluginDiffTargetCb,
    }));
  };

  const handleMarketplaceDetailAction = (index: number) => {
    if (!activeMarketplaceDetail) return;
    const { detail, actions } = activeMarketplaceDetail;
    const action = actions[index];
    if (!action) return;

    switch (action.type) {
      case "browse":
        // setTab resets discoverSubView/search/selectedIndex to defaults (it's a
        // full tab-change reset), so it must run FIRST — setting the sub-view
        // fields after it is what makes them stick, not the other way around.
        setTab("discover");
        if (detail.kind === "plugin") {
          setMarketplaceBrowseContext(detail.marketplace);
          setDiscoverSubView("plugins");
          setSelectedIndex(0);
          setSearch(detail.marketplace.name);
        } else {
          setDiscoverSubView("piPackages");
          setSelectedIndex(0);
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
          void removeMarketplace(detail.marketplace.name);
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

  const globalRefreshInProgress = loading || tabRefreshInProgress;

  const refreshTabLabel =
    tab === "discover"
      ? "Discover"
      : tab === "installed"
        ? "Installed"
        : tab === "marketplaces"
          ? "Marketplaces"
          : tab === "tools"
            ? "Tools"
            : tab === "projects"
              ? "Projects"
              : "Sync";

  useEffect(() => {
    if (!globalRefreshInProgress) {
      setShowRefreshIndicator(false);
      return;
    }

    const timer = setTimeout(() => setShowRefreshIndicator(true), 300);
    return () => clearTimeout(timer);
  }, [globalRefreshInProgress]);

  const handleAddMarketplace = (name: string, url: string) => {
    addMarketplace(name, url);
    setShowAddMarketplace(false);
  };

  const handleAddProject = (path: string) => {
    setModalVisible(null);
    void addProject(path);
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

  // Render the first active overlay from the registry (activeOverlay), or the tab
  // content when none is open. Byte-for-byte the same decision + JSX as the old
  // render ternary — only the priority order now comes from the single overlay
  // registry above instead of a hand-maintained conditional cascade. The non-null
  // assertions are sound: each case is reached only when that overlay's `active`
  // predicate (which gates the underlying state) is true.
  const renderActiveOverlay = (): React.ReactNode => {
    switch (activeOverlay?.kind) {
      case "sourceSetupWizard":
        return (
          <SourceSetupWizard
            onComplete={handleSourceWizardComplete}
            onSkip={handleSourceWizardSkip}
          />
        );
      case "diff":
        return (
          <DiffView
            target={diffTarget!}
            onClose={closeDiff}
            onPullBack={handleDiffPullBack}
          />
        );
      case "missingSummary":
        return (
          <MissingSummaryView
            summary={missingSummary!}
            instances={missingInstances}
            onSelectInstance={handleMissingInstanceSelect}
            onClose={closeMissingSummary}
          />
        );
      case "editToolModal":
        return (
          <EditToolModal
            tool={editingTool}
            onSubmit={handleToolConfigSave}
            onCancel={() => setEditingToolId(null)}
          />
        );
      case "addMarketplace":
        return <AddMarketplaceModal onSubmit={handleAddMarketplace} onCancel={() => setModalVisible(null)} />;
      case "addPiMarketplace":
        return <AddMarketplaceModal type="pi" onSubmit={(name, source) => { void addPiMarketplace(name, source); setModalVisible(null); }} onCancel={() => setModalVisible(null)} />;
      case "addProject":
        return <AddProjectModal onSubmit={handleAddProject} onCancel={() => setModalVisible(null)} />;
      case "adoptSkills":
        return (
          <AdoptModal
            skills={unmanagedSkills}
            onConfirm={() => { setModalVisible(null); void adoptUnmanagedSkills(); }}
            onCancel={() => setModalVisible(null)}
          />
        );
      case "applyProfile": {
        const target = projects.find((p) => p.path === profileTargetPath);
        return (
          <ProfilePickerModal
            profiles={profiles}
            workspaceName={target?.name ?? "workspace"}
            onApply={(name) => { setModalVisible(null); if (profileTargetPath) void applyProfile(profileTargetPath, name); }}
            onCancel={() => setModalVisible(null)}
          />
        );
      }
      case "toolActionModal":
        return (
          <ToolActionModal
            toolName={activeToolForModal!.displayName}
            action={toolModalAction!}
            command={getToolActionCommand(activeToolForModal!, toolModalAction!)}
            warning={toolModalWarning}
            preferredPackageManager={getPackageManager()}
            migrateSelected={toolModalMigrate}
            inProgress={toolModalRunning || toolActionInProgress === activeToolForModal!.toolId}
            done={toolModalDone}
            success={toolModalSuccess}
            output={toolActionOutput}
          />
        );
      case "toolDetail":
        return (
          <ToolDetail
            tool={detailTool!}
            detection={toolDetection[detailTool!.toolId] || null}
            pending={toolDetectionPending[detailTool!.toolId] === true}
          />
        );
      case "itemDetail":
        return detail?.kind === "namespace" && detailNamespace ? (
          <NamespaceDetail
            item={activeDetail!.item}
            selectedAction={actionIndex}
            expandedSkills={expandedSkills}
          />
        ) : (
          <ItemDetail
            item={activeDetail!.item}
            selectedAction={actionIndex}
            actions={activeDetail!.actions}
            metadata={activeDetail!.metadata}
          />
        );
      case "marketplaceDetail":
        return (
          <MarketplaceDetailView
            detail={activeMarketplaceDetail!.detail}
            selectedIndex={actionIndex}
          />
        );
      default:
        return (
          <TabContent
            tab={tab}
            searchFocused={searchFocused}
            onSearchFocus={() => setSearchFocused(true)}
            onSearchBlur={() => setSearchFocused(false)}
          />
        );
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar />

      <Box marginBottom={1}>
        {showRefreshIndicator ? (
          <Text color="cyan">↻ {tabRefreshInProgress ? `Refreshing ${refreshTabLabel}...` : "Loading..."}</Text>
        ) : (
          <Text color="gray"> </Text>
        )}
      </Box>

      {/* Active overlay (from the overlay registry) or the tab content. */}
      {renderActiveOverlay()}

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
