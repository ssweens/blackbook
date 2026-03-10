import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Marketplace } from "../lib/types.js";

interface MarketplaceListProps {
  marketplaces: Marketplace[];
  selectedIndex: number;
  showAddOption?: boolean;
  maxHeight?: number;
}

function formatDate(date?: Date): string {
  if (!date) return "never";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

export function MarketplaceList({
  marketplaces,
  selectedIndex,
  showAddOption = true,
  maxHeight = 12,
}: MarketplaceListProps) {
  const offset = showAddOption ? 1 : 0;

  const maxNameLen = useMemo(() => {
    return Math.min(30, Math.max(...marketplaces.map(m => m.name.length), 10));
  }, [marketplaces]);

  const totalItems = marketplaces.length + offset;
  const { visibleMarketplaces, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (totalItems <= maxHeight) {
      return {
        visibleMarketplaces: marketplaces,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    const adjustedIndex = selectedIndex - offset;
    const maxStart = Math.max(0, marketplaces.length - maxHeight);
    const start = Math.min(
      Math.max(0, adjustedIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visibleMarketplaces: marketplaces.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < marketplaces.length,
      hasPrev: start > 0,
    };
  }, [marketplaces, selectedIndex, maxHeight, totalItems, offset]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Plugin Marketplaces</Text>
      </Box>

      {showAddOption && (
        <Box>
          <Text color={selectedIndex === 0 ? "cyan" : "gray"}>
            {selectedIndex === 0 ? "❯ " : "  "}
          </Text>
          <Text color="green">+ Add Plugin Marketplace</Text>
        </Box>
      )}

      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleMarketplaces.map((m, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx + offset;
        const isSelected = selectedIndex === actualIndex;
        const hasNew = m.installedCount > 0;
        const isReadOnly = m.source === "claude";
        const paddedName = m.name.padEnd(maxNameLen);
        const statusIcon = m.enabled ? "●" : "○";
        const statusColor = m.enabled ? "green" : "gray";

        return (
          <Box key={m.name} flexDirection="column" marginTop={visibleIdx === 0 && showAddOption && !hasPrev ? 1 : 0}>
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={statusColor}>{statusIcon} </Text>
              {hasNew && <Text color="yellow">* </Text>}
              <Text bold={isSelected} color={m.enabled ? "white" : "gray"}>
                {paddedName}
              </Text>
              {hasNew && <Text color="yellow"> *</Text>}
              {isReadOnly && <Text color="magenta"> (Claude)</Text>}
              {!m.enabled && <Text color="gray"> (disabled)</Text>}
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">{m.url}</Text>
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">
                {m.plugins.length} plugins
                {m.installedCount > 0 && ` • ${m.installedCount} installed`}
                {m.updatedAt && ` • Updated ${formatDate(m.updatedAt)}`}
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
