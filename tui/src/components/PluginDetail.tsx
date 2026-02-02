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
  const toolStatuses = getPluginToolStatus(plugin);
  
  // Use store-calculated incomplete status for consistency with list views
  const isIncomplete = plugin.installed && plugin.incomplete;
  
  const actions = useMemo(() => {
    if (plugin.installed) {
      const base = ["Uninstall", "Update now"];
      if (isIncomplete) {
        base.push("Install to all tools");
      }
      base.push("Back to plugin list");
      return base;
    }
    return ["Install", "Back to plugin list"];
  }, [plugin.installed, isIncomplete]);

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
        <Text bold>Components:</Text>
        {plugin.skills.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Skills: </Text>
            <Text color="cyan">{plugin.skills.join(", ")}</Text>
          </Box>
        )}
        {plugin.commands.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Commands: </Text>
            <Text color="cyan">{plugin.commands.join(", ")}</Text>
          </Box>
        )}
        {plugin.agents.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Agents: </Text>
            <Text color="cyan">{plugin.agents.join(", ")}</Text>
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
