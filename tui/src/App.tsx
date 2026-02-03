import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useStore } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginList } from "./components/PluginList.js";
import { AssetList } from "./components/AssetList.js";
import { ConfigList } from "./components/ConfigList.js";
import { PluginPreview } from "./components/PluginPreview.js";
import { AssetPreview } from "./components/AssetPreview.js";
import { ConfigPreview } from "./components/ConfigPreview.js";
import { PluginDetail } from "./components/PluginDetail.js";
import { AssetDetail, getAssetActions, type AssetAction } from "./components/AssetDetail.js";
import { ConfigDetail, getConfigActions, type ConfigAction } from "./components/ConfigDetail.js";
import { MarketplaceList } from "./components/MarketplaceList.js";
import { MarketplaceDetail } from "./components/MarketplaceDetail.js";
import { AddMarketplaceModal } from "./components/AddMarketplaceModal.js";
import { EditToolModal } from "./components/EditToolModal.js";
import { ToolsList } from "./components/ToolsList.js";
import { SyncList } from "./components/SyncList.js";
import { SyncPreview } from "./components/SyncPreview.js";
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
import { getPluginToolStatus, getConfigToolStatus } from "./lib/install.js";
import type { Tab, SyncPreviewItem, Plugin, Asset, ConfigFile, PiPackage, DiffInstanceRef, DiscoverSection, DiscoverSubView } from "./lib/types.js";

const TABS: Tab[] = ["discover", "installed", "marketplaces", "tools", "sync"];

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    installedPlugins,
    assets,
    configs,
    tools,
    search,
    setSearch,
    selectedIndex,
    setSelectedIndex,
    loading,
    error,
    detailPlugin,
    detailAsset,
    detailConfig,
    detailMarketplace,
    setDetailPlugin,
    setDetailAsset,
    setDetailConfig,
    setDetailMarketplace,
    loadMarketplaces,
    installPlugin: doInstall,
    uninstallPlugin: doUninstall,
    updatePlugin: doUpdate,
    updateMarketplace,
    removeMarketplace,
    addMarketplace,
    toggleToolEnabled,
    updateToolConfigDir,
    getSyncPreview,
    syncTools,
    notify,
    notifications,
    clearNotification,
    // Diff view
    diffTarget,
    missingSummary,
    missingSummarySourceAsset,
    missingSummarySourceConfig,
    openDiffForAsset,
    openDiffForConfig,
    openMissingSummaryForAsset,
    openMissingSummaryForConfig,
    openDiffFromSyncItem,
    closeDiff,
    closeMissingSummary,
    getMissingInstances,
    // Pi packages
    piPackages,
    detailPiPackage,
    setDetailPiPackage,
    loadPiPackages,
    refreshAll,
    installPiPackage: doInstallPiPkg,
    uninstallPiPackage: doUninstallPiPkg,
    updatePiPackage: doUpdatePiPkg,
    // Section navigation
    currentSection,
    setCurrentSection,
    discoverSubView,
    setDiscoverSubView,
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[]>([]);
  const [syncSelection, setSyncSelection] = useState<Set<string>>(new Set());
  const [syncArmed, setSyncArmed] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "name" | "installed" | "popularity">("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchFocused, setSearchFocused] = useState(false);
  const [subViewIndex, setSubViewIndex] = useState(0);

  const getSyncItemKey = (item: SyncPreviewItem) => {
    if (item.kind === "plugin") {
      return `plugin:${item.plugin.marketplace}:${item.plugin.name}`;
    }
    if (item.kind === "config") {
      return `config:${item.config.toolId}:${item.config.name}`;
    }
    return `asset:${item.asset.name}`;
  };

  const enabledToolNames = useMemo(
    () => tools.filter((tool) => tool.enabled).map((tool) => tool.name),
    [tools]
  );

  const editingTool = useMemo(
    () => tools.find((tool) => `${tool.toolId}:${tool.instanceId}` === editingToolId) || null,
    [tools, editingToolId]
  );

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (tab !== "sync") return;
    const preview = getSyncPreview();
    setSyncPreview((current) => {
      const isSame =
        preview.length === current.length &&
        preview.every((item, index) => {
          const existing = current[index];
          if (!existing) return false;
          if (existing.kind !== item.kind) return false;
          if (item.kind === "plugin" && existing.kind === "plugin") {
            return (
              existing.plugin.name === item.plugin.name &&
              existing.missingInstances.join("|") === item.missingInstances.join("|")
            );
          }
          if (item.kind === "asset" && existing.kind === "asset") {
            return (
              existing.asset.name === item.asset.name &&
              existing.missingInstances.join("|") === item.missingInstances.join("|") &&
              existing.driftedInstances.join("|") === item.driftedInstances.join("|")
            );
          }
          return false;
        });
      return isSame ? current : preview;
    });
    setSyncSelection((current) => {
      const next = new Set<string>();
      for (const item of preview) {
        const key = getSyncItemKey(item);
        if (current.has(key)) {
          next.add(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
    setSyncArmed(false);
  }, [tab, marketplaces, installedPlugins, assets, getSyncPreview]);

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
          p.description.toLowerCase().includes(lowerSearch)
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

  const filteredAssets = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? assets.filter((a) => a.installed) : assets;
    let filtered = base;
    if (search) {
      filtered = base.filter(
        (a) => a.name.toLowerCase().includes(lowerSearch) || (a.source || "").toLowerCase().includes(lowerSearch)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const aInstalled = a.installed ? 1 : 0;
      const bInstalled = b.installed ? 1 : 0;
      const cmp = bInstalled - aInstalled;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [tab, assets, search, sortBy, sortDir]);

  const filteredConfigs = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = tab === "installed" ? configs.filter((c) => c.installed) : configs;
    let filtered = base;
    if (search) {
      filtered = base.filter(
        (c) => c.name.toLowerCase().includes(lowerSearch) ||
               c.toolId.toLowerCase().includes(lowerSearch) ||
               (c.sourcePath || "").toLowerCase().includes(lowerSearch) ||
               (c.mappings?.map(m => `${m.source} ${m.target}`).join(" ") || "").toLowerCase().includes(lowerSearch)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const aInstalled = a.installed ? 1 : 0;
      const bInstalled = b.installed ? 1 : 0;
      const cmp = bInstalled - aInstalled;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.name.localeCompare(b.name);
    });

    return sorted;
  }, [tab, configs, search, sortBy, sortDir]);

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

  const libraryNameWidth = useMemo(() => {
    const pluginWidth = Math.min(30, maxLength(filteredPlugins.map((p) => p.name.length), 10));
    const assetWidth = Math.min(30, maxLength(filteredAssets.map((a) => a.name.length), 10));
    const configWidth = Math.min(30, maxLength(filteredConfigs.map((c) => c.name.length), 10));
    const piPkgWidth = Math.min(30, maxLength(filteredPiPackages.map((p) => p.name.length), 10));
    return Math.max(pluginWidth, assetWidth, configWidth, piPkgWidth);
  }, [filteredPlugins, filteredAssets, filteredConfigs, filteredPiPackages]);

  const marketplaceWidth = useMemo(() => {
    return maxLength(filteredPlugins.map((p) => p.marketplace.length), 10);
  }, [filteredPlugins]);

  const configCount = filteredConfigs.length;
  const assetCount = filteredAssets.length;
  const pluginCount = filteredPlugins.length;
  const piPkgCount = filteredPiPackages.length;

  // In Discover tab: Plugins and PiPackages are summary cards (1 item each if they have content)
  // In Installed tab: All sections are inline lists
  const pluginSectionCount = tab === "discover" ? (pluginCount > 0 ? 1 : 0) : pluginCount;
  const piPkgSectionCount = tab === "discover" ? (piPkgCount > 0 ? 1 : 0) : piPkgCount;
  const libraryCount = configCount + assetCount + pluginSectionCount + piPkgSectionCount;

  // Section boundaries for Tab/Shift+Tab navigation
  const sections = useMemo(() => {
    const result: Array<{ id: DiscoverSection; start: number; end: number }> = [];
    let offset = 0;

    if (configCount > 0) {
      result.push({ id: "configs", start: offset, end: offset + configCount - 1 });
      offset += configCount;
    }
    if (assetCount > 0) {
      result.push({ id: "assets", start: offset, end: offset + assetCount - 1 });
      offset += assetCount;
    }
    if (pluginSectionCount > 0) {
      result.push({ id: "plugins", start: offset, end: offset + pluginSectionCount - 1 });
      offset += pluginSectionCount;
    }
    if (piPkgSectionCount > 0) {
      result.push({ id: "piPackages", start: offset, end: offset + piPkgSectionCount - 1 });
    }

    return result;
  }, [configCount, assetCount, pluginSectionCount, piPkgSectionCount]);

  const currentSectionInfo = useMemo(() => {
    return sections.find((s) => selectedIndex >= s.start && selectedIndex <= s.end);
  }, [sections, selectedIndex]);

  const maxIndex = useMemo(() => {
    if (tab === "marketplaces") {
      return marketplaces.length; // +1 for "Add Marketplace"
    }
    if (tab === "tools") {
      return Math.max(0, tools.length - 1);
    }
    if (tab === "sync") {
      return Math.max(0, syncPreview.length - 1);
    }
    return Math.max(0, libraryCount - 1);
  }, [tab, marketplaces, tools, syncPreview, libraryCount]);

  const selectedLibraryItem = useMemo(
    ():
      | { kind: "plugin"; plugin: Plugin }
      | { kind: "asset"; asset: Asset }
      | { kind: "config"; config: ConfigFile }
      | { kind: "piPackage"; piPackage: PiPackage }
      | { kind: "pluginSummary" }
      | { kind: "piPackageSummary" }
      | null => {
      if (tab !== "discover" && tab !== "installed") return null;

      // Order: configs first, then assets, then plugins, then piPackages
      if (selectedIndex < configCount) {
        const config = filteredConfigs[selectedIndex];
        return config ? { kind: "config", config } : null;
      }
      if (selectedIndex < configCount + assetCount) {
        const asset = filteredAssets[selectedIndex - configCount];
        return asset ? { kind: "asset", asset } : null;
      }

      // In Discover: plugins/piPackages are summary cards
      // In Installed: they're inline lists
      if (tab === "discover") {
        if (pluginSectionCount > 0 && selectedIndex === configCount + assetCount) {
          return { kind: "pluginSummary" };
        }
        if (piPkgSectionCount > 0 && selectedIndex === configCount + assetCount + pluginSectionCount) {
          return { kind: "piPackageSummary" };
        }
      } else {
        // Installed tab - inline lists
        if (selectedIndex < configCount + assetCount + pluginCount) {
          const pluginIndex = selectedIndex - configCount - assetCount;
          const plugin = filteredPlugins[pluginIndex];
          return plugin ? { kind: "plugin", plugin } : null;
        }
        const piPkgIndex = selectedIndex - configCount - assetCount - pluginCount;
        const piPkg = filteredPiPackages[piPkgIndex];
        return piPkg ? { kind: "piPackage", piPackage: piPkg } : null;
      }

      return null;
    },
    [tab, selectedIndex, filteredPlugins, filteredAssets, filteredConfigs, filteredPiPackages,
     configCount, assetCount, pluginCount, pluginSectionCount, piPkgSectionCount]
  );

  const getPluginActions = (plugin: typeof detailPlugin) => {
    if (!plugin) return [] as string[];
    if (!plugin.installed) return ["Install", "Back to plugin list"];

    const toolStatuses = getPluginToolStatus(plugin);
    const supportedTools = toolStatuses.filter(t => t.supported && t.enabled);
    const installedCount = supportedTools.filter(t => t.installed).length;
    const needsRepair = installedCount < supportedTools.length && supportedTools.length > 0;
    const actions = ["Uninstall", "Update now"];
    if (needsRepair) actions.push("Install to all tools");
    actions.push("Back to plugin list");
    return actions;
  };

  const getPluginActionCount = (plugin: typeof detailPlugin) => {
    return getPluginActions(plugin).length;
  };

  // Asset and Config actions are now computed by the detail components
  // These wrappers handle the null check
  const assetActions = useMemo((): AssetAction[] => {
    return detailAsset ? getAssetActions(detailAsset) : [];
  }, [detailAsset]);

  const configActions = useMemo((): ConfigAction[] => {
    return detailConfig ? getConfigActions(detailConfig) : [];
  }, [detailConfig]);

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

  const refreshDetailAsset = (asset: Asset) => {
    const state = useStore.getState();
    const refreshed = state.assets.find((a) => a.name === asset.name);
    setDetailAsset(refreshed || asset);
  };

  const refreshDetailConfig = (config: ConfigFile) => {
    const state = useStore.getState();
    const refreshed = state.configs.find(
      (c) => c.name === config.name && c.toolId === config.toolId
    );
    setDetailConfig(refreshed || config);
  };

  useInput((input, key) => {
    // Don't handle input when modal is open (modal handles its own input)
    if (showAddMarketplace || editingToolId) {
      return;
    }

    // Quit
    if (input === "q" && !search) {
      exit();
      return;
    }

    // Tab/Shift+Tab for section navigation in Discover/Installed tabs
    if (key.tab && (tab === "discover" || tab === "installed") && !discoverSubView) {
      if (!detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage && !diffTarget && !missingSummary) {
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
      if (!detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage && !diffTarget && !missingSummary && !discoverSubView) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx + 1) % TABS.length]);
        return;
      }
    }
    if (key.leftArrow) {
      if (!detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage && !diffTarget && !missingSummary && !discoverSubView) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx - 1 + TABS.length) % TABS.length]);
        return;
      }
    }

    // Escape - go back
    if (key.escape) {
      if (detailPlugin) {
        setDetailPlugin(null);
        setActionIndex(0);
      } else if (detailAsset) {
        setDetailAsset(null);
        setActionIndex(0);
      } else if (detailConfig) {
        setDetailConfig(null);
        setActionIndex(0);
      } else if (detailMarketplace) {
        setDetailMarketplace(null);
        setActionIndex(0);
      } else if (detailPiPackage) {
        setDetailPiPackage(null);
        setActionIndex(0);
      } else if (discoverSubView) {
        // Close sub-view and return to Discover dashboard
        setDiscoverSubView(null);
        setSubViewIndex(0);
      }
      return;
    }

    // Up/Down navigation
    if (key.upArrow) {
      if (detailPlugin || detailMarketplace || detailPiPackage) {
        setActionIndex((i) => Math.max(0, i - 1));
      } else if (detailAsset || detailConfig) {
        setActionIndex((i) => Math.max(0, i - 1));
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
      if (detailPlugin) {
        const actionCount = getPluginActionCount(detailPlugin);
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailAsset) {
        setActionIndex((i) => Math.min(assetActions.length - 1, i + 1));
      } else if (detailConfig) {
        setActionIndex((i) => Math.min(configActions.length - 1, i + 1));
      } else if (detailPiPackage) {
        const actions = getPiPackageActions(detailPiPackage);
        setActionIndex((i) => Math.min(actions.length - 1, i + 1));
      } else if (detailMarketplace) {
        const maxActions = detailMarketplace.source === "claude" ? 2 : 3;
        setActionIndex((i) => Math.min(maxActions, i + 1));
      } else if (discoverSubView) {
        // Navigate within sub-view
        const maxSubViewIndex = discoverSubView === "plugins" ? filteredPlugins.length - 1 : filteredPiPackages.length - 1;
        setSubViewIndex((i) => Math.min(maxSubViewIndex, i + 1));
      } else {
        setSelectedIndex(Math.min(maxIndex, selectedIndex + 1));
        if (tab === "sync") {
          setSyncArmed(false);
        }
      }
      return;
    }

    // Enter - select
    if (key.return) {
      if (detailPlugin) {
        handlePluginAction(actionIndex);
        return;
      }

      if (detailAsset) {
        handleAssetAction(actionIndex);
        return;
      }

      if (detailConfig) {
        handleConfigAction(actionIndex);
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

      // Handle sub-view selection (Enter on item in sub-view opens detail)
      if (discoverSubView) {
        if (discoverSubView === "plugins") {
          const plugin = filteredPlugins[subViewIndex];
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
        const m = marketplaces[selectedIndex - 1];
        if (m) {
          setDetailMarketplace(m);
          setActionIndex(0);
        }
        return;
      }

      if (tab === "tools") {
        const tool = tools[selectedIndex];
        if (tool) {
          void toggleToolEnabled(tool.toolId, tool.instanceId);
        }
        return;
      }

      if (tab === "sync") {
        const item = syncPreview[selectedIndex];
        if (item) {
          if (item.kind === "plugin") {
            setDetailPlugin(item.plugin);
            setActionIndex(0);
          } else if (item.kind === "asset") {
            setDetailAsset(item.asset);
            setActionIndex(0);
          } else if (item.kind === "config") {
            setDetailConfig(item.config);
            setActionIndex(0);
          }
        }
        return;
      }

      if (selectedLibraryItem?.kind === "plugin") {
        setDetailPlugin(selectedLibraryItem.plugin);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "asset") {
        setDetailAsset(selectedLibraryItem.asset);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "config") {
        setDetailConfig(selectedLibraryItem.config);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "piPackage") {
        setDetailPiPackage(selectedLibraryItem.piPackage);
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
    if (input === " " && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage) {
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
        const tool = tools[selectedIndex];
        if (tool) {
          void toggleToolEnabled(tool.toolId, tool.instanceId);
        }
        return;
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
    if (input === "u" && tab === "marketplaces" && !detailMarketplace) {
      const m = marketplaces[selectedIndex - 1];
      if (m) updateMarketplace(m.name);
      return;
    }

    if (input === "r" && tab === "marketplaces" && !detailMarketplace) {
      const m = marketplaces[selectedIndex - 1];
      if (m) removeMarketplace(m.name);
      return;
    }

    if (input === "e" && tab === "tools") {
      const tool = tools[selectedIndex];
      if (tool) {
        setEditingToolId(`${tool.toolId}:${tool.instanceId}`);
      }
      return;
    }

    if (input === "y" && tab === "sync" && !detailPlugin && !detailAsset && !detailMarketplace && !detailConfig) {
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
    if (input === "d" && tab === "sync" && !detailPlugin && !detailAsset && !detailMarketplace && !detailConfig) {
      const item = syncPreview[selectedIndex];
      if (item) {
        openDiffFromSyncItem(item);
      }
      return;
    }

    // Sort shortcuts (s to cycle sort, r to reverse) - only when search not focused
    if ((tab === "discover" || tab === "installed") && !detailPlugin && !searchFocused) {
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
      case "Back to plugin list":
        setDetailPlugin(null);
        setActionIndex(0);
        break;
      default:
        break;
    }
  };

  const handleAssetAction = async (index: number) => {
    if (!detailAsset) return;
    const action = assetActions[index];
    if (!action) return;

    switch (action.type) {
      case "diff":
        if (action.instance) {
          openDiffForAsset(detailAsset, action.instance);
        }
        break;
      case "sync":
        await syncTools([{ kind: "asset", asset: detailAsset, missingInstances: [], driftedInstances: [] }]);
        refreshDetailAsset(detailAsset);
        break;
      case "back":
        setDetailAsset(null);
        setActionIndex(0);
        break;
      case "status":
        // Non-clickable status row - do nothing
        break;
    }
  };

  const handleConfigAction = async (index: number) => {
    if (!detailConfig) return;
    const action = configActions[index];
    if (!action) return;

    switch (action.type) {
      case "diff":
        if (action.instance) {
          openDiffForConfig(detailConfig, action.instance);
        }
        break;
      case "sync":
        await syncTools([{ kind: "config", config: detailConfig, drifted: Boolean(detailConfig.drifted), missing: !detailConfig.installed }]);
        refreshDetailConfig(detailConfig);
        break;
      case "back":
        setDetailConfig(null);
        setActionIndex(0);
        break;
      case "status":
        // Non-clickable status row - do nothing
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
        // Refresh the package after action
        const afterInstall = piPackages.find((p) => p.source === detailPiPackage.source);
        if (afterInstall) setDetailPiPackage(afterInstall);
        break;
      case "uninstall":
        await doUninstallPiPkg(detailPiPackage);
        const afterUninstall = piPackages.find((p) => p.source === detailPiPackage.source);
        if (afterUninstall) setDetailPiPackage(afterUninstall);
        break;
      case "update":
        await doUpdatePiPkg(detailPiPackage);
        const afterUpdate = piPackages.find((p) => p.source === detailPiPackage.source);
        if (afterUpdate) setDetailPiPackage(afterUpdate);
        break;
      case "back":
        setDetailPiPackage(null);
        setActionIndex(0);
        break;
    }
  };

  const handleMarketplaceAction = (index: number) => {
    if (!detailMarketplace) return;
    const isReadOnly = detailMarketplace.source === "claude";

    switch (index) {
      case 0: // Browse plugins
        setTab("discover");
        setSearch(detailMarketplace.name);
        setDetailMarketplace(null);
        break;
      case 1: // Update
        updateMarketplace(detailMarketplace.name);
        break;
      case 2: // Toggle auto-update
        break;
      case 3: // Remove (only for non-Claude marketplaces)
        if (!isReadOnly) {
          removeMarketplace(detailMarketplace.name);
          setDetailMarketplace(null);
        }
        break;
    }
  };

  const statusMessage = loading
    ? "Loading..."
    : `${allPlugins.length} plugins, ${piPackages.length} pi-pkgs, ${assets.length} assets, ${configs.length} configs from ${marketplaces.length} marketplaces`;

  const handleAddMarketplace = (name: string, url: string) => {
    addMarketplace(name, url);
    setShowAddMarketplace(false);
  };

  const handleToolConfigSave = (toolId: string, instanceId: string, configDir: string) => {
    void updateToolConfigDir(toolId, instanceId, configDir);
    setEditingToolId(null);
  };


  // Memoize instances for missing summary view (instance picker still needed there)
  const missingInstances = useMemo((): DiffInstanceRef[] => {
    if (missingSummary && missingSummary.kind === "asset" && missingSummarySourceAsset) {
      return getMissingInstances(missingSummarySourceAsset, "asset");
    }
    if (missingSummary && missingSummary.kind === "config" && missingSummarySourceConfig) {
      return getMissingInstances(missingSummarySourceConfig, "config");
    }
    return [];
  }, [missingSummary, missingSummarySourceAsset, missingSummarySourceConfig, getMissingInstances]);

  const handleMissingInstanceSelect = (instance: DiffInstanceRef) => {
    if (missingSummary?.kind === "asset" && missingSummarySourceAsset) {
      openMissingSummaryForAsset(missingSummarySourceAsset, instance);
    } else if (missingSummary?.kind === "config" && missingSummarySourceConfig) {
      openMissingSummaryForConfig(missingSummarySourceConfig, instance);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar activeTab={tab} onTabChange={setTab} />

      {/* Diff view overlay */}
      {diffTarget ? (
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
      ) : detailPlugin ? (
        <PluginDetail
          plugin={detailPlugin}
          selectedAction={actionIndex}
          onAction={() => {}}
        />
      ) : detailAsset ? (
        <AssetDetail
          asset={detailAsset}
          selectedAction={actionIndex}
          actions={assetActions}
        />
      ) : detailConfig ? (
        <ConfigDetail
          config={detailConfig}
          selectedAction={actionIndex}
          actions={configActions}
        />
      ) : detailMarketplace ? (
        <MarketplaceDetail
          marketplace={detailMarketplace}
          selectedIndex={actionIndex}
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
                      ? "Search plugins, assets, and configs..."
                      : "Search installed plugins, assets, and configs..."
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
              {loading ? (
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading plugins from marketplaces...</Text>
                </Box>
              ) : discoverSubView === "plugins" ? (
                // Plugins sub-view - full list
                <Box flexDirection="column">
                  <Box marginBottom={1}>
                    <Text color="cyan" bold>Plugins</Text>
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
                    <Text color="cyan" bold>Pi Packages</Text>
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
                  {filteredConfigs.length > 0 && (
                    <Box flexDirection="column">
                      <Box><Text color="gray">  Configs</Text></Box>
                      <ConfigList
                        configs={filteredConfigs}
                        selectedIndex={selectedIndex < configCount ? selectedIndex : -1}
                        maxHeight={2}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredAssets.length > 0 && (
                    <Box flexDirection="column" marginTop={filteredConfigs.length > 0 ? 1 : 0}>
                      <Box><Text color="gray">  Assets</Text></Box>
                      <AssetList
                        assets={filteredAssets}
                        selectedIndex={selectedIndex >= configCount && selectedIndex < configCount + assetCount ? selectedIndex - configCount : -1}
                        maxHeight={3}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredPlugins.length > 0 && (
                    <Box flexDirection="column" marginTop={(filteredConfigs.length > 0 || filteredAssets.length > 0) ? 1 : 0}>
                      <PluginSummary
                        plugins={filteredPlugins}
                        selected={selectedLibraryItem?.kind === "pluginSummary"}
                      />
                    </Box>
                  )}
                  {filteredPiPackages.length > 0 && (
                    <Box flexDirection="column" marginTop={(filteredConfigs.length > 0 || filteredAssets.length > 0 || filteredPlugins.length > 0) ? 1 : 0}>
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
              {loading ? (
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading installed plugins...</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {filteredConfigs.length > 0 && (
                    <Box flexDirection="column">
                      <Box><Text color="gray">  Configs</Text></Box>
                      <ConfigList
                        configs={filteredConfigs}
                        selectedIndex={selectedIndex < configCount ? selectedIndex : -1}
                        maxHeight={2}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredAssets.length > 0 && (
                    <Box flexDirection="column" marginTop={filteredConfigs.length > 0 ? 1 : 0}>
                      <Box><Text color="gray">  Assets</Text></Box>
                      <AssetList
                        assets={filteredAssets}
                        selectedIndex={selectedIndex >= configCount && selectedIndex < configCount + assetCount ? selectedIndex - configCount : -1}
                        maxHeight={3}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredPlugins.length > 0 && (
                    <Box flexDirection="column" marginTop={(filteredConfigs.length > 0 || filteredAssets.length > 0) ? 1 : 0}>
                      <Box><Text color="gray">  Plugins</Text></Box>
                      <PluginList
                        plugins={filteredPlugins}
                        selectedIndex={selectedIndex >= configCount + assetCount && selectedIndex < configCount + assetCount + pluginCount ? selectedIndex - configCount - assetCount : -1}
                        maxHeight={4}
                        nameColumnWidth={libraryNameWidth}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </Box>
                  )}
                  {filteredPiPackages.length > 0 && (
                    <Box flexDirection="column" marginTop={(filteredConfigs.length > 0 || filteredAssets.length > 0 || filteredPlugins.length > 0) ? 1 : 0}>
                      <Box><Text color="gray">  Pi Packages</Text></Box>
                      <PiPackageList
                        packages={filteredPiPackages}
                        selectedIndex={selectedIndex >= configCount + assetCount + pluginCount ? selectedIndex - configCount - assetCount - pluginCount : -1}
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
              {loading ? (
                <Box marginY={1}>
                  <Text color="cyan">⠋ Loading marketplaces...</Text>
                </Box>
              ) : (
                <MarketplaceList
                  marketplaces={marketplaces}
                  selectedIndex={selectedIndex}
                />
              )}
            </>
          )}

          {tab === "tools" && (
            <ToolsList tools={tools} selectedIndex={selectedIndex} />
          )}

          {tab === "sync" && (
            <>
              <Box>
                <Text color={syncArmed ? "yellow" : "gray"}>
                  {syncArmed
                    ? `Press y again to confirm sync (${selectedSyncCount} selected)`
                    : `Space to toggle · Press y to sync (${selectedSyncCount} selected)`}
                </Text>
              </Box>
              <SyncList
                items={syncPreview}
                selectedIndex={selectedIndex}
                selectedKeys={syncSelection}
                getItemKey={getSyncItemKey}
              />
            </>
          )}
        </Box>
      )}

      {(tab === "discover" || tab === "installed") && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage && (
        discoverSubView === "plugins" ? (
          <PluginPreview plugin={filteredPlugins[subViewIndex] ?? null} />
        ) : discoverSubView === "piPackages" ? (
          <PiPackagePreview pkg={filteredPiPackages[subViewIndex] ?? null} />
        ) : selectedLibraryItem?.kind === "plugin" ? (
          <PluginPreview plugin={selectedLibraryItem.plugin} />
        ) : selectedLibraryItem?.kind === "asset" ? (
          <AssetPreview asset={selectedLibraryItem.asset} />
        ) : selectedLibraryItem?.kind === "config" ? (
          <ConfigPreview config={selectedLibraryItem.config} />
        ) : selectedLibraryItem?.kind === "piPackage" ? (
          <PiPackagePreview pkg={selectedLibraryItem.piPackage} />
        ) : null
      )}

      {tab === "sync" && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && !detailPiPackage && (
        <SyncPreview item={syncPreview[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar tab={tab} hasDetail={Boolean(detailPlugin || detailAsset || detailConfig || detailMarketplace || detailPiPackage)} />
      <StatusBar
        loading={loading}
        message={statusMessage}
        error={error}
        enabledTools={enabledToolNames}
      />
    </Box>
  );
}
