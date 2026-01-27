import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Marketplace } from "../lib/types.js";

interface MarketplaceListProps {
  marketplaces: Marketplace[];
  selectedIndex: number;
  showAddOption?: boolean;
}

function formatDate(date?: Date): string {
  if (!date) return "never";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

export function MarketplaceList({
  marketplaces,
  selectedIndex,
  showAddOption = true,
}: MarketplaceListProps) {
  const offset = showAddOption ? 1 : 0;

  const maxNameLen = useMemo(() => {
    return Math.min(30, Math.max(...marketplaces.map(m => m.name.length), 10));
  }, [marketplaces]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Manage marketplaces</Text>
      </Box>

      {showAddOption && (
        <Box>
          <Text color={selectedIndex === 0 ? "cyan" : "gray"}>
            {selectedIndex === 0 ? "❯ " : "  "}
          </Text>
          <Text color="green">+ Add Marketplace</Text>
        </Box>
      )}

      {marketplaces.map((m, i) => {
        const index = i + offset;
        const isSelected = selectedIndex === index;
        const hasNew = m.installedCount > 0;
        const isReadOnly = m.source === "claude";
        const paddedName = m.name.padEnd(maxNameLen);

        return (
          <Box key={m.name} flexDirection="column" marginTop={i === 0 && showAddOption ? 1 : 0}>
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color="gray">● </Text>
              {hasNew && <Text color="yellow">* </Text>}
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              {hasNew && <Text color="yellow"> *</Text>}
              {isReadOnly && <Text color="magenta"> (Claude)</Text>}
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">{m.url}</Text>
            </Box>

            <Box marginLeft={4}>
              <Text color="gray">
                {m.availableCount} available
                {m.installedCount > 0 && ` • ${m.installedCount} installed`}
                {m.updatedAt && ` • Updated ${formatDate(m.updatedAt)}`}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={2}>
        <Text color="gray">
          Enter to select · u to update · r to remove · Esc to go back
        </Text>
      </Box>
    </Box>
  );
}
