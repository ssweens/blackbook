import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useStore } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginList } from "./components/PluginList.js";
import { PluginPreview } from "./components/PluginPreview.js";
import { PluginDetail } from "./components/PluginDetail.js";
import { MarketplaceList } from "./components/MarketplaceList.js";
import { MarketplaceDetail } from "./components/MarketplaceDetail.js";
import { AddMarketplaceModal } from "./components/AddMarketplaceModal.js";
import { EditToolModal } from "./components/EditToolModal.js";
import { ToolsList } from "./components/ToolsList.js";
import { HintBar } from "./components/HintBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Notifications } from "./components/Notifications.js";
import { getPluginToolStatus } from "./lib/install.js";
import type { Tab } from "./lib/types.js";

const TABS: Tab[] = ["discover", "installed", "marketplaces", "tools"];

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    installedPlugins,
    tools,
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
    installPlugin: doInstall,
    uninstallPlugin: doUninstall,
    updatePlugin: doUpdate,
    updateMarketplace,
    removeMarketplace,
    addMarketplace,
    toggleToolEnabled,
    updateToolConfigDir,
    notifications,
    clearNotification,
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
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

  const maxIndex = useMemo(() => {
    if (tab === "marketplaces") {
      return marketplaces.length; // +1 for "Add Marketplace"
    }
    if (tab === "tools") {
      return Math.max(0, tools.length - 1);
    }
    return Math.max(0, filteredPlugins.length - 1);
  }, [tab, marketplaces, tools, filteredPlugins]);

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
      if (!detailPlugin && !detailMarketplace) {
        const idx = TABS.indexOf(tab);
        setTab(TABS[(idx + 1) % TABS.length]);
        return;
      }
    }
    if (key.leftArrow) {
      if (!detailPlugin && !detailMarketplace) {
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
      } else {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (detailPlugin) {
        const actionCount = getPluginActionCount(detailPlugin);
        setActionIndex((i) => Math.min(actionCount - 1, i + 1));
      } else if (detailMarketplace) {
        const maxActions = detailMarketplace.source === "claude" ? 2 : 3;
        setActionIndex((i) => Math.min(maxActions, i + 1));
      } else {
        setSelectedIndex(Math.min(maxIndex, selectedIndex + 1));
      }
      return;
    }

    // Enter - select
    if (key.return) {
      if (detailPlugin) {
        handlePluginAction(actionIndex);
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

      const plugin = filteredPlugins[selectedIndex];
      if (plugin) {
        setDetailPlugin(plugin);
        setActionIndex(0);
      }
      return;
    }

    // Space - toggle install/uninstall
    if (input === " " && !detailPlugin && !detailMarketplace) {
      if (tab === "tools") {
        const tool = tools[selectedIndex];
        if (tool) {
          void toggleToolEnabled(tool.toolId, tool.instanceId);
        }
        return;
      }

      const plugin = filteredPlugins[selectedIndex];
      if (plugin?.installed) {
        doUninstall(plugin);
      } else if (plugin) {
        doInstall(plugin);
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
    : `${allPlugins.length} plugins from ${marketplaces.length} marketplaces`;

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
      ) : detailMarketplace ? (
        <MarketplaceDetail
          marketplace={detailMarketplace}
          selectedIndex={actionIndex}
        />
      ) : (
        <Box flexDirection="column" height={18}>
          {(tab === "discover" || tab === "installed") && (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexGrow={1}>
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder={
                    tab === "discover"
                      ? "Search available plugins..."
                      : "Search installed plugins..."
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
                  <Text color="gray">User</Text>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex}
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
                  <Text color="gray">User</Text>
                  <PluginList
                    plugins={filteredPlugins}
                    selectedIndex={selectedIndex}
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
        </Box>
      )}

      {(tab === "discover" || tab === "installed") && !detailPlugin && !detailMarketplace && (
        <PluginPreview plugin={filteredPlugins[selectedIndex] ?? null} />
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar tab={tab} hasDetail={Boolean(detailPlugin || detailMarketplace)} />
      <StatusBar
        loading={loading}
        message={statusMessage}
        error={error}
        enabledTools={enabledToolNames}
      />
    </Box>
  );
}
