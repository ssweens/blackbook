import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";

interface PluginListProps {
  plugins: Plugin[];
  selectedIndex: number;
  maxHeight?: number;
}

export function PluginList({
  plugins,
  selectedIndex,
  maxHeight = 12,
}: PluginListProps) {
  // Calculate max lengths for column alignment
  const { maxNameLen, maxMarketplaceLen } = useMemo(() => {
    return {
      maxNameLen: Math.min(30, Math.max(...plugins.map(p => p.name.length), 10)),
      maxMarketplaceLen: Math.max(...plugins.map(p => p.marketplace.length), 10),
    };
  }, [plugins]);

  const { visiblePlugins, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (plugins.length <= maxHeight) {
      return {
        visiblePlugins: plugins,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    const maxStart = Math.max(0, plugins.length - maxHeight);
    const start = Math.min(
      Math.max(0, selectedIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visiblePlugins: plugins.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < plugins.length,
      hasPrev: start > 0,
    };
  }, [plugins, selectedIndex, maxHeight]);

  if (plugins.length === 0) {
    return (
      <Box marginY={1}>
        <Text color="gray">No plugins found</Text>
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

      {visiblePlugins.map((plugin, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const typeLabel = plugin.hasMcp ? "MCP" : "Plugin";
        const statusIcon = plugin.installed ? "✔" : " ";
        const statusColor = plugin.installed ? "green" : "gray";
        const showPartial = Boolean(plugin.installed && plugin.partial);

        const paddedName = plugin.name.padEnd(maxNameLen);

        return (
          <Box key={`${plugin.marketplace}:${plugin.name}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color="blue">{typeLabel.padEnd(6)}</Text>
              <Text color="gray"> · </Text>
              <Text color="gray">{plugin.marketplace.padEnd(maxMarketplaceLen)}</Text>
              <Text color="gray"> </Text>
              <Text color={statusColor}>{statusIcon}</Text>
              <Text color={statusColor}>
                {plugin.installed ? " installed" : ""}
              </Text>
              {showPartial && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">partial</Text>
                </>
              )}
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {plugins.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
