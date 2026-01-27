import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useStore } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginList } from "./components/PluginList.js";
import { AssetList } from "./components/AssetList.js";
import { PluginPreview } from "./components/PluginPreview.js";
import { AssetPreview } from "./components/AssetPreview.js";
import { PluginDetail } from "./components/PluginDetail.js";
import { AssetDetail } from "./components/AssetDetail.js";
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
import { getPluginToolStatus } from "./lib/install.js";
import type { Tab, SyncPreviewItem, Plugin, Asset } from "./lib/types.js";

const TABS: Tab[] = ["discover", "installed", "marketplaces", "tools", "sync"];

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    installedPlugins,
    assets,
    tools,
    search,
    setSearch,
    selectedIndex,
    setSelectedIndex,
    loading,
    error,
    detailPlugin,
    detailAsset,
    detailMarketplace,
    setDetailPlugin,
    setDetailAsset,
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
    notifications,
    clearNotification,
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewItem[]>([]);
  const [syncArmed, setSyncArmed] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "installed">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchFocused, setSearchFocused] = useState(false);

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
    setSyncArmed(false);
  }, [tab, marketplaces, installedPlugins, assets, getSyncPreview]);

  useEffect(() => {
    if (!syncArmed) return;
    const timeoutId = setTimeout(() => {
      setSyncArmed(false);
    }, 1500);
    return () => clearTimeout(timeoutId);
  }, [syncArmed]);



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

  const assetCount = filteredAssets.length;
  const pluginCount = filteredPlugins.length;
  const libraryCount = assetCount + pluginCount;

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
      | null => {
      if (tab !== "discover" && tab !== "installed") return null;
      if (selectedIndex < assetCount) {
        const asset = filteredAssets[selectedIndex];
        return asset ? { kind: "asset", asset } : null;
      }
      const pluginIndex = selectedIndex - assetCount;
      const plugin = filteredPlugins[pluginIndex];
      return plugin ? { kind: "plugin", plugin } : null;
    },
    [tab, selectedIndex, filteredPlugins, filteredAssets, assetCount]
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
      if (!detailPlugin && !detailAsset && !detailMarketplace) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx + 1) % TABS.length]);
        return;
      }
    }
    if (key.leftArrow) {
      if (!detailPlugin && !detailAsset && !detailMarketplace) {
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
      } else if (detailAsset) {
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
      }
      return;
    }

    // Space - toggle install/uninstall
    if (input === " " && !detailPlugin && !detailAsset && !detailMarketplace) {
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
        void syncTools(syncPreview);
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
        setDetailPlugin(null);
        break;
      case "Update now":
        await doUpdate(detailPlugin);
        break;
      case "Install to all tools":
      case "Install":
        await doInstall(detailPlugin);
        setDetailPlugin(null);
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
        setDetailAsset(null);
        break;
      case "Back to list":
        setDetailAsset(null);
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
    : `${allPlugins.length} plugins, ${assets.length} assets from ${marketplaces.length} marketplaces`;

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
                      ? "Search plugins and assets..."
                      : "Search installed plugins and assets..."
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
                  <Text color="gray">Assets</Text>
                  <AssetList
                    assets={filteredAssets}
                    selectedIndex={selectedIndex < assetCount ? selectedIndex : -1}
                    maxHeight={5}
                  />
                  <Text color="gray">Plugins</Text>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex >= assetCount ? selectedIndex - assetCount : -1}
                    maxHeight={7}
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
                  <Text color="gray">Assets</Text>
                  <AssetList
                    assets={filteredAssets}
                    selectedIndex={selectedIndex < assetCount ? selectedIndex : -1}
                    maxHeight={5}
                  />
                  <Text color="gray">Plugins</Text>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex >= assetCount ? selectedIndex - assetCount : -1}
                    maxHeight={7}
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
                    ? "Press y again to confirm sync"
                    : "Press y to sync missing or drifted items"}
                </Text>
              </Box>
              <SyncList items={syncPreview} selectedIndex={selectedIndex} />
            </>
          )}
        </Box>
      )}

      {(tab === "discover" || tab === "installed") && !detailPlugin && !detailAsset && !detailMarketplace && (
        selectedLibraryItem?.kind === "plugin" ? (
          <PluginPreview plugin={selectedLibraryItem.plugin} />
        ) : (
          <AssetPreview asset={selectedLibraryItem?.kind === "asset" ? selectedLibraryItem.asset : null} />
        )
      )}

      {tab === "sync" && !detailPlugin && !detailAsset && !detailMarketplace && (
        <SyncPreview item={syncPreview[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar tab={tab} hasDetail={Boolean(detailPlugin || detailAsset || detailMarketplace)} />
      <StatusBar
        loading={loading}
        message={statusMessage}
        error={error}
        enabledTools={enabledToolNames}
      />
    </Box>
  );
}
