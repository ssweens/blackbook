import React from "react";
import { Box, Text } from "ink";
import type { Marketplace, Plugin } from "../lib/types.js";

interface MarketplaceDetailProps {
  marketplace: Marketplace;
  selectedIndex: number;
}

function formatDate(date?: Date): string {
  if (!date) return "never";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

export function MarketplaceDetail({ marketplace, selectedIndex }: MarketplaceDetailProps) {
  const installed = marketplace.plugins.filter((p) => p.installed);
  const available = marketplace.plugins.filter((p) => !p.installed);
  const isReadOnly = marketplace.source === "claude";
  
  const actions = [
    `Browse plugins (${available.length})`,
    `Update marketplace (last updated ${formatDate(marketplace.updatedAt)})`,
    marketplace.autoUpdate ? "Disable auto-update" : "Enable auto-update",
    ...(isReadOnly ? [] : ["Remove marketplace"]),
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{marketplace.name}</Text>
        {isReadOnly && <Text color="magenta"> (Claude - read-only)</Text>}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">{marketplace.url}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{marketplace.availableCount} available plugins</Text>
      </Box>

      {installed.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Installed plugins ({installed.length}):</Text>
          {installed.map((plugin) => (
            <Box key={plugin.name} marginLeft={1}>
              <Text color="gray">● </Text>
              <Text>{plugin.name}</Text>
              {plugin.description && (
                <Box marginLeft={1}>
                  <Text color="gray">{plugin.description.slice(0, 80)}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedIndex;
          const color = action.includes("Remove") ? "red" : "white";

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

      <Box marginTop={2}>
        <Text color="gray">Enter to select · Esc to go back</Text>
      </Box>
    </Box>
  );
}
