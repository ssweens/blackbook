import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Asset } from "../lib/types.js";

interface AssetListProps {
  assets: Asset[];
  selectedIndex: number;
  nameColumnWidth?: number;
  typeColumnWidth?: number;
  marketplaceColumnWidth?: number;
  maxHeight?: number;
}

export function AssetList({
  assets,
  selectedIndex,
  nameColumnWidth,
  typeColumnWidth,
  marketplaceColumnWidth,
  maxHeight = 8,
}: AssetListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  const maxNameLen = useMemo(() => {
    if (nameColumnWidth) return nameColumnWidth;
    return Math.min(30, Math.max(...assets.map((a) => a.name.length), 10));
  }, [assets, nameColumnWidth]);

  const typeWidth = typeColumnWidth ?? 6;
  const marketplaceWidth = marketplaceColumnWidth ?? 0;

  const { visibleAssets, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (assets.length <= maxHeight) {
      return {
        visibleAssets: assets,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    const maxStart = Math.max(0, assets.length - maxHeight);
    const start = Math.min(
      Math.max(0, effectiveIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visibleAssets: assets.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < assets.length,
      hasPrev: start > 0,
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
      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleAssets.map((asset, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const statusIcon = asset.installed ? "✔" : " ";
        const statusColor = asset.installed ? "green" : "gray";
        const showIncomplete = Boolean(asset.installed && asset.incomplete);
        const showDrifted = Boolean(asset.installed && asset.drifted);
        const showSourceMissing = asset.sourceExists === false;
        const statusLabel = asset.installed ? "installed" : "";
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
              {marketplaceWidth > 0 && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="gray">{"".padEnd(marketplaceWidth)}</Text>
                </>
              )}
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

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {assets.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
