import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { join } from "path";
import type { Plugin, DiffInstanceSummary, DiffInstanceRef } from "../lib/types.js";
import { getPluginToolStatus, type ToolInstallStatus } from "../lib/plugin-status.js";
import { getPluginComponentConfig } from "../lib/config.js";
import { buildFileDiffTarget } from "../lib/diff.js";
import type { PluginDrift } from "../lib/plugin-drift.js";
import { resolvePluginSourcePaths } from "../lib/plugin-drift.js";
import { getToolInstances } from "../lib/config.js";

export interface PluginAction {
  id: string;
  label: string;
  type: "install" | "uninstall" | "update" | "install_tool" | "uninstall_tool" | "diff" | "back";
  toolStatus?: ToolInstallStatus;
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

interface PluginDetailProps {
  plugin: Plugin;
  onAction: (action: "install" | "uninstall" | "update" | "repair" | "back") => void;
  selectedAction: number;
  actions?: PluginAction[];
  drift?: PluginDrift;
}

export function PluginDetail({ plugin, selectedAction, actions: externalActions, drift }: PluginDetailProps) {
  const toolStatuses = getPluginToolStatus(plugin);
  const componentConfig = getPluginComponentConfig(plugin.marketplace, plugin.name);
  const disabledCount = componentConfig.disabledSkills.length + componentConfig.disabledCommands.length + componentConfig.disabledAgents.length;

  const isIncomplete = plugin.installed && plugin.incomplete;

  const actions = useMemo(() => {
    if (externalActions) return externalActions;
    return buildPluginActions(plugin, toolStatuses, isIncomplete, drift);
  }, [plugin, toolStatuses, isIncomplete, externalActions, drift]);

  // Overall drift status
  const hasDrift = drift && Object.values(drift).some((s) => s !== "in-sync");

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{plugin.name}</Text>
        <Text color="gray"> @ {plugin.marketplace}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Scope: </Text>
        <Text>{plugin.scope}</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text>{plugin.description}</Text>
      </Box>

      {plugin.homepage && (
        <Box marginBottom={1}>
          <Text color="gray">Homepage: </Text>
          <Text color="blue">{plugin.homepage}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={plugin.installed ? "green" : "yellow"}>
          {plugin.installed ? "Installed" : "Not Installed"}
        </Text>
        {isIncomplete && (
          <Text color="yellow"> (incomplete)</Text>
        )}
        {hasDrift && <Text color="yellow"> (drifted)</Text>}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>Components:</Text>
          {disabledCount > 0 && (
            <Text color="yellow"> ({disabledCount} disabled)</Text>
          )}
        </Box>
        {plugin.skills.length > 0 && (
          <Box marginLeft={1} flexWrap="wrap">
            <Text color="gray">• Skills: </Text>
            {plugin.skills.map((skill, i) => {
              const disabled = componentConfig.disabledSkills.includes(skill);
              return (
                <Text key={skill}>
                  <Text color={disabled ? "red" : "cyan"} strikethrough={disabled}>{skill}</Text>
                  {i < plugin.skills.length - 1 && <Text color="gray">, </Text>}
                </Text>
              );
            })}
          </Box>
        )}
        {plugin.commands.length > 0 && (
          <Box marginLeft={1} flexWrap="wrap">
            <Text color="gray">• Commands: </Text>
            {plugin.commands.map((cmd, i) => {
              const disabled = componentConfig.disabledCommands.includes(cmd);
              return (
                <Text key={cmd}>
                  <Text color={disabled ? "red" : "cyan"} strikethrough={disabled}>{cmd}</Text>
                  {i < plugin.commands.length - 1 && <Text color="gray">, </Text>}
                </Text>
              );
            })}
          </Box>
        )}
        {plugin.agents.length > 0 && (
          <Box marginLeft={1} flexWrap="wrap">
            <Text color="gray">• Agents: </Text>
            {plugin.agents.map((agent, i) => {
              const disabled = componentConfig.disabledAgents.includes(agent);
              return (
                <Text key={agent}>
                  <Text color={disabled ? "red" : "cyan"} strikethrough={disabled}>{agent}</Text>
                  {i < plugin.agents.length - 1 && <Text color="gray">, </Text>}
                </Text>
              );
            })}
          </Box>
        )}
        {plugin.hooks.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Hooks: </Text>
            <Text color="cyan">{plugin.hooks.join(", ")}</Text>
          </Box>
        )}
        {(plugin.hasMcp || plugin.hasLsp) && (
          <Box marginLeft={1}>
            {plugin.hasMcp && (
              <>
                <Text color="gray">• MCP </Text>
                <Text color="green">✔</Text>
              </>
            )}
            {plugin.hasMcp && plugin.hasLsp && <Text color="gray">  </Text>}
            {plugin.hasLsp && (
              <>
                <Text color="gray">• LSP </Text>
                <Text color="green">✔</Text>
              </>
            )}
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {plugin.installed && <Text bold>Instances:</Text>}
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;

          // Diff / status actions rendered like FileDetail
          if (action.type === "diff" || (action.statusLabel && !action.toolStatus)) {
            return (
              <Box key={action.id} flexDirection="column">
                <Box>
                  <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                  <Text color={isSelected ? "white" : "gray"}>{action.label}:</Text>
                  <Text color={action.statusColor || "gray"}> {action.statusLabel}</Text>
                  {action.type === "diff" && action.instance && "totalAdded" in action.instance && (
                    <>
                      <Text color="green"> +{action.instance.totalAdded}</Text>
                      <Text color="red"> -{action.instance.totalRemoved}</Text>
                    </>
                  )}
                </Box>
              </Box>
            );
          }

          const color =
            action.type === "uninstall" || action.type === "uninstall_tool"
              ? "red"
              : action.type === "install" || action.type === "install_tool"
                ? "green"
                : action.type === "update"
                  ? "cyan"
                  : "white";

          return (
            <Box key={action.id} marginTop={action.type === "uninstall" ? 1 : 0}>
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
        <Text color="gray">Esc back</Text>
      </Box>
    </Box>
  );
}

export function buildPluginActions(
  plugin: Plugin,
  toolStatuses: ToolInstallStatus[],
  isIncomplete?: boolean,
  drift?: PluginDrift,
): PluginAction[] {
  const actions: PluginAction[] = [];

  if (plugin.installed) {
    // Per-instance status — same pattern as FileDetail.
    // For each installed tool, show status (Synced / Changed +N -N / Missing).
    const sourcePaths = resolvePluginSourcePaths(plugin);
    const allInstances = getToolInstances();

    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      if (!status.installed) continue;

      const inst = allInstances.find(
        (t) => t.toolId === status.toolId && t.instanceId === status.instanceId,
      );
      if (!inst) continue;

      const instance: DiffInstanceRef = {
        toolId: status.toolId,
        instanceId: status.instanceId,
        instanceName: status.name,
        configDir: inst.configDir,
      };

      // Check if this instance has any drifted components
      let totalAdded = 0;
      let totalRemoved = 0;
      let hasDrift = false;

      if (sourcePaths && drift) {
        // Build diff for each drifted component in this instance
        for (const [key, driftStatus] of Object.entries(drift)) {
          if (driftStatus === "in-sync") continue;
          const [kind, name] = key.split(":");
          const subdir =
            kind === "skill" ? inst.skillsSubdir
            : kind === "command" ? inst.commandsSubdir
            : inst.agentsSubdir;
          if (!subdir) continue;

          const srcSuffix = kind === "skill" ? name : `${name}.md`;
          const srcPath = join(sourcePaths.pluginDir, `${kind}s`, srcSuffix);
          const destPath = join(inst.configDir, subdir, srcSuffix);

          try {
            const dt = buildFileDiffTarget(
              `${plugin.name}/${name}`, srcSuffix, srcPath, destPath, instance,
            );
            totalAdded += dt.files.reduce((sum, f) => sum + f.linesAdded, 0);
            totalRemoved += dt.files.reduce((sum, f) => sum + f.linesRemoved, 0);
            hasDrift = true;
          } catch {
            // Ignore errors (e.g. source/target missing)
          }
        }
      }

      if (hasDrift) {
        const summary: DiffInstanceSummary = { ...instance, totalAdded, totalRemoved };
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "diff",
          toolStatus: status,
          instance: summary,
          statusColor: "yellow",
          statusLabel: "Changed",
        });
      } else {
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "diff",
          toolStatus: status,
          instance,
          statusColor: "green",
          statusLabel: "Synced",
        });
      }
    }

    // Not-installed instances
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      if (status.installed) continue;
      actions.push({
        id: `status_${status.toolId}:${status.instanceId}`,
        label: status.name,
        type: "diff",
        statusColor: "yellow",
        statusLabel: "Not installed",
      });
    }

    // Bulk actions
    actions.push({ id: "uninstall", label: "Uninstall from all tools", type: "uninstall" });
    actions.push({ id: "update", label: "Update now", type: "update" });

    if (isIncomplete) {
      actions.push({ id: "install_all", label: "Install to all tools", type: "install" });
    }

    // Per-tool install/uninstall actions
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;

      if (status.installed) {
        actions.push({
          id: `uninstall_${status.toolId}:${status.instanceId}`,
          label: `Uninstall from ${status.name}`,
          type: "uninstall_tool",
          toolStatus: status,
        });
      } else {
        actions.push({
          id: `install_${status.toolId}:${status.instanceId}`,
          label: `Install to ${status.name}`,
          type: "install_tool",
          toolStatus: status,
        });
      }
    }

    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
  } else {
    actions.push({ id: "install", label: "Install to all tools", type: "install" });

    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      actions.push({
        id: `install_${status.toolId}:${status.instanceId}`,
        label: `Install to ${status.name}`,
        type: "install_tool",
        toolStatus: status,
      });
    }

    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
  }

  return actions;
}
