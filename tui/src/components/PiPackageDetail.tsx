import React from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

export interface PiPackageAction {
  label: string;
  type: "install" | "uninstall" | "update" | "back";
}

export function getPiPackageActions(pkg: PiPackage): PiPackageAction[] {
  const actions: PiPackageAction[] = [];

  if (pkg.installed) {
    if (pkg.hasUpdate) {
      actions.push({ label: "Update", type: "update" });
    }
    actions.push({ label: "Uninstall", type: "uninstall" });
  } else {
    actions.push({ label: "Install", type: "install" });
  }

  actions.push({ label: "Back to list", type: "back" });
  return actions;
}

interface PiPackageDetailProps {
  pkg: PiPackage;
  selectedIndex: number;
}

export function PiPackageDetail({ pkg, selectedIndex }: PiPackageDetailProps): React.ReactElement {
  const actions = getPiPackageActions(pkg);

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

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>{pkg.name}</Text>
        <Text color="gray"> v{pkg.version}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">{pkg.description || "No description"}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="gray">Source: </Text>
          <Text>{pkg.source}</Text>
        </Box>
        <Box>
          <Text color="gray">Marketplace: </Text>
          <Text color="magenta">{pkg.marketplace}</Text>
        </Box>
        <Box>
          <Text color="gray">Status: </Text>
          <Text color={statusColor}>{status}</Text>
        </Box>
        {pkg.author && (
          <Box>
            <Text color="gray">Author: </Text>
            <Text>{pkg.author}</Text>
          </Box>
        )}
        {pkg.license && (
          <Box>
            <Text color="gray">License: </Text>
            <Text>{pkg.license}</Text>
          </Box>
        )}
        {pkg.homepage && (
          <Box>
            <Text color="gray">Homepage: </Text>
            <Text color="blue">{pkg.homepage}</Text>
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
      </Box>

      {/* Package contents */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="white" bold>Contents:</Text>
        {pkg.extensions.length > 0 && (
          <Box marginLeft={2}>
            <Text color="gray">Extensions: </Text>
            <Text>{pkg.extensions.join(", ")}</Text>
          </Box>
        )}
        {pkg.skills.length > 0 && (
          <Box marginLeft={2}>
            <Text color="gray">Skills: </Text>
            <Text>{pkg.skills.join(", ")}</Text>
          </Box>
        )}
        {pkg.prompts.length > 0 && (
          <Box marginLeft={2}>
            <Text color="gray">Prompts: </Text>
            <Text>{pkg.prompts.join(", ")}</Text>
          </Box>
        )}
        {pkg.themes.length > 0 && (
          <Box marginLeft={2}>
            <Text color="gray">Themes: </Text>
            <Text>{pkg.themes.join(", ")}</Text>
          </Box>
        )}
        {pkg.extensions.length === 0 && pkg.skills.length === 0 && 
         pkg.prompts.length === 0 && pkg.themes.length === 0 && (
          <Box marginLeft={2}>
            <Text color="gray" dimColor>No contents detected</Text>
          </Box>
        )}
      </Box>

      {/* Actions */}
      <Box flexDirection="column">
        <Text color="white" bold>Actions:</Text>
        {actions.map((action, i) => (
          <Box key={action.type} marginLeft={2}>
            <Text color={i === selectedIndex ? "cyan" : "white"}>
              {i === selectedIndex ? "▸ " : "  "}
              {action.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
