import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";
import { getPluginToolStatus } from "../lib/install.js";

interface PluginDetailProps {
  plugin: Plugin;
  onAction: (action: "install" | "uninstall" | "update" | "repair" | "back") => void;
  selectedAction: number;
}

export function PluginDetail({ plugin, selectedAction }: PluginDetailProps) {
  const toolStatuses = useMemo(() => getPluginToolStatus(plugin), [plugin]);
  
  const supportedTools = toolStatuses.filter(t => t.supported && t.enabled);
  const installedCount = supportedTools.filter(t => t.installed).length;
  const needsRepair = plugin.installed && installedCount < supportedTools.length && supportedTools.length > 0;
  
  const actions = useMemo(() => {
    if (plugin.installed) {
      const base = ["Uninstall", "Update now"];
      if (needsRepair) {
        base.push("Install to all tools");
      }
      base.push("Back to plugin list");
      return base;
    }
    return ["Install", "Back to plugin list"];
  }, [plugin.installed, needsRepair]);

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
        {needsRepair && (
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
            <Box key={status.toolId} marginLeft={1}>
              <Text color="gray">• {status.toolName}: </Text>
              <Text color={color}>{label}</Text>
            </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Components:</Text>
        {plugin.skills.length > 0 && (
          <Box marginLeft={1} flexDirection="column">
            <Text color="gray">• Skills:</Text>
            {plugin.skills.map((skill) => (
              <Box key={skill} marginLeft={2}>
                <Text color="cyan">- {skill}</Text>
              </Box>
            ))}
          </Box>
        )}
        {plugin.commands.length > 0 && (
          <Box marginLeft={1} flexDirection="column">
            <Text color="gray">• Commands:</Text>
            {plugin.commands.map((cmd) => (
              <Box key={cmd} marginLeft={2}>
                <Text color="cyan">- {cmd}</Text>
              </Box>
            ))}
          </Box>
        )}
        {plugin.agents.length > 0 && (
          <Box marginLeft={1} flexDirection="column">
            <Text color="gray">• Agents:</Text>
            {plugin.agents.map((agent) => (
              <Box key={agent} marginLeft={2}>
                <Text color="cyan">- {agent}</Text>
              </Box>
            ))}
          </Box>
        )}
        {plugin.hooks.length > 0 && (
          <Box marginLeft={1} flexDirection="column">
            <Text color="gray">• Hooks:</Text>
            {plugin.hooks.map((hook) => (
              <Box key={hook} marginLeft={2}>
                <Text color="cyan">- {hook}</Text>
              </Box>
            ))}
          </Box>
        )}
        {plugin.hasMcp && (
          <Box marginLeft={1}>
            <Text color="gray">• MCP: </Text>
            <Text color="green">✔</Text>
          </Box>
        )}
        {plugin.hasLsp && (
          <Box marginLeft={1}>
            <Text color="gray">• LSP: </Text>
            <Text color="green">✔</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;
          const color =
            action === "Uninstall"
              ? "red"
              : action === "Install" || action === "Install to all tools"
                ? "green"
                : action.includes("Update")
                  ? "cyan"
                  : "white";

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
