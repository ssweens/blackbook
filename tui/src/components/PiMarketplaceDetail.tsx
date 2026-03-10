import React from "react";
import { Box, Text } from "ink";
import type { PiMarketplace } from "../lib/types.js";

interface PiMarketplaceDetailProps {
  marketplace: PiMarketplace;
  selectedIndex: number;
}

export type PiMarketplaceAction = "browse" | "remove" | "back";

export function getPiMarketplaceActions(marketplace: PiMarketplace): PiMarketplaceAction[] {
  const actions: PiMarketplaceAction[] = ["browse"];
  if (!marketplace.builtIn) {
    actions.push("remove");
  }
  actions.push("back");
  return actions;
}

const ACTION_LABELS: Record<PiMarketplaceAction, (pm: PiMarketplace) => string> = {
  browse: (pm) => `Browse packages (${pm.packages.length})`,
  remove: () => "Remove marketplace",
  back: () => "Back to marketplace list",
};

export function PiMarketplaceDetail({ marketplace, selectedIndex }: PiMarketplaceDetailProps) {
  const installed = marketplace.packages.filter((p) => p.installed);
  const actions = getPiMarketplaceActions(marketplace);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{marketplace.name}</Text>
        {marketplace.builtIn && <Text color="magenta"> (built-in)</Text>}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">{marketplace.source}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          {marketplace.packages.length} available packages
          {installed.length > 0 && ` • ${installed.length} installed`}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedIndex;
          const label = ACTION_LABELS[action](marketplace);
          const color = action === "remove" ? "red" : "white";

          return (
            <Box key={action}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {label}
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
