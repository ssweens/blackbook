import React from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";
import { getPluginComponentConfig } from "../lib/config.js";

interface ComponentManagerProps {
  plugin: Plugin;
  selectedIndex: number;
}

interface ComponentItem {
  kind: "skill" | "command" | "agent";
  name: string;
  enabled: boolean;
}

export function getComponentItems(plugin: Plugin): ComponentItem[] {
  const config = getPluginComponentConfig(plugin.marketplace, plugin.name);
  const items: ComponentItem[] = [];

  for (const skill of plugin.skills) {
    items.push({
      kind: "skill",
      name: skill,
      enabled: !config.disabledSkills.includes(skill),
    });
  }

  for (const cmd of plugin.commands) {
    items.push({
      kind: "command",
      name: cmd,
      enabled: !config.disabledCommands.includes(cmd),
    });
  }

  for (const agent of plugin.agents) {
    items.push({
      kind: "agent",
      name: agent,
      enabled: !config.disabledAgents.includes(agent),
    });
  }

  return items;
}

export function ComponentManager({ plugin, selectedIndex }: ComponentManagerProps) {
  const items = getComponentItems(plugin);

  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="gray">No components to manage.</Text>
      </Box>
    );
  }

  // Group by kind for display
  let currentKind: string | null = null;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{plugin.name}</Text>
        <Text color="gray"> — Manage Components</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Use ↑↓ to navigate, Space/Enter to toggle, Esc to go back</Text>
      </Box>

      {items.map((item, i) => {
        const showHeader = item.kind !== currentKind;
        currentKind = item.kind;
        const isSelected = i === selectedIndex;
        const kindLabel = item.kind === "skill" ? "Skills" : item.kind === "command" ? "Commands" : "Agents";

        return (
          <React.Fragment key={`${item.kind}:${item.name}`}>
            {showHeader && (
              <Box marginTop={i > 0 ? 1 : 0}>
                <Text bold color="white">{kindLabel}:</Text>
              </Box>
            )}
            <Box marginLeft={2}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={item.enabled ? "green" : "red"}>
                {item.enabled ? "☑" : "☐"}
              </Text>
              <Text color={isSelected ? "white" : "gray"}> {item.name}</Text>
              {!item.enabled && (
                <Text color="red" dimColor> (disabled)</Text>
              )}
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
