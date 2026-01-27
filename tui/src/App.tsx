import React, { useEffect, useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useStore } from "./lib/store.js";
import { TabBar } from "./components/TabBar.js";
import { SearchBox } from "./components/SearchBox.js";
import { PluginList } from "./components/PluginList.js";
import { PluginDetail } from "./components/PluginDetail.js";
import { MarketplaceList } from "./components/MarketplaceList.js";
import { MarketplaceDetail } from "./components/MarketplaceDetail.js";
import { AddMarketplaceModal } from "./components/AddMarketplaceModal.js";
import { HintBar } from "./components/HintBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Notifications } from "./components/Notifications.js";
import { getPluginToolStatus } from "./lib/install.js";
import type { Tab } from "./lib/types.js";

const TABS: Tab[] = ["discover", "installed", "marketplaces"];

export function App() {
  const { exit } = useApp();
  const {
    tab,
    setTab,
    marketplaces,
    installedPlugins,
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
    notifications,
    clearNotification,
  } = useStore();

  const [actionIndex, setActionIndex] = useState(0);
  const [showAddMarketplace, setShowAddMarketplace] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "installed">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchFocused, setSearchFocused] = useState(false);

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
    return Math.max(0, filteredPlugins.length - 1);
  }, [tab, marketplaces, filteredPlugins]);

  const getPluginActionCount = (plugin: typeof detailPlugin) => {
    if (!plugin) return 0;
    if (!plugin.installed) return 2; // Install, Back
    
    const toolStatuses = getPluginToolStatus(plugin);
    const supportedTools = toolStatuses.filter(t => t.supported);
    const installedCount = supportedTools.filter(t => t.installed).length;
    const needsRepair = installedCount < supportedTools.length && supportedTools.length > 0;
    
    return needsRepair ? 4 : 3; // Uninstall, Update, [Install to all], Back
  };

  useInput((input, key) => {
    // Don't handle input when modal is open (modal handles its own input)
    if (showAddMarketplace) {
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

      const plugin = filteredPlugins[selectedIndex];
      if (plugin) {
        setDetailPlugin(plugin);
        setActionIndex(0);
      }
      return;
    }

    // Space - toggle install/uninstall
    if (input === " " && !detailPlugin && !detailMarketplace) {
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

    if (detailPlugin.installed) {
      const toolStatuses = getPluginToolStatus(detailPlugin);
      const supportedTools = toolStatuses.filter(t => t.supported);
      const installedCount = supportedTools.filter(t => t.installed).length;
      const needsRepair = installedCount < supportedTools.length && supportedTools.length > 0;
      
      // Actions: ["Uninstall", "Update now", ["Install to all tools"], "Back to plugin list"]
      switch (index) {
        case 0: // Uninstall
          await doUninstall(detailPlugin);
          setDetailPlugin(null);
          break;
        case 1: // Update now
          await doUpdate(detailPlugin);
          break;
        case 2:
          if (needsRepair) {
            // Install to all tools
            await doInstall(detailPlugin);
          } else {
            // Back
            setDetailPlugin(null);
            setActionIndex(0);
          }
          break;
        case 3: // Back (when repair option exists)
          setDetailPlugin(null);
          setActionIndex(0);
          break;
      }
    } else {
      // Actions: ["Install", "Back to plugin list"]
      switch (index) {
        case 0: // Install
          await doInstall(detailPlugin);
          setDetailPlugin(null);
          break;
        case 1: // Back
          setDetailPlugin(null);
          setActionIndex(0);
          break;
      }
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

  return (
    <Box flexDirection="column" padding={1}>
      <TabBar activeTab={tab} onTabChange={setTab} />

      {showAddMarketplace ? (
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
        <>
          {tab !== "marketplaces" && (
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
                    showNested
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
                    showNested
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
        </>
      )}

      <Notifications notifications={notifications} onClear={clearNotification} />
      <HintBar tab={tab} hasDetail={Boolean(detailPlugin || detailMarketplace)} />
      <StatusBar loading={loading} message={statusMessage} error={error} />
    </Box>
  );
}
