import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface AssetListProps {
  assets: FileStatus[];
  selectedIndex: number;
  nameColumnWidth?: number;
  typeColumnWidth?: number;
  toolColumnWidth?: number;
  maxHeight?: number;
}

function computeFlags(asset: FileStatus): {
  installed: boolean;
  incomplete: boolean;
  drifted: boolean;
  sourceMissing: boolean;
} {
  // In Installed tab we usually only render installed entries, but keep this robust.
  const installed = asset.instances.some((i) => i.status !== "missing");
  const incomplete = installed && asset.instances.some((i) => i.status === "missing");
  const drifted = installed && asset.instances.some((i) => i.status === "drifted" || i.driftKind === "both-changed" || i.driftKind === "target-changed");
  const sourceMissing = asset.instances.some(
    (i) => i.message.toLowerCase().startsWith("source not found") || i.message.toLowerCase().startsWith("source pattern matched 0") || i.message.toLowerCase().startsWith("source directory not found"),
  );
  return { installed, incomplete, drifted, sourceMissing };
}

export function AssetList({
  assets,
  selectedIndex,
  nameColumnWidth,
  typeColumnWidth,
  toolColumnWidth,
  maxHeight = 8,
}: AssetListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  const maxNameLen = useMemo(() => {
    if (nameColumnWidth) return nameColumnWidth;
    return Math.min(30, Math.max(...assets.map((a) => a.name.length), 10));
  }, [assets, nameColumnWidth]);

  const typeWidth = typeColumnWidth ?? 6;
  const toolWidth = toolColumnWidth ?? 0;

  const { visibleAssets, startIndex } = useMemo(() => {
    if (assets.length <= maxHeight) {
      return {
        visibleAssets: assets,
        startIndex: 0,
      };
    }

    const maxStart = Math.max(0, assets.length - maxHeight);
    const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);

    return {
      visibleAssets: assets.slice(start, start + maxHeight),
      startIndex: start,
    };
  }, [assets, effectiveIndex, maxHeight]);

  if (assets.length === 0) {
    return (
      <Box>
        <Text color="gray">No assets configured</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleAssets.map((asset, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const flags = computeFlags(asset);
        const statusIcon = flags.installed ? "✔" : " ";
        const statusColor = flags.installed ? "green" : "gray";
        const statusLabel = flags.installed ? "installed" : "";
        const statusWidth = 9;

        const paddedName = asset.name.padEnd(maxNameLen);

        return (
          <Box key={asset.name} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color="blue">{"Asset".padEnd(typeWidth)}</Text>
              {toolWidth > 0 && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="gray">{"".padEnd(toolWidth)}</Text>
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
                  <Text color="yellow">changed</Text>
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
