import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";
import { getPluginToolStatus, type ToolInstallStatus } from "../lib/plugin-status.js";
import { getPluginComponentConfig } from "../lib/config.js";

export interface PluginAction {
  id: string;
  label: string;
  type: "install" | "uninstall" | "update" | "install_tool" | "uninstall_tool" | "back";
  toolStatus?: ToolInstallStatus;
}

interface PluginDetailProps {
  plugin: Plugin;
  onAction: (action: "install" | "uninstall" | "update" | "repair" | "back") => void;
  selectedAction: number;
  actions?: PluginAction[];
}

export function PluginDetail({ plugin, selectedAction, actions: externalActions }: PluginDetailProps) {
  const toolStatuses = getPluginToolStatus(plugin);
  const componentConfig = getPluginComponentConfig(plugin.marketplace, plugin.name);
  const disabledCount = componentConfig.disabledSkills.length + componentConfig.disabledCommands.length + componentConfig.disabledAgents.length;

  const isIncomplete = plugin.installed && plugin.incomplete;

  const actions = useMemo(() => {
    if (externalActions) return externalActions;
    return buildPluginActions(plugin, toolStatuses, isIncomplete);
  }, [plugin, toolStatuses, isIncomplete, externalActions]);

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
      </Box>

      {plugin.installed && toolStatuses.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Tool Status:</Text>
          {toolStatuses.map((status) => {
            let label = "Not supported";
            let color: "green" | "yellow" | "gray" = "gray";
            if (!status.enabled) {
              label = "Not enabled";
              color = "gray";
            } else if (status.supported) {
              label = status.installed ? "Installed" : "Not installed";
              color = status.installed ? "green" : "yellow";
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
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;
          const color =
            action.type === "uninstall" || action.type === "uninstall_tool"
              ? "red"
              : action.type === "install" || action.type === "install_tool"
                ? "green"
                : action.type === "update"
                  ? "cyan"
                  : "white";

          return (
            <Box key={action.id}>
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

export function buildPluginActions(
  plugin: Plugin,
  toolStatuses: ToolInstallStatus[],
  isIncomplete?: boolean,
): PluginAction[] {
  const actions: PluginAction[] = [];

  if (plugin.installed) {
    actions.push({ id: "uninstall", label: "Uninstall from all tools", type: "uninstall" });
    actions.push({ id: "update", label: "Update now", type: "update" });

    if (isIncomplete) {
      actions.push({ id: "install_all", label: "Install to all tools", type: "install" });
    }

    // Per-tool actions
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

    // Per-tool install
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
