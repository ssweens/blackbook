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
import { AssetDetail } from "./components/AssetDetail.js";
import { ConfigDetail } from "./components/ConfigDetail.js";
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
import { getPluginToolStatus, getConfigToolStatus } from "./lib/install.js";
import type { Tab, SyncPreviewItem, Plugin, Asset, ConfigFile } from "./lib/types.js";

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
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[]>([]);
  const [syncSelection, setSyncSelection] = useState<Set<string>>(new Set());
  const [syncArmed, setSyncArmed] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "installed">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchFocused, setSearchFocused] = useState(false);

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
    loadMarketplaces();
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
        (a) => a.name.toLowerCase().includes(lowerSearch) || a.source.toLowerCase().includes(lowerSearch)
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
               c.sourcePath.toLowerCase().includes(lowerSearch)
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

  const maxLength = (values: number[], fallback: number) => {
    if (values.length === 0) return fallback;
    return Math.max(...values, fallback);
  };

  const libraryNameWidth = useMemo(() => {
    const pluginWidth = Math.min(30, maxLength(filteredPlugins.map((p) => p.name.length), 10));
    const assetWidth = Math.min(30, maxLength(filteredAssets.map((a) => a.name.length), 10));
    const configWidth = Math.min(30, maxLength(filteredConfigs.map((c) => c.name.length), 10));
    return Math.max(pluginWidth, assetWidth, configWidth);
  }, [filteredPlugins, filteredAssets, filteredConfigs]);

  const marketplaceWidth = useMemo(() => {
    return maxLength(filteredPlugins.map((p) => p.marketplace.length), 10);
  }, [filteredPlugins]);

  const configCount = filteredConfigs.length;
  const assetCount = filteredAssets.length;
  const pluginCount = filteredPlugins.length;
  const libraryCount = configCount + assetCount + pluginCount;

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
      | null => {
      if (tab !== "discover" && tab !== "installed") return null;
      // Order: configs first, then assets, then plugins
      if (selectedIndex < configCount) {
        const config = filteredConfigs[selectedIndex];
        return config ? { kind: "config", config } : null;
      }
      if (selectedIndex < configCount + assetCount) {
        const asset = filteredAssets[selectedIndex - configCount];
        return asset ? { kind: "asset", asset } : null;
      }
      const pluginIndex = selectedIndex - configCount - assetCount;
      const plugin = filteredPlugins[pluginIndex];
      return plugin ? { kind: "plugin", plugin } : null;
    },
    [tab, selectedIndex, filteredPlugins, filteredAssets, filteredConfigs, configCount, assetCount]
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

  const getAssetActions = (asset: typeof detailAsset) => {
    if (!asset) return [] as string[];
    const actions = [] as string[];
    if (asset.partial || asset.drifted || !asset.installed) {
      actions.push("Sync to all tools");
    }
    actions.push("Back to list");
    return actions;
  };

  const getConfigActions = (config: typeof detailConfig) => {
    if (!config) return [] as string[];
    const actions = [] as string[];
    const statuses = getConfigToolStatus(config);
    const enabledStatuses = statuses.filter((s) => s.enabled);
    const needsSync = enabledStatuses.some((s) => !s.installed || s.drifted);
    if (needsSync) {
      actions.push("Sync to tool");
    }
    actions.push("Back to list");
    return actions;
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

    // Tab navigation
    if (key.tab || key.rightArrow) {
      if (!detailPlugin && !detailAsset && !detailConfig && !detailMarketplace) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx + 1) % TABS.length]);
        return;
      }
    }
    if (key.leftArrow) {
      if (!detailPlugin && !detailAsset && !detailConfig && !detailMarketplace) {
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
      }
      return;
    }

    // Up/Down navigation
    if (key.upArrow) {
      if (detailPlugin || detailMarketplace) {
        setActionIndex((i) => Math.max(0, i - 1));
      } else if (detailAsset || detailConfig) {
        setActionIndex((i) => Math.max(0, i - 1));
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
        const actionCount = getAssetActions(detailAsset).length;
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailConfig) {
        const actionCount = getConfigActions(detailConfig).length;
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailMarketplace) {
        const maxActions = detailMarketplace.source === "claude" ? 2 : 3;
        setActionIndex((i) => Math.min(maxActions, i + 1));
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

      if (detailMarketplace) {
        handleMarketplaceAction(actionIndex);
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

      if (selectedLibraryItem?.kind === "plugin") {
        setDetailPlugin(selectedLibraryItem.plugin);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "asset") {
        setDetailAsset(selectedLibraryItem.asset);
        setActionIndex(0);
      } else if (selectedLibraryItem?.kind === "config") {
        setDetailConfig(selectedLibraryItem.config);
        setActionIndex(0);
      }
      return;
    }

    // Space - toggle install/uninstall
    if (input === " " && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace) {
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

      if (selectedLibraryItem?.kind === "plugin") {
        const plugin = selectedLibraryItem.plugin;
        if (plugin.installed) {
          doUninstall(plugin);
        } else {
          doInstall(plugin);
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

    if (input === "y" && tab === "sync" && !detailPlugin && !detailAsset && !detailMarketplace) {
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

    // Sort shortcuts (s to cycle sort, r to reverse) - only when search not focused
    if ((tab === "discover" || tab === "installed") && !detailPlugin && !searchFocused) {
      if (input === "s") {
        setSortBy((prev) => (prev === "name" ? "installed" : "name"));
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
    const actions = getAssetActions(detailAsset);
    const action = actions[index];
    if (!action) return;

    switch (action) {
      case "Sync to all tools":
        await syncTools([{ kind: "asset", asset: detailAsset, missingInstances: [], driftedInstances: [] }]);
        refreshDetailAsset(detailAsset);
        break;
      case "Back to list":
        setDetailAsset(null);
        setActionIndex(0);
        break;
      default:
        break;
    }
  };

  const handleConfigAction = async (index: number) => {
    if (!detailConfig) return;
    const actions = getConfigActions(detailConfig);
    const action = actions[index];
    if (!action) return;

    switch (action) {
      case "Sync to tool":
        await syncTools([{ kind: "config", config: detailConfig, drifted: Boolean(detailConfig.drifted), missing: !detailConfig.installed }]);
        refreshDetailConfig(detailConfig);
        break;
      case "Back to list":
        setDetailConfig(null);
        setActionIndex(0);
        break;
      default:
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
    : `${allPlugins.length} plugins, ${assets.length} assets, ${configs.length} configs from ${marketplaces.length} marketplaces`;

  const handleAddMarketplace = (name: string, url: string) => {
    addMarketplace(name, url);
    setShowAddMarketplace(false);
  };

  const handleToolConfigSave = (toolId: string, instanceId: string, configDir: string) => {
    void updateToolConfigDir(toolId, instanceId, configDir);
    setEditingToolId(null);
  };


  return (
    <Box flexDirection="column" padding={1}>
      <TabBar activeTab={tab} onTabChange={setTab} />

      {editingToolId ? (
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
        />
      ) : detailConfig ? (
        <ConfigDetail
          config={detailConfig}
          selectedAction={actionIndex}
        />
      ) : detailMarketplace ? (
        <MarketplaceDetail
          marketplace={detailMarketplace}
          selectedIndex={actionIndex}
        />
      ) : (
        <Box flexDirection="column" height={(tab === "discover" || tab === "installed" || tab === "sync") ? 18 : 23}>
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
                  Sort: {sortBy === "name" ? "Name" : "Installed"} {sortDir === "asc" ? "↑" : "↓"}
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
              ) : (
                <>
                  {filteredConfigs.length > 0 && (
                    <>
                      <Box marginTop={1}>
                        <Text color="gray">  Configs</Text>
                      </Box>
                      <ConfigList
                        configs={filteredConfigs}
                        selectedIndex={selectedIndex < configCount ? selectedIndex : -1}
                        maxHeight={3}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </>
                  )}
                  <Box marginTop={1}>
                    <Text color="gray">  Assets</Text>
                  </Box>
                  <AssetList
                    assets={filteredAssets}
                    selectedIndex={selectedIndex >= configCount && selectedIndex < configCount + assetCount ? selectedIndex - configCount : -1}
                    maxHeight={4}
                    nameColumnWidth={libraryNameWidth}
                    typeColumnWidth={6}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                  <Box marginTop={1}>
                    <Text color="gray">  Plugins</Text>
                  </Box>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex >= configCount + assetCount ? selectedIndex - configCount - assetCount : -1}
                    maxHeight={5}
                    nameColumnWidth={libraryNameWidth}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                </>
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
                <>
                  {filteredConfigs.length > 0 && (
                    <>
                      <Box marginTop={1}>
                        <Text color="gray">  Configs</Text>
                      </Box>
                      <ConfigList
                        configs={filteredConfigs}
                        selectedIndex={selectedIndex < configCount ? selectedIndex : -1}
                        maxHeight={3}
                        nameColumnWidth={libraryNameWidth}
                        typeColumnWidth={6}
                        marketplaceColumnWidth={marketplaceWidth}
                      />
                    </>
                  )}
                  <Box marginTop={1}>
                    <Text color="gray">  Assets</Text>
                  </Box>
                  <AssetList
                    assets={filteredAssets}
                    selectedIndex={selectedIndex >= configCount && selectedIndex < configCount + assetCount ? selectedIndex - configCount : -1}
                    maxHeight={4}
                    nameColumnWidth={libraryNameWidth}
                    typeColumnWidth={6}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                  <Box marginTop={1}>
                    <Text color="gray">  Plugins</Text>
                  </Box>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex >= configCount + assetCount ? selectedIndex - configCount - assetCount : -1}
                    maxHeight={5}
                    nameColumnWidth={libraryNameWidth}
                    marketplaceColumnWidth={marketplaceWidth}
                  />
                </>
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

      {(tab === "discover" || tab === "installed") && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && (
        selectedLibraryItem?.kind === "plugin" ? (
          <PluginPreview plugin={selectedLibraryItem.plugin} />
        ) : selectedLibraryItem?.kind === "asset" ? (
          <AssetPreview asset={selectedLibraryItem.asset} />
        ) : selectedLibraryItem?.kind === "config" ? (
          <ConfigPreview config={selectedLibraryItem.config} />
        ) : null
      )}

      {tab === "sync" && !detailPlugin && !detailAsset && !detailConfig && !detailMarketplace && (
        <SyncPreview item={syncPreview[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar tab={tab} hasDetail={Boolean(detailPlugin || detailAsset || detailConfig || detailMarketplace)} />
      <StatusBar
        loading={loading}
        message={statusMessage}
        error={error}
        enabledTools={enabledToolNames}
      />
    </Box>
  );
}
