import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { SyncPreviewItem } from "../lib/types.js";

interface SyncListProps {
  items: SyncPreviewItem[];
  selectedIndex: number;
  selectedKeys: Set<string>;
  getItemKey: (item: SyncPreviewItem) => string;
  maxHeight?: number;
}

export function SyncList({
  items,
  selectedIndex,
  selectedKeys,
  getItemKey,
  maxHeight = 12,
}: SyncListProps) {
  const { visibleItems, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (items.length <= maxHeight) {
      return { visibleItems: items, startIndex: 0, hasMore: false, hasPrev: false };
    }

    const maxStart = Math.max(0, items.length - maxHeight);
    const start = Math.min(
      Math.max(0, selectedIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visibleItems: items.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < items.length,
      hasPrev: start > 0,
    };
  }, [items, selectedIndex, maxHeight]);

  if (items.length === 0) {
    return (
      <Box marginY={1}>
        <Text color="gray">All enabled instances are in sync.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleItems.map((item, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";
        const key = getItemKey(item);
        const isChecked = selectedKeys.has(key);

        let name: string;
        let statusLabel: string;

        if (item.kind === "plugin") {
          name = item.plugin.name;
          statusLabel = `Missing: ${item.missingInstances.length}`;
        } else if (item.kind === "tool") {
          name = item.name;
          statusLabel = `Update: v${item.installedVersion} → v${item.latestVersion}`;
        } else {
          // item.kind === "file"
          name = item.file.name;
          const missingCount = item.missingInstances.length;
          const targetChangedCount = item.file.instances.filter((i) => i.driftKind === "target-changed").length;
          const bothChangedCount = item.file.instances.filter((i) => i.driftKind === "both-changed").length;
          const sourceChangedCount = item.file.instances.filter(
            (i) => i.status === "drifted" && i.driftKind !== "target-changed" && i.driftKind !== "both-changed",
          ).length;

          const parts: string[] = [];
          if (missingCount > 0) parts.push(`Missing: ${missingCount}`);
          if (sourceChangedCount > 0) parts.push(`Source changed: ${sourceChangedCount}`);
          if (targetChangedCount > 0) parts.push(`Target changed: ${targetChangedCount}`);
          if (bothChangedCount > 0) parts.push(`Both changed: ${bothChangedCount}`);
          statusLabel = parts.join(" · ");
        }

        return (
          <Box key={`${item.kind}:${key}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text color={isChecked ? "green" : "gray"}>[{isChecked ? "x" : " "}] </Text>
              <Text bold={isSelected} color="white">{name}</Text>
              <Text color="gray"> · </Text>
              <Text color="gray">{statusLabel}</Text>
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {items.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
