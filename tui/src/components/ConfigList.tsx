import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ConfigFile } from "../lib/types.js";

interface ConfigListProps {
  configs: ConfigFile[];
  selectedIndex: number;
  nameColumnWidth?: number;
  typeColumnWidth?: number;
  marketplaceColumnWidth?: number;
  maxHeight?: number;
}

export function ConfigList({
  configs,
  selectedIndex,
  nameColumnWidth,
  typeColumnWidth,
  marketplaceColumnWidth,
  maxHeight = 8,
}: ConfigListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  const maxNameLen = useMemo(() => {
    if (nameColumnWidth) return nameColumnWidth;
    return Math.min(30, Math.max(...configs.map((c) => c.name.length), 10));
  }, [configs, nameColumnWidth]);

  const typeWidth = typeColumnWidth ?? 6;
  const marketplaceWidth = marketplaceColumnWidth ?? 0;

  const { visibleConfigs, startIndex } = useMemo(() => {
    if (configs.length <= maxHeight) {
      return {
        visibleConfigs: configs,
        startIndex: 0,
      };
    }

    const maxStart = Math.max(0, configs.length - maxHeight);
    const start = Math.min(
      Math.max(0, effectiveIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visibleConfigs: configs.slice(start, start + maxHeight),
      startIndex: start,
    };
  }, [configs, effectiveIndex, maxHeight]);

  if (configs.length === 0) {
    return (
      <Box>
        <Text color="gray">No configs configured</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleConfigs.map((config, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const statusIcon = config.installed ? "✔" : " ";
        const statusColor = config.installed ? "green" : "gray";
        const showIncomplete = Boolean(config.installed && config.incomplete);
        const showDrifted = Boolean(config.installed && config.drifted);
        const showSourceMissing = config.sourceExists === false;
        const statusLabel = config.installed ? "installed" : "";
        const statusWidth = 9;

        const paddedName = config.name.padEnd(maxNameLen);

        return (
          <Box key={config.name} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color="magenta">{"Config".padEnd(typeWidth)}</Text>
              <Text color="gray"> · </Text>
              <Text color="gray">{config.toolId.padEnd(marketplaceWidth)}</Text>
              <Text color="gray"> </Text>
              <Text color={statusColor}>{statusIcon}</Text>
              <Text color={statusColor}>
                {" " + statusLabel.padEnd(statusWidth)}
              </Text>
              {showIncomplete && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">incomplete</Text>
                </>
              )}
              {showDrifted && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">drifted</Text>
                </>
              )}
              {showSourceMissing && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="red">source missing</Text>
                </>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
