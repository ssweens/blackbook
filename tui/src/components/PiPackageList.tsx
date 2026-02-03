import React from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

interface PiPackageListProps {
  packages: PiPackage[];
  selectedIndex: number;
  maxHeight: number;
  nameColumnWidth: number;
  marketplaceColumnWidth: number;
}

export function PiPackageList({
  packages,
  selectedIndex,
  maxHeight,
  nameColumnWidth,
  marketplaceColumnWidth,
}: PiPackageListProps): React.ReactElement {
  // Calculate visible window
  const halfWindow = Math.floor(maxHeight / 2);
  let startIdx = Math.max(0, selectedIndex - halfWindow);
  const endIdx = Math.min(packages.length, startIdx + maxHeight);
  if (endIdx - startIdx < maxHeight && startIdx > 0) {
    startIdx = Math.max(0, endIdx - maxHeight);
  }

  const visiblePackages = packages.slice(startIdx, endIdx);

  return (
    <Box flexDirection="column">
      {visiblePackages.map((pkg, i) => {
        const realIndex = startIdx + i;
        const isSelected = realIndex === selectedIndex;
        const prefix = isSelected ? "▸ " : "  ";
        const statusIcon = pkg.installed
          ? pkg.hasUpdate
            ? "↑"
            : "✓"
          : " ";
        const statusColor = pkg.installed
          ? pkg.hasUpdate
            ? "blue"
            : "green"
          : "gray";

        const truncatedName = pkg.name.length > nameColumnWidth
          ? pkg.name.slice(0, nameColumnWidth - 1) + "…"
          : pkg.name.padEnd(nameColumnWidth);

        const truncatedMarketplace = pkg.marketplace.length > marketplaceColumnWidth
          ? pkg.marketplace.slice(0, marketplaceColumnWidth - 1) + "…"
          : pkg.marketplace.padEnd(marketplaceColumnWidth);

        // Format downloads compactly
        const downloads = pkg.weeklyDownloads;
        const dlText = downloads !== undefined
          ? downloads >= 1000
            ? `${Math.round(downloads / 1000)}k/wk`
            : `${downloads}/wk`
          : "";

        return (
          <Box key={pkg.source} flexDirection="row">
            <Text color={isSelected ? "cyan" : "white"}>{prefix}</Text>
            <Text color={statusColor}>{statusIcon} </Text>
            <Text color={isSelected ? "cyan" : "white"}>{truncatedName}</Text>
            <Text color="gray"> </Text>
            <Text color="magenta">{truncatedMarketplace}</Text>
            {dlText && (
              <>
                <Text color="gray"> </Text>
                <Text color="green" dimColor>{dlText.padStart(7)}</Text>
              </>
            )}
            <Text color="gray"> </Text>
            <Text color="gray" dimColor>
              {pkg.description.slice(0, 35)}
              {pkg.description.length > 35 ? "…" : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
