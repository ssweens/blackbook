import React from "react";
import { Box, Text } from "ink";
import type { ManagedToolRow, ToolDetectionResult } from "../lib/types.js";
import { getToolRegistryEntry, TOOL_REGISTRY } from "../lib/tool-registry.js";

interface ToolDetailProps {
  tool: ManagedToolRow;
  detection: ToolDetectionResult | null;
  pending: boolean;
}

export function ToolDetail({ tool, detection, pending }: ToolDetailProps) {
  const registryEntry = getToolRegistryEntry(tool.toolId);
  const configOnly = !(tool.toolId in TOOL_REGISTRY);

  const installed = detection?.installed ?? false;
  const hasUpdate = detection?.hasUpdate ?? false;
  const statusLabel = pending ? "Checking..." : installed ? "Installed" : "Not installed";
  const statusColor = pending ? "gray" : installed ? "green" : "yellow";

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{tool.displayName}</Text>
        <Text color="gray"> ({tool.toolId}:{tool.instanceId})</Text>
      </Box>

      {configOnly ? (
        <>
          <Box marginBottom={1}>
            <Text color="gray">Type: </Text>
            <Text color="blue">Config only</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Config Dir: </Text>
            <Text>{tool.configDir}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Enabled: </Text>
            <Text>{tool.enabled ? "Yes" : "No"}</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">e Edit config · Space Toggle · Esc Back</Text>
          </Box>
        </>
      ) : (
        <>
          <Box marginBottom={1}>
            <Text color="gray">Status: </Text>
            {pending ? (
              <Text color={statusColor}>↻ {statusLabel}</Text>
            ) : (
              <Text color={statusColor}>{statusLabel}</Text>
            )}
            {!pending && hasUpdate && detection?.latestVersion && (
              <Text color="yellow"> (update available: {detection.latestVersion})</Text>
            )}
            {!pending && !installed && <Text color="yellow"> (installable)</Text>}
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Binary: </Text>
            <Text>{pending ? "Checking..." : detection?.binaryPath || "Not found"}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Version: </Text>
            <Text>{pending ? "..." : detection?.installedVersion || (installed ? "Unknown" : "—")}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Latest: </Text>
            <Text>{pending ? "..." : detection?.latestVersion || "Unknown"}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Config Dir: </Text>
            <Text>{tool.configDir}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Enabled: </Text>
            <Text>{tool.enabled ? "Yes" : "No"}</Text>
            {tool.synthetic && <Text color="gray"> (not configured yet)</Text>}
          </Box>

          {registryEntry?.homepage && (
            <Box marginBottom={1}>
              <Text color="gray">Homepage: </Text>
              <Text color="blue">{registryEntry.homepage}</Text>
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            {!installed ? (
              <Text color="gray">i Install</Text>
            ) : hasUpdate ? (
              <Text color="gray">u Update · d Uninstall</Text>
            ) : (
              <Text color="gray">d Uninstall</Text>
            )}
            <Text color="gray">e Edit config · Space Toggle · Esc Back</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
