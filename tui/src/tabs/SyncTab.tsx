import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { SyncList } from "../components/SyncList.js";
import { SyncPreview } from "../components/SyncPreview.js";
import { getSyncItemKey } from "../lib/derived.js";

export interface SyncTabProps {
  contentHeight: number;
}

export function SyncTab({ contentHeight }: SyncTabProps) {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const syncSelection = useStore((s) => s.syncSelection);
  const syncArmed = useStore((s) => s.syncArmed);
  const getSyncPreview = useStore((s) => s.getSyncPreview);
  const toggleSyncSelection = useStore((s) => s.toggleSyncSelection);
  const setSyncArmed = useStore((s) => s.setSyncArmed);
  // Subscribe to the data sources that getSyncPreview depends on. This MUST match
  // App.tsx's syncPreview memo inputs exactly — getSyncPreview reads standaloneSkills
  // too, so omitting it here made this list disagree with App's (and go stale when
  // only standaloneSkills changed, since the component never re-rendered for it).
  const managedTools = useStore((s) => s.managedTools);
  const toolDetection = useStore((s) => s.toolDetection);
  const files = useStore((s) => s.files);
  const installedPlugins = useStore((s) => s.installedPlugins);
  const standaloneSkills = useStore((s) => s.standaloneSkills);
  const marketplaces = useStore((s) => s.marketplaces);
  const piPackages = useStore((s) => s.piPackages);

  const syncPreview = useMemo(
    () => getSyncPreview(),
    [getSyncPreview, managedTools, toolDetection, files, installedPlugins, standaloneSkills, marketplaces, piPackages]
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
        maxHeight={Math.max(4, contentHeight - 5)}
      />
      <SyncPreview item={syncPreview[selectedIndex] ?? null} />
    </>
  );
}
