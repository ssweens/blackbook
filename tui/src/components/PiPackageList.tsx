import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

interface PiPackageListProps {
  packages: PiPackage[];
  selectedIndex: number;
  maxHeight?: number;
  nameColumnWidth?: number;
  marketplaceColumnWidth?: number;
}

export function PiPackageList({
  packages,
  selectedIndex,
  maxHeight = 12,
  nameColumnWidth,
  marketplaceColumnWidth,
}: PiPackageListProps): React.ReactElement {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  // Calculate max lengths for column alignment
  const { maxNameLen, maxMarketplaceLen } = useMemo(() => {
    if (nameColumnWidth && marketplaceColumnWidth) {
      return { maxNameLen: nameColumnWidth, maxMarketplaceLen: marketplaceColumnWidth };
    }
    return {
      maxNameLen: Math.min(30, Math.max(...packages.map(p => p.name.length), 10)),
      maxMarketplaceLen: Math.max(...packages.map(p => p.marketplace.length), 10),
    };
  }, [packages, nameColumnWidth, marketplaceColumnWidth]);

  const { visiblePackages, startIndex } = useMemo(() => {
    if (packages.length <= maxHeight) {
      return {
        visiblePackages: packages,
        startIndex: 0,
      };
    }

    const maxStart = Math.max(0, packages.length - maxHeight);
    const start = Math.min(
      Math.max(0, effectiveIndex - (maxHeight - 1)),
      maxStart
    );

    return {
      visiblePackages: packages.slice(start, start + maxHeight),
      startIndex: start,
    };
  }, [packages, effectiveIndex, maxHeight]);

  if (packages.length === 0) {
    return (
      <Box>
        <Text color="gray">No pi packages found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visiblePackages.map((pkg, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const statusIcon = pkg.installed ? "✔" : " ";
        const statusColor = pkg.installed ? "green" : "gray";
        const showUpdate = Boolean(pkg.installed && pkg.hasUpdate);
        const statusLabel = pkg.installed ? "installed" : "";
        const statusWidth = 9;

        const paddedName = pkg.name.padEnd(maxNameLen);

        return (
          <Box key={pkg.source} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color="magenta">{"PiPkg".padEnd(6)}</Text>
              <Text color="gray"> · </Text>
              <Text color="gray">{pkg.marketplace.padEnd(maxMarketplaceLen)}</Text>
              <Text color="gray"> </Text>
              <Text color={statusColor}>{statusIcon}</Text>
              <Text color={statusColor}>
                {" " + statusLabel.padEnd(statusWidth)}
              </Text>
              {showUpdate && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="blue">update available</Text>
                </>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
