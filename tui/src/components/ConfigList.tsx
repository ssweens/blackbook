import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface ConfigListProps {
  configs: FileStatus[];
  selectedIndex: number;
  nameColumnWidth?: number;
  typeColumnWidth?: number;
  toolColumnWidth?: number;
  maxHeight?: number;
}

function getToolId(config: FileStatus): string {
  if (config.tools && config.tools.length > 0) {
    return config.tools[0] ?? "";
  }
  return "";
}

function computeFlags(config: FileStatus): {
  installed: boolean;
  incomplete: boolean;
  drifted: boolean;
  sourceMissing: boolean;
} {
  const installed = config.instances.some((i) => i.status !== "missing");
  const incomplete = installed && config.instances.some((i) => i.status === "missing");
  const drifted = installed && config.instances.some((i) => i.status === "drifted" || i.driftKind === "both-changed" || i.driftKind === "target-changed");
  const sourceMissing = config.instances.some(
    (i) => i.status === "failed" && i.message.toLowerCase().startsWith("source not found"),
  );
  return { installed, incomplete, drifted, sourceMissing };
}

export function ConfigList({
  configs,
  selectedIndex,
  nameColumnWidth,
  typeColumnWidth,
  toolColumnWidth,
  maxHeight = 8,
}: ConfigListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  const maxNameLen = useMemo(() => {
    if (nameColumnWidth) return nameColumnWidth;
    return Math.min(30, Math.max(...configs.map((c) => c.name.length), 10));
  }, [configs, nameColumnWidth]);

  const typeWidth = typeColumnWidth ?? 6;
  const toolWidth = toolColumnWidth ?? 0;

  const { visibleConfigs, startIndex } = useMemo(() => {
    if (configs.length <= maxHeight) {
      return {
        visibleConfigs: configs,
        startIndex: 0,
      };
    }

    const maxStart = Math.max(0, configs.length - maxHeight);
    const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);

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

        const flags = computeFlags(config);
        const statusIcon = flags.installed ? "✔" : " ";
        const statusColor = flags.installed ? "green" : "gray";
        const statusLabel = flags.installed ? "installed" : "";
        const statusWidth = 9;

        const paddedName = config.name.padEnd(maxNameLen);
        const toolId = getToolId(config);

        return (
          <Box key={config.name} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color="magenta">{"Config".padEnd(typeWidth)}</Text>
              {toolWidth > 0 && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="gray">{toolId.padEnd(toolWidth)}</Text>
                </>
              )}
              <Text color="gray"> </Text>
              <Text color={statusColor}>{statusIcon}</Text>
              <Text color={statusColor}>{" " + statusLabel.padEnd(statusWidth)}</Text>

              {flags.incomplete && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">incomplete</Text>
                </>
              )}
              {flags.drifted && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">drifted</Text>
                </>
              )}
              {flags.sourceMissing && (
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
