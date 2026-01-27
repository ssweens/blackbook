import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ToolInstance } from "../lib/types.js";

interface ToolsListProps {
  tools: ToolInstance[];
  selectedIndex: number;
  maxHeight?: number;
}

export function ToolsList({ tools, selectedIndex, maxHeight = 12 }: ToolsListProps) {
  const { visibleTools, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (tools.length <= maxHeight) {
      return {
        visibleTools: tools,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    let start = Math.max(0, selectedIndex - Math.floor(maxHeight / 2));
    if (start + maxHeight > tools.length) {
      start = Math.max(0, tools.length - maxHeight);
    }

    return {
      visibleTools: tools.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < tools.length,
      hasPrev: start > 0,
    };
  }, [tools, selectedIndex, maxHeight]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Manage tools</Text>
      </Box>

      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleTools.map((tool, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = selectedIndex === actualIndex;
        const statusColor = tool.enabled ? "green" : "gray";
        const statusLabel = tool.enabled ? "Enabled" : "Disabled";

        return (
          <Box key={`${tool.toolId}:${tool.instanceId}`} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color="white">
                {tool.name}
              </Text>
              <Text color="gray"> ({tool.toolId}:{tool.instanceId})</Text>
              <Text> </Text>
              <Text color={statusColor}>{statusLabel}</Text>
            </Box>
            <Box marginLeft={4}>
              <Text color="gray">{tool.configDir}</Text>
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {tools.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
