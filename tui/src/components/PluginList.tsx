import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";

interface PluginListProps {
  plugins: Plugin[];
  selectedIndex: number;
  showNested?: boolean;
  maxHeight?: number;
}

export function PluginList({
  plugins,
  selectedIndex,
  showNested = false,
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

    let start = Math.max(0, selectedIndex - Math.floor(maxHeight / 2));
    if (start + maxHeight > plugins.length) {
      start = Math.max(0, plugins.length - maxHeight);
    }

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

        const componentParts: string[] = [];
        if (plugin.skills.length > 0) {
          componentParts.push(`Skills: ${plugin.skills.join(", ")}`);
        }
        if (plugin.commands.length > 0) {
          componentParts.push(`Commands: ${plugin.commands.join(", ")}`);
        }
        if (plugin.agents.length > 0) {
          componentParts.push(`Agents: ${plugin.agents.join(", ")}`);
        }
        if (plugin.hooks.length > 0) {
          componentParts.push("Hooks ✔");
        }
        if (plugin.hasMcp) {
          componentParts.push("MCP Server ✔");
        }
        if (plugin.hasLsp) {
          componentParts.push("LSP Server ✔");
        }

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

            {isSelected && componentParts.length > 0 && (
              <Box marginLeft={2} flexDirection="column">
                {componentParts.map((part, i) => (
                  <Box key={i}>
                    <Text color="gray">    </Text>
                    <Text color="cyan">{part}</Text>
                  </Box>
                ))}
              </Box>
            )}


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
