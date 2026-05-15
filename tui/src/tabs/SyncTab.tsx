import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { SyncList } from "../components/SyncList.js";
import { SyncPreview } from "../components/SyncPreview.js";
import type { SyncPreviewItem } from "../lib/types.js";

function getSyncItemKey(item: SyncPreviewItem): string {
  if (item.kind === "plugin") {
    return `plugin:${item.plugin.marketplace}:${item.plugin.name}`;
  }
  if (item.kind === "tool") {
    return `tool:${item.toolId}`;
  }
  if (item.kind === "skill") {
    return `skill:${item.skill.name}`;
  }
  return `file:${item.file.name}`;
}

export function SyncTab() {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const syncSelection = useStore((s) => s.syncSelection);
  const syncArmed = useStore((s) => s.syncArmed);
  const getSyncPreview = useStore((s) => s.getSyncPreview);
  const toggleSyncSelection = useStore((s) => s.toggleSyncSelection);
  const setSyncArmed = useStore((s) => s.setSyncArmed);
  // Subscribe to the data sources that getSyncPreview depends on
  const managedTools = useStore((s) => s.managedTools);
  const toolDetection = useStore((s) => s.toolDetection);
  const files = useStore((s) => s.files);
  const installedPlugins = useStore((s) => s.installedPlugins);
  const marketplaces = useStore((s) => s.marketplaces);

  const syncPreview = useMemo(
    () => getSyncPreview(),
    [getSyncPreview, managedTools, toolDetection, files, installedPlugins, marketplaces]
  );
  const selectedKeys = useMemo(() => new Set(syncSelection), [syncSelection]);

  const selectedSyncCount = useMemo(() => {
    let count = 0;
    for (const item of syncPreview) {
      if (selectedKeys.has(getSyncItemKey(item))) count += 1;
    }
    return count;
  }, [syncPreview, selectedKeys]);

  return (
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
        selectedKeys={selectedKeys}
        getItemKey={getSyncItemKey}
      />
      <SyncPreview item={syncPreview[selectedIndex] ?? null} />
    </>
  );
}
