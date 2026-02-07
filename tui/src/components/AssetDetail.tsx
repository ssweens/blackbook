import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Asset, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { getAssetToolStatus, getAssetSourceInfo } from "../lib/install.js";
import { getDriftedAssetInstancesWithCounts, getMissingAssetInstances } from "../lib/diff.js";

export interface AssetAction {
  label: string;
  type: "diff" | "missing" | "sync" | "back" | "status";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray";
  statusLabel?: string;
}

interface AssetDetailProps {
  asset: Asset;
  selectedAction: number;
  actions: AssetAction[];
}

export function AssetDetail({ asset, selectedAction, actions }: AssetDetailProps) {
  const sourceInfo = useMemo(() => getAssetSourceInfo(asset), [asset]);

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
          {asset.installed ? "Installed" : "Not installed"}
        </Text>
        {asset.incomplete && <Text color="yellow"> (incomplete)</Text>}
        {asset.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {!sourceInfo.exists && (
        <Box marginBottom={1}>
          <Text color="red">Source unavailable: {sourceInfo.error || "Missing"}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Tools:</Text>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;

          // Tool status row (diff, missing, or non-clickable status)
          if (action.type === "diff" || action.type === "missing" || action.type === "status") {
            const isClickable = action.type === "diff" || action.type === "missing";
            return (
              <Box key={action.label}>
                <Text color={isSelected ? "cyan" : "gray"}>
                  {isSelected ? "❯ " : "  "}
                </Text>
                <Text color={isSelected ? "white" : "gray"}>
                  {action.label}:
                </Text>
                <Text color={action.statusColor || "gray"}> {action.statusLabel}</Text>
                {action.type === "diff" && action.instance && "totalAdded" in action.instance && (
                  <>
                    <Text color="green"> +{action.instance.totalAdded}</Text>
                    <Text color="red"> -{action.instance.totalRemoved}</Text>
                  </>
                )}
                {action.type === "missing" && (
                  <Text color="yellow"> (click to view)</Text>
                )}
              </Box>
            );
          }

          // Regular action (sync, back)
          let color = "white";
          if (action.type === "sync") color = "green";

          return (
            <Box key={action.label} marginTop={action.type === "sync" ? 1 : 0}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {action.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function getAssetActions(asset: Asset): AssetAction[] {
  const sourceInfo = getAssetSourceInfo(asset);
  const toolStatuses = getAssetToolStatus(asset, sourceInfo);
  const driftedInstances = getDriftedAssetInstancesWithCounts(asset);
  const driftedMap = new Map(driftedInstances.map((d) => [`${d.toolId}:${d.instanceId}`, d]));
  const missingInstances = getMissingAssetInstances(asset);
  const missingMap = new Map(missingInstances.map((m) => [`${m.toolId}:${m.instanceId}`, m]));

  const actions: AssetAction[] = [];

  // Add tool status rows - drifted ones are clickable diff actions, missing ones are clickable missing actions
  for (const status of toolStatuses) {
    const key = `${status.toolId}:${status.instanceId}`;
    const driftedInstance = driftedMap.get(key);
    const missingInstance = missingMap.get(key);

    let statusLabel = "Not enabled";
    let statusColor: "green" | "yellow" | "gray" = "gray";

    if (status.enabled) {
      if (status.drifted) {
        statusLabel = "Drifted";
        statusColor = "yellow";
      } else if (status.installed) {
        statusLabel = "Synced";
        statusColor = "green";
      } else {
        statusLabel = "Missing";
        statusColor = "yellow";
      }
    }

    if (driftedInstance) {
      // Drifted - clickable diff action
      actions.push({
        label: status.name,
        type: "diff",
        instance: driftedInstance,
        statusColor,
        statusLabel,
      });
    } else if (missingInstance) {
      // Missing - clickable missing action
      actions.push({
        label: status.name,
        type: "missing",
        instance: missingInstance,
        statusColor,
        statusLabel,
      });
    } else {
      // Not drifted or missing - non-clickable status display
      actions.push({
        label: status.name,
        type: "status",
        statusColor,
        statusLabel,
      });
    }
  }

  // Add sync action if needed
  const enabledStatuses = toolStatuses.filter((s) => s.enabled);
  const missingCount = enabledStatuses.filter((s) => !s.installed).length;
  const needsSync = missingCount > 0 || driftedInstances.length > 0;

  if (needsSync) {
    actions.push({ label: "Sync to all tools", type: "sync" });
  }
  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
