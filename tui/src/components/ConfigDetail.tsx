import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ConfigFile, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { getConfigToolStatus } from "../lib/install.js";
import { getConfigRepoPath } from "../lib/config.js";
import { getDriftedConfigInstancesWithCounts, getMissingConfigInstances, buildConfigDiffTarget, getConfigSyncDirection, type SyncDirection } from "../lib/diff.js";

export interface ConfigAction {
  label: string;
  type: "diff" | "missing" | "sync" | "pullback" | "back" | "status";
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
          {config.sourceError ? (
            <Text color="red">Source unavailable: {config.sourceError}</Text>
          ) : (
            <Text color="yellow">Source empty — use p to pull from an instance</Text>
          )}
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

          // Regular action (sync, pullback, back)
          let color = "white";
          if (action.type === "sync") color = "green";
          if (action.type === "pullback") color = "cyan";

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

      <Box marginTop={1}>
        <Text color="gray">
          {actions.some((a) => a.type === "pullback") ? "p pull to source · " : ""}Esc back
        </Text>
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

  // Compute aggregate sync direction from file timestamps
  const enabledStatuses = toolStatuses.filter((s) => s.enabled);
  const missingCount = enabledStatuses.filter((s) => !s.installed).length;
  const needsSync = missingCount > 0 || driftedInstances.length > 0;

  let direction: SyncDirection = "unknown";
  if (driftedInstances.length > 0) {
    // Use first drifted instance to compute direction (they share the same source)
    const firstDrifted = driftedInstances[0];
    const diffTarget = buildConfigDiffTarget(config, firstDrifted);
    direction = getConfigSyncDirection(diffTarget.files);
  }

  if (needsSync) {
    const syncLabel = direction === "forward"
      ? "Sync to tool (newer)"
      : "Sync to tool";
    actions.push({ label: syncLabel, type: "sync" });
  }

  // Add pullback action for drifted instances (not just when source is empty)
  if (driftedInstances.length > 0) {
    for (const inst of driftedInstances) {
      const pullbackLabel = direction === "pullback"
        ? `Pull to source from ${inst.instanceName} (newer)`
        : `Pull to source from ${inst.instanceName}`;
      actions.push({
        label: pullbackLabel,
        type: "pullback",
        instance: inst,
      });
    }
  } else if (!config.sourceExists && enabledStatuses.length > 0) {
    // Source doesn't exist at all — offer pullback from any enabled instance
    for (const status of enabledStatuses) {
      actions.push({
        label: `Pull to source from ${status.name}`,
        type: "pullback",
        instance: { toolId: status.toolId, instanceId: status.instanceId, instanceName: status.name, configDir: status.configDir },
      });
    }
  }

  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
