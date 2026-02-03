import React from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

interface PiPackagePreviewProps {
  pkg: PiPackage | null;
}

export function PiPackagePreview({ pkg }: PiPackagePreviewProps): React.ReactElement {
  if (!pkg) {
    return (
      <Box borderStyle="round" borderColor="gray" padding={1}>
        <Text color="gray">Select a Pi package to view details</Text>
      </Box>
    );
  }

  const status = pkg.installed
    ? pkg.hasUpdate
      ? "Update Available"
      : "Installed"
    : "Not Installed";
  const statusColor = pkg.installed
    ? pkg.hasUpdate
      ? "blue"
      : "green"
    : "yellow";

  const contents: string[] = [];
  if (pkg.extensions.length > 0) contents.push(`${pkg.extensions.length} extensions`);
  if (pkg.skills.length > 0) contents.push(`${pkg.skills.length} skills`);
  if (pkg.prompts.length > 0) contents.push(`${pkg.prompts.length} prompts`);
  if (pkg.themes.length > 0) contents.push(`${pkg.themes.length} themes`);

  return (
    <Box borderStyle="round" borderColor="gray" flexDirection="column" padding={1}>
      <Text color="cyan" bold>{pkg.name}</Text>
      <Text color="gray">{pkg.description || "No description"}</Text>
      <Box marginTop={1}>
        <Text color="gray">Version: </Text>
        <Text>{pkg.version}</Text>
      </Box>
      <Box>
        <Text color="gray">Source: </Text>
        <Text color="magenta">{pkg.marketplace}</Text>
      </Box>
      <Box>
        <Text color="gray">Status: </Text>
        <Text color={statusColor}>{status}</Text>
      </Box>
      {contents.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray">Contains: </Text>
          <Text>{contents.join(", ")}</Text>
        </Box>
      )}
      {pkg.author && (
        <Box>
          <Text color="gray">Author: </Text>
          <Text>{pkg.author}</Text>
        </Box>
      )}
      {pkg.weeklyDownloads !== undefined && (
        <Box>
          <Text color="gray">Downloads: </Text>
          <Text color="green">{pkg.weeklyDownloads.toLocaleString()}/week</Text>
          {pkg.monthlyDownloads !== undefined && (
            <Text color="gray"> ({pkg.monthlyDownloads.toLocaleString()}/month)</Text>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>Press Enter to open, Space to install/uninstall</Text>
      </Box>
    </Box>
  );
}
