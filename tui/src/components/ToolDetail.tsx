import React from "react";
import { Box, Text } from "ink";
import type { ManagedToolRow, ToolDetectionResult } from "../lib/types.js";
import { getToolRegistryEntry, TOOL_REGISTRY } from "../lib/tool-registry.js";
import { getPackageManager } from "../lib/config.js";
import { getToolLifecycleCommand, detectInstallMethodFromPath } from "../lib/tool-lifecycle.js";

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

  const detectedInstallMethod = detectInstallMethodFromPath(detection?.binaryPath);

  const packageManager = getPackageManager();

  // Show migration when the detected install method doesn't match the preferred.
  // For tools with native lifecycle (e.g. claude-code), the preferred is the native
  // install command — if currently installed via brew, offer to migrate.
  // For tools with package-manager lifecycle, the preferred is the configured PM.
  const lifecycle = registryEntry?.lifecycle;
  const installIsNative = lifecycle?.install?.strategy === "native";
  // When install strategy is native, any detected non-unknown method (brew, npm, etc.)
  // means the tool wasn't installed the preferred way.
  // When install strategy is package-manager, only brew is a mismatch.
  const canMigrateToPreferred =
    installed &&
    detectedInstallMethod !== "unknown" &&
    (installIsNative || detectedInstallMethod === "brew");

  const preferredLabel = installIsNative ? "native install" : packageManager;

  const safeCommandFor = (action: "install" | "update" | "uninstall") => {
    try {
      return getToolLifecycleCommand(tool.toolId, action, packageManager, detectedInstallMethod);
    } catch {
      return null;
    }
  };
  const installCmd = safeCommandFor("install");
  const updateCmd = safeCommandFor("update");
  const uninstallCmd = safeCommandFor("uninstall");
  const formatCmd = (cmd: { cmd: string; args: string[] } | null) =>
    cmd ? `${cmd.cmd} ${cmd.args.join(" ")}` : "Unknown";

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
            <Text color="gray">Installed via: </Text>
            <Text>{pending ? "..." : detectedInstallMethod}</Text>
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
            <Text color="gray">Install method: </Text>
            <Text>{formatCmd(installCmd)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Update method: </Text>
            <Text>{formatCmd(updateCmd)}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="gray">Uninstall method: </Text>
            <Text>{formatCmd(uninstallCmd)}</Text>
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

          {canMigrateToPreferred && (
            <Box marginBottom={1}>
              <Text color="cyan">Migrate to preferred install method: {preferredLabel} (press m)</Text>
            </Box>
          )}

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
            {canMigrateToPreferred && <Text color="gray">m Migrate to preferred install method</Text>}
            <Text color="gray">e Edit config · Space Toggle · Esc Back</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
