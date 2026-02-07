import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ConfigFile, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { getConfigToolStatus } from "../lib/install.js";
import { getConfigRepoPath } from "../lib/config.js";
import { getDriftedConfigInstancesWithCounts, getMissingConfigInstances } from "../lib/diff.js";

export interface ConfigAction {
  label: string;
  type: "diff" | "missing" | "sync" | "back" | "status";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray";
  statusLabel?: string;
}

interface ConfigDetailProps {
  config: ConfigFile;
  selectedAction: number;
  actions: ConfigAction[];
}

export function ConfigDetail({ config, selectedAction, actions }: ConfigDetailProps) {
  const sourceFiles = config.sourceFiles || [];
  const configRepo = useMemo(() => getConfigRepoPath(), []);

  const sourceDisplay = useMemo(() => {
    if (config.mappings && config.mappings.length > 0) {
      return config.mappings.map(m => `${m.source} → ${m.target}`).join(", ");
    }
    if (config.sourcePath && config.targetPath) {
      return `${config.sourcePath} → ${config.targetPath}`;
    }
    return "(not configured)";
  }, [config]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{config.name}</Text>
        <Text color="gray"> · config</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Tool: </Text>
        <Text color="magenta">{config.toolId}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Config repo: </Text>
        <Text>{configRepo || "(not configured)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source(s): </Text>
        <Text>{sourceDisplay}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Files: </Text>
        <Text>{sourceFiles.length > 0 ? `${sourceFiles.length} file(s)` : "(none)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={config.installed ? "green" : "yellow"}>
          {config.installed ? "Synced" : "Not synced"}
        </Text>
        {config.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {!config.sourceExists && (
        <Box marginBottom={1}>
          <Text color="red">Source unavailable: {config.sourceError || "Missing"}</Text>
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

export function getConfigActions(config: ConfigFile): ConfigAction[] {
  const toolStatuses = getConfigToolStatus(config, config.sourceFiles);
  const driftedInstances = getDriftedConfigInstancesWithCounts(config);
  const driftedMap = new Map(driftedInstances.map((d) => [`${d.toolId}:${d.instanceId}`, d]));
  const missingInstances = getMissingConfigInstances(config);
  const missingMap = new Map(missingInstances.map((m) => [`${m.toolId}:${m.instanceId}`, m]));

  const actions: ConfigAction[] = [];

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
    actions.push({ label: "Sync to tool", type: "sync" });
  }
  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
