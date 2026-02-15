import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { PiMarketplace } from "../lib/types.js";

interface PiMarketplaceListProps {
  marketplaces: PiMarketplace[];
  selectedIndex: number;
  indexOffset: number;
  maxHeight?: number;
}

export function PiMarketplaceList({
  marketplaces,
  selectedIndex,
  indexOffset,
  maxHeight = 10,
}: PiMarketplaceListProps) {
  // Index 0 relative to this section = Add button
  const addIndex = indexOffset;
  const isAddSelected = selectedIndex === addIndex;

  const maxNameLen = useMemo(() => {
    return Math.min(30, Math.max(...marketplaces.map((m) => m.name.length), 10));
  }, [marketplaces]);

  const totalItems = marketplaces.length + 1; // +1 for Add button
  const { visibleMarketplaces, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (totalItems <= maxHeight) {
      return {
        visibleMarketplaces: marketplaces,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    const relativeIndex = selectedIndex - indexOffset - 1;
    const maxStart = Math.max(0, marketplaces.length - maxHeight);
    const start = Math.min(
      Math.max(0, relativeIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visibleMarketplaces: marketplaces.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < marketplaces.length,
      hasPrev: start > 0,
    };
  }, [marketplaces, selectedIndex, maxHeight, totalItems, indexOffset]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Pi Package Marketplaces</Text>
      </Box>

      <Box>
        <Text color={isAddSelected ? "cyan" : "gray"}>
          {isAddSelected ? "❯ " : "  "}
        </Text>
        <Text color="green">+ Add Pi Marketplace</Text>
      </Box>

      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleMarketplaces.map((pm, visibleIdx) => {
        const actualIndex = indexOffset + 1 + startIndex + visibleIdx;
        const isSelected = selectedIndex === actualIndex;
        const paddedName = pm.name.padEnd(maxNameLen);
        const statusIcon = pm.enabled ? "●" : "○";
        const statusColor = pm.enabled ? "green" : "gray";
        const hasInstalled = pm.packages.some((p) => p.installed);
        const installedCount = pm.packages.filter((p) => p.installed).length;

        return (
          <Box key={pm.name} flexDirection="column" marginTop={visibleIdx === 0 && !hasPrev ? 1 : 0}>
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={statusColor}>{statusIcon} </Text>
              {hasInstalled && <Text color="yellow">* </Text>}
              <Text bold={isSelected} color={pm.enabled ? "white" : "gray"}>
                {paddedName}
              </Text>
              {hasInstalled && <Text color="yellow"> *</Text>}
              {pm.builtIn && <Text color="magenta"> (built-in)</Text>}
              {!pm.enabled && <Text color="gray"> (disabled)</Text>}
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">{pm.source}</Text>
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">
                {pm.packages.length} available
                {installedCount > 0 && ` • ${installedCount} installed`}
              </Text>
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {marketplaces.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
