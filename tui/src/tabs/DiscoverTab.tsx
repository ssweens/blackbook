import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { ItemList, PLUGIN_COLUMNS } from "../components/ItemList.js";
import { PluginSummary } from "../components/PluginSummary.js";
import { PiPackageSummary } from "../components/PiPackageSummary.js";
import { PluginPreview } from "../components/PluginPreview.js";
import { PiPackagePreview } from "../components/PiPackagePreview.js";
import { SearchBox } from "../components/SearchBox.js";
import { pluginsToManagedItems, piPackagesToManagedItems } from "../lib/managed-item.js";
import { sortAndFilterPiPackages } from "../lib/derived.js";

function getRange(selectedIdx: number, totalCount: number, maxHeight: number): string {
  if (totalCount === 0) return "";
  if (totalCount <= maxHeight) return `(${totalCount})`;
  const effectiveIndex = selectedIdx >= 0 ? selectedIdx : 0;
  const maxStart = Math.max(0, totalCount - maxHeight);
  const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);
  const end = Math.min(start + maxHeight, totalCount);
  return `(showing ${start + 1}-${end} of ${totalCount})`;
}

export interface DiscoverTabProps {
  contentHeight: number;
  searchFocused: boolean;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
}

export function DiscoverTab({ contentHeight, searchFocused, onSearchFocus, onSearchBlur }: DiscoverTabProps) {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const loading = useStore((s) => s.loading);
  const discoverSubView = useStore((s) => s.discoverSubView);
  const sortBy = useStore((s) => s.sortBy);
  const sortDir = useStore((s) => s.sortDir);
  const marketplaces = useStore((s) => s.marketplaces);
  const piPackages = useStore((s) => s.piPackages);
  const subViewIndex = selectedIndex;

  const allPlugins = useMemo(() => marketplaces.flatMap((m) => m.plugins), [marketplaces]);

  const filteredPlugins = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    let filtered = allPlugins;
    if (search) {
      filtered = allPlugins.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.description.toLowerCase().includes(lowerSearch) ||
          p.marketplace.toLowerCase().includes(lowerSearch)
      );
    }
    return [...filtered].sort((a, b) => {
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
  }, [allPlugins, search, sortBy, sortDir]);

  // Canonical filter+sort shared with App.tsx's keyboard-index math, so the
  // highlighted row always matches the Enter/Space target.
  const filteredPiPackages = useMemo(
    () => sortAndFilterPiPackages(piPackages, sortBy, sortDir, search),
    [piPackages, search, sortBy, sortDir],
  );

  const managedPlugins = useMemo(() => pluginsToManagedItems(filteredPlugins), [filteredPlugins]);
  const managedPiPackages = useMemo(() => piPackagesToManagedItems(filteredPiPackages), [filteredPiPackages]);

  const shouldShowEmpty = marketplaces.length === 0 && piPackages.length === 0;

  const selectedLibraryItem = useMemo(() => {
    if (discoverSubView === "plugins") return { kind: "pluginSummary" as const };
    if (discoverSubView === "piPackages") return { kind: "piPackageSummary" as const };
    if (selectedIndex === 0 && filteredPlugins.length > 0) return { kind: "pluginSummary" as const };
    if (selectedIndex === (filteredPlugins.length > 0 ? 1 : 0) && filteredPiPackages.length > 0) return { kind: "piPackageSummary" as const };
    return null;
  }, [discoverSubView, selectedIndex, filteredPlugins.length, filteredPiPackages.length]);

  if (shouldShowEmpty) {
    return (
      <Box marginY={1}>
        <Text color={loading ? "cyan" : "gray"}>
          {loading ? "⠋ Loading plugins from marketplaces..." : "No discovery data loaded. Press R to refresh."}
        </Text>
      </Box>
    );
  }

  if (discoverSubView === "plugins") {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexGrow={1}>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search plugins..."
              focus={searchFocused}
              onFocus={onSearchFocus}
              onBlur={onSearchBlur}
            />
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">
              Sort: {sortBy === "default" ? "Default" : sortBy === "name" ? "Name" : sortBy === "installed" ? "Installed" : "Popular"} {sortBy !== "default" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </Text>
          </Box>
        </Box>
        <Box marginBottom={1} marginTop={1}>
          <Text color="cyan" bold>Plugins </Text>
          <Text color="gray" dimColor>{getRange(subViewIndex, managedPlugins.length, 12)}</Text>
          <Text color="gray"> · Press Esc to go back</Text>
        </Box>
        <ItemList items={managedPlugins} selectedIndex={subViewIndex} maxHeight={Math.max(4, contentHeight - 9)} columns={PLUGIN_COLUMNS} />
        <Box marginTop={1}>
          <PluginPreview plugin={filteredPlugins[subViewIndex] ?? null} />
        </Box>
      </Box>
    );
  }

  if (discoverSubView === "piPackages") {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexGrow={1}>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search pi packages..."
              focus={searchFocused}
              onFocus={onSearchFocus}
              onBlur={onSearchBlur}
            />
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">
              Sort: {sortBy === "default" ? "Default" : sortBy === "name" ? "Name" : sortBy === "installed" ? "Installed" : "Popular"} {sortBy !== "default" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </Text>
          </Box>
        </Box>
        <Box marginBottom={1} marginTop={1}>
          <Text color="cyan" bold>Pi Packages </Text>
          <Text color="gray" dimColor>{getRange(subViewIndex, managedPiPackages.length, 12)}</Text>
          <Text color="gray"> · Press Esc to go back</Text>
        </Box>
        <ItemList items={managedPiPackages} selectedIndex={subViewIndex} maxHeight={Math.max(4, contentHeight - 9)} columns={PLUGIN_COLUMNS} />
        <Box marginTop={1}>
          <PiPackagePreview pkg={filteredPiPackages[subViewIndex] ?? null} />
        </Box>
      </Box>
    );
  }

  // Dashboard view
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexGrow={1}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search plugins and packages..."
            focus={searchFocused}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
          />
        </Box>
        <Box marginLeft={2}>
          <Text color="gray">
            Sort: {sortBy === "default" ? "Default" : sortBy === "name" ? "Name" : sortBy === "installed" ? "Installed" : "Popular"} {sortBy !== "default" ? (sortDir === "asc" ? "↑" : "↓") : ""}
          </Text>
        </Box>
      </Box>
      {filteredPlugins.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
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
  );
}
