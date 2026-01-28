import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Asset } from "../lib/types.js";
import { getAssetToolStatus, getAssetSourceInfo } from "../lib/install.js";

interface AssetDetailProps {
  asset: Asset;
  selectedAction: number;
}

export function AssetDetail({ asset, selectedAction }: AssetDetailProps) {
  const sourceInfo = useMemo(() => getAssetSourceInfo(asset), [asset]);
  const toolStatuses = useMemo(
    () => getAssetToolStatus(asset, sourceInfo),
    [asset, sourceInfo]
  );

  const enabledStatuses = toolStatuses.filter((status) => status.enabled);
  const missingCount = enabledStatuses.filter((status) => !status.installed).length;
  const driftedCount = enabledStatuses.filter((status) => status.drifted).length;
  const needsSync = missingCount > 0 || driftedCount > 0;

  const actions = useMemo(() => {
    const base = [] as string[];
    if (needsSync) base.push("Sync to all tools");
    base.push("Back to list");
    return base;
  }, [needsSync]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{asset.name}</Text>
        <Text color="gray"> · asset</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source: </Text>
        <Text>{asset.source}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Default target: </Text>
        <Text>{asset.defaultTarget || "(default)"}</Text>
      </Box>

      {asset.overrides && Object.keys(asset.overrides).length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>Overrides:</Text>
          {Object.entries(asset.overrides).map(([key, value]) => (
            <Box key={key} marginLeft={1}>
              <Text color="gray">• {key}: </Text>
              <Text color="cyan">{value}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={asset.installed ? "green" : "yellow"}>
          {asset.installed ? "Synced" : "Not synced"}
        </Text>
        {asset.partial && <Text color="yellow"> (incomplete)</Text>}
        {asset.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {!sourceInfo.exists && (
        <Box marginBottom={1}>
          <Text color="red">Source unavailable: {sourceInfo.error || "Missing"}</Text>
        </Box>
      )}

      {toolStatuses.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Tool Status:</Text>
          {toolStatuses.map((status) => {
            let label = "Not enabled";
            let color: "green" | "yellow" | "gray" = "gray";
            if (status.enabled) {
              if (status.drifted) {
                label = "Drifted";
                color = "yellow";
              } else if (status.installed) {
                label = "Synced";
                color = "green";
              } else {
                label = "Missing";
                color = "yellow";
              }
            }

            return (
              <Box key={`${status.toolId}:${status.instanceId}`} marginLeft={1}>
                <Text color="gray">• {status.name}: </Text>
                <Text color={color}>{label}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;
          const color = action === "Sync to all tools" ? "green" : "white";
          return (
            <Box key={action}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {action}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
