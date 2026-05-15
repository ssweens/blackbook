import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { ItemList, FILE_COLUMNS, PLUGIN_COLUMNS } from "../components/ItemList.js";
import { SearchBox } from "../components/SearchBox.js";
import { PluginPreview } from "../components/PluginPreview.js";
import { PiPackagePreview } from "../components/PiPackagePreview.js";
import { FilePreview } from "../components/FilePreview.js";
import { filesToManagedItems, pluginsToManagedItems, piPackagesToManagedItems } from "../lib/managed-item.js";
import { getToolInstances } from "../lib/config.js";
import type { FileStatus } from "../lib/types.js";

function getRange(selectedIdx: number, totalCount: number, maxHeight: number): string {
  if (totalCount === 0) return "";
  if (totalCount <= maxHeight) return `(${totalCount})`;
  const effectiveIndex = selectedIdx >= 0 ? selectedIdx : 0;
  const maxStart = Math.max(0, totalCount - maxHeight);
  const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);
  const end = Math.min(start + maxHeight, totalCount);
  return `(showing ${start + 1}-${end} of ${totalCount})`;
}

function isInstalledFile(file: FileStatus): boolean {
  if (file.instances.length === 0) return false;
  return file.instances.some((i) => {
    if (i.status === "missing") return false;
    if (i.status === "failed") {
      try {
        const { existsSync } = require("fs");
        return existsSync(i.targetPath);
      } catch {
        return false;
      }
    }
    return true;
  });
}

export function InstalledTab() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const sortBy = useStore((s) => s.sortBy);
  const sortDir = useStore((s) => s.sortDir);
  const files = useStore((s) => s.files);
  const filesLoaded = useStore((s) => s.filesLoaded);
  const installedPlugins = useStore((s) => s.installedPlugins);
  const installedPluginsLoaded = useStore((s) => s.installedPluginsLoaded);
  const piPackages = useStore((s) => s.piPackages);
  const piPackagesLoaded = useStore((s) => s.piPackagesLoaded);
  const loadInstalledPlugins = useStore((s) => s.loadInstalledPlugins);
  const loadFiles = useStore((s) => s.loadFiles);
  const loadPiPackages = useStore((s) => s.loadPiPackages);

  React.useEffect(() => {
    void loadInstalledPlugins();
    void loadPiPackages();
    void loadFiles();
  }, [loadInstalledPlugins, loadPiPackages, loadFiles]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q.length === 0 ? files : files.filter((file) => {
      const toolScope = file.tools?.join(", ") ?? "";
      return (
        file.name.toLowerCase().includes(q) ||
        file.source.toLowerCase().includes(q) ||
        file.target.toLowerCase().includes(q) ||
        toolScope.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [files, search, sortDir]);

  const standaloneSkills = useStore((s) => (s as any).standaloneSkills as import("../lib/install.js").StandaloneSkill[] ?? []);

  const filteredSkills = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = search
      ? standaloneSkills.filter((s) => s.name.toLowerCase().includes(lowerSearch))
      : standaloneSkills;
    // Convert to ManagedItem so we can reuse ItemList
    // Tools that support skills (any enabled tool instance with a skillsSubdir).
    const skillCapableTools = new Set(
      getToolInstances()
        .filter((i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir)
        .map((i) => i.toolId),
    );
    return base.map((s): import("../lib/managed-item.js").ManagedItem => {
      const toolIds = s.installations.map((i) => i.toolId);
      const uniqueTools = Array.from(new Set(toolIds));
      const isInstalled = s.installations.length > 0;
      // If installed in every tool that supports skills, treat as "All tools" (empty array).
      const isEverywhere =
        isInstalled &&
        uniqueTools.length === skillCapableTools.size &&
        uniqueTools.every((t) => skillCapableTools.has(t));
      // Label for skills not yet installed anywhere (exist only in source repo).
      const scopeLabel = isInstalled
        ? uniqueTools.join(", ")
        : "source only";
      return {
        name: s.name,
        kind: "file" as const,
        marketplace: scopeLabel,
        description: `Standalone skill · ${scopeLabel}`,
        installed: isInstalled,
        incomplete: false,
        scope: "user" as const,
        tools: isEverywhere ? [] : uniqueTools,
        instances: s.installations.map((i) => ({
          toolId: i.toolId,
          instanceId: i.instanceId,
          instanceName: i.instanceName,
          configDir: i.diskPath,
          // "changed" propagates to ItemFlags.changed which renders the yellow
          // 'changed' badge on the list row.
          status: i.drifted ? "changed" as const : "synced" as const,
          sourcePath: i.diskPath,
          targetPath: i.diskPath,
          linesAdded: 0,
          linesRemoved: 0,
        })),
        _skill: s,
      };
    });
  }, [standaloneSkills, search]);

  const filteredPlugins = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = installedPlugins;
    const filtered = search
      ? base.filter(
          (p) =>
            p.name.toLowerCase().includes(lowerSearch) ||
            p.description.toLowerCase().includes(lowerSearch) ||
            p.marketplace.toLowerCase().includes(lowerSearch)
        )
      : base;
    return [...filtered].sort((a, b) => {
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
  }, [installedPlugins, search, sortBy, sortDir]);

  const filteredPiPackages = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const base = piPackages.filter((p) => p.installed);
    const filtered = search
      ? base.filter(
          (p) =>
            p.name.toLowerCase().includes(lowerSearch) ||
            p.description.toLowerCase().includes(lowerSearch) ||
            p.marketplace.toLowerCase().includes(lowerSearch)
        )
      : base;
    return [...filtered].sort((a, b) => {
      if (sortBy === "default") {
        if (a.installed !== b.installed) return a.installed ? -1 : 1;
        if (!a.installed && !b.installed) {
          const aIsNpm = a.sourceType === "npm";
          const bIsNpm = b.sourceType === "npm";
          if (aIsNpm !== bIsNpm) return aIsNpm ? 1 : -1;
          if (aIsNpm && bIsNpm) {
            const aDownloads = a.weeklyDownloads ?? 0;
            const bDownloads = b.weeklyDownloads ?? 0;
            if (aDownloads !== bDownloads) return bDownloads - aDownloads;
          }
        }
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "popularity") {
        const aDownloads = a.weeklyDownloads ?? 0;
        const bDownloads = b.weeklyDownloads ?? 0;
        const cmp = bDownloads - aDownloads;
        if (cmp !== 0) return sortDir === "desc" ? cmp : -cmp;
        return a.name.localeCompare(b.name);
      }
      const aInstalled = a.installed ? 1 : 0;
      const bInstalled = b.installed ? 1 : 0;
      const cmp = bInstalled - aInstalled;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return a.name.localeCompare(b.name);
    });
  }, [piPackages, search, sortBy, sortDir]);

  const pluginDriftMap = useStore((s) => s.pluginDriftMap);

  const managedFiles    = useMemo(() => filesToManagedItems(filteredFiles), [filteredFiles]);
  const managedPlugins  = useMemo(() => {
    return filteredPlugins.map((p) => {
      const item = pluginsToManagedItems([p])[0]!;
      const drift = pluginDriftMap[p.name];
      if (drift && Object.values(drift).some((s) => s !== "in-sync")) {
        return { ...item, instances: item.instances.map((inst) => ({ ...inst, status: "changed" as const })) };
      }
      return item;
    });
  }, [filteredPlugins, pluginDriftMap]);
  const managedPiPackages = useMemo(() => piPackagesToManagedItems(filteredPiPackages), [filteredPiPackages]);

  const fileCount   = filteredFiles.length;
  const skillCount  = filteredSkills.length;
  const pluginCount = filteredPlugins.length;

  const selectedLibraryItem = useMemo(() => {
    if (selectedIndex < fileCount) {
      const file = filteredFiles[selectedIndex];
      return file ? { kind: "file" as const, file } : null;
    }
    if (selectedIndex < fileCount + skillCount) {
      // Skills are StandaloneSkill, not Plugin — no detail view yet
      return null;
    }
    if (selectedIndex < fileCount + skillCount + pluginCount) {
      const plugin = filteredPlugins[selectedIndex - fileCount - skillCount];
      return plugin ? { kind: "plugin" as const, plugin } : null;
    }
    const piPkg = filteredPiPackages[selectedIndex - fileCount - skillCount - pluginCount];
    return piPkg ? { kind: "piPackage" as const, piPackage: piPkg } : null;
  }, [selectedIndex, fileCount, skillCount, pluginCount, filteredFiles, filteredSkills, filteredPlugins, filteredPiPackages]);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexGrow={1}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search installed files and plugins..."
          />
        </Box>
        <Box marginLeft={2}>
          <Text color="gray">
            Sort: {sortBy === "default" ? "Default" : sortBy === "name" ? "Name" : sortBy === "installed" ? "Installed" : "Popular"} {sortBy !== "default" ? (sortDir === "asc" ? "↑" : "↓") : ""}
          </Text>
        </Box>
      </Box>

      {(managedFiles.length > 0 || !filesLoaded) && (
        <Box flexDirection="column" flexShrink={0}>
          <Box>
            <Text color="gray">  Files </Text>
            <Text color="gray" dimColor>
              {managedFiles.length > 0
                ? getRange(selectedIndex < fileCount ? selectedIndex : 0, managedFiles.length, 5)
                : "(loading...)"}
            </Text>
          </Box>
          {managedFiles.length > 0 ? (
            <ItemList items={managedFiles} selectedIndex={selectedIndex < fileCount ? selectedIndex : -1} maxHeight={5} columns={FILE_COLUMNS} />
          ) : (
            <Box marginLeft={2}><Text color="cyan">⠋ Loading files...</Text></Box>
          )}
        </Box>
      )}

      {filteredSkills.length > 0 && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Box>
            <Text color="gray">  Skills </Text>
            <Text color="gray" dimColor>{getRange(selectedIndex >= fileCount && selectedIndex < fileCount + skillCount ? selectedIndex - fileCount : 0, filteredSkills.length, 4)}</Text>
          </Box>
          <ItemList
            items={filteredSkills}
            selectedIndex={selectedIndex >= fileCount && selectedIndex < fileCount + skillCount ? selectedIndex - fileCount : -1}
            maxHeight={4}
            columns={FILE_COLUMNS}
          />
        </Box>
      )}

      {(managedPlugins.length > 0 || !installedPluginsLoaded) && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Box>
            <Text color="gray">  Plugins </Text>
            <Text color="gray" dimColor>
              {managedPlugins.length > 0
                ? getRange(selectedIndex >= fileCount + skillCount && selectedIndex < fileCount + skillCount + pluginCount ? selectedIndex - fileCount - skillCount : 0, managedPlugins.length, 4)
                : "(loading...)"}
            </Text>
          </Box>
          {managedPlugins.length > 0 ? (
            <ItemList items={managedPlugins} selectedIndex={selectedIndex >= fileCount + skillCount && selectedIndex < fileCount + skillCount + pluginCount ? selectedIndex - fileCount - skillCount : -1} maxHeight={4} columns={PLUGIN_COLUMNS} />
          ) : (
            <Box marginLeft={2}><Text color="cyan">⠋ Loading plugins...</Text></Box>
          )}
        </Box>
      )}

      {(managedPiPackages.length > 0 || !piPackagesLoaded) && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Box>
            <Text color="gray">  Pi Packages </Text>
            <Text color="gray" dimColor>
              {managedPiPackages.length > 0
                ? getRange(selectedIndex >= fileCount + skillCount + pluginCount ? selectedIndex - fileCount - skillCount - pluginCount : 0, managedPiPackages.length, 3)
                : "(loading...)"}
            </Text>
          </Box>
          {managedPiPackages.length > 0 ? (
            <ItemList items={managedPiPackages} selectedIndex={selectedIndex >= fileCount + skillCount + pluginCount ? selectedIndex - fileCount - skillCount - pluginCount : -1} maxHeight={3} columns={PLUGIN_COLUMNS} />
          ) : (
            <Box marginLeft={2}><Text color="cyan">⠋ Loading pi packages...</Text></Box>
          )}
        </Box>
      )}

      {/* Preview */}
      {selectedLibraryItem?.kind === "plugin" && (
        <Box marginTop={1}>
          <PluginPreview plugin={selectedLibraryItem.plugin} />
        </Box>
      )}
      {selectedLibraryItem?.kind === "piPackage" && (
        <Box marginTop={1}>
          <PiPackagePreview pkg={selectedLibraryItem.piPackage} />
        </Box>
      )}
      {selectedLibraryItem?.kind === "file" && (
        <Box marginTop={1}>
          <FilePreview file={selectedLibraryItem.file} />
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
