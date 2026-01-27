import React from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";

interface PluginPreviewProps {
  plugin: Plugin | null;
}

export function PluginPreview({ plugin }: PluginPreviewProps) {
  if (!plugin) {
    return null;
  }

  const skillsText = plugin.skills.length > 0 ? plugin.skills.join(", ") : null;
  const commandsText = plugin.commands.length > 0 ? plugin.commands.join(", ") : null;
  const agentsText = plugin.agents.length > 0 ? plugin.agents.join(", ") : null;

  const indicators: string[] = [];
  if (plugin.hooks.length > 0) indicators.push("Hooks");
  if (plugin.hasMcp) indicators.push("MCP");
  if (plugin.hasLsp) indicators.push("LSP");

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Box>
        <Text color="gray">Skills: </Text>
        <Text color="cyan">{skillsText ?? "—"}</Text>
      </Box>
      <Box>
        <Text color="gray">Commands: </Text>
        <Text color="cyan">{commandsText ?? "—"}</Text>
      </Box>
      <Box>
        <Text color="gray">Agents: </Text>
        <Text color="cyan">{agentsText ?? "—"}</Text>
        {indicators.length > 0 && (
          <>
            <Text color="gray"> | </Text>
            {indicators.map((ind, i) => (
              <React.Fragment key={ind}>
                <Text color="cyan">{ind} </Text>
                <Text color="green">✔</Text>
                {i < indicators.length - 1 && <Text color="gray"> | </Text>}
              </React.Fragment>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
