import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { SyncPreviewItem } from "../lib/types.js";

interface SyncListProps {
  items: SyncPreviewItem[];
  selectedIndex: number;
  maxHeight?: number;
}

export function SyncList({ items, selectedIndex, maxHeight = 12 }: SyncListProps) {
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

        return (
          <Box key={`${item.plugin.marketplace}:${item.plugin.name}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">{item.plugin.name}</Text>
              <Text color="gray"> · </Text>
              <Text color="gray">Missing: {item.missingInstances.length}</Text>
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
