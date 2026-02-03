import React from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

interface PiPackageSummaryProps {
  packages: PiPackage[];
  selected: boolean;
}

export interface PiPackageStats {
  total: number;
  installed: number;
  notInstalled: number;
  hasUpdate: number;
}

export function getPiPackageStats(packages: PiPackage[]): PiPackageStats {
  return {
    total: packages.length,
    installed: packages.filter((p) => p.installed).length,
    notInstalled: packages.filter((p) => !p.installed).length,
    hasUpdate: packages.filter((p) => p.hasUpdate).length,
  };
}

export function PiPackageSummary({ packages, selected }: PiPackageSummaryProps): React.ReactElement {
  const stats = getPiPackageStats(packages);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={selected ? "cyan" : "gray"}>  Pi Packages</Text>
        {selected && <Text color="cyan"> ▸</Text>}
      </Box>
      <Box marginLeft={4} flexDirection="row" gap={2}>
        <Text color="white">{stats.total}</Text>
        <Text color="gray">total</Text>
        <Text color="gray">·</Text>
        <Text color="green">{stats.installed}</Text>
        <Text color="gray">installed</Text>
        <Text color="gray">·</Text>
        <Text color="yellow">{stats.notInstalled}</Text>
        <Text color="gray">available</Text>
        {stats.hasUpdate > 0 && (
          <>
            <Text color="gray">·</Text>
            <Text color="blue">{stats.hasUpdate}</Text>
            <Text color="gray">updates</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
