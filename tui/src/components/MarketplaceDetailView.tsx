import React from "react";
import { Box, Text } from "ink";
import { MARKETPLACE_CACHE_TTL_SECONDS } from "../lib/marketplace.js";
import {
  getMarketplaceDetailActions,
  type MarketplaceDetailContext,
} from "../lib/marketplace-detail.js";

interface MarketplaceDetailViewProps {
  detail: MarketplaceDetailContext;
  selectedIndex: number;
}

export function MarketplaceDetailView({ detail, selectedIndex }: MarketplaceDetailViewProps) {
  const actions = getMarketplaceDetailActions(detail);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{detail.marketplace.name}</Text>
        {detail.kind === "plugin" && detail.marketplace.source === "claude" && (
          <Text color="magenta"> (Claude - read-only)</Text>
        )}
        {detail.kind === "pi" && detail.marketplace.builtIn && (
          <Text color="magenta"> (built-in)</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          {detail.kind === "plugin" ? detail.marketplace.url : detail.marketplace.source}
        </Text>
      </Box>

      {detail.kind === "plugin" && !detail.marketplace.isLocal && (
        <Box marginBottom={1}>
          <Text color="gray">
            Remote data may be cached for up to {Math.floor(MARKETPLACE_CACHE_TTL_SECONDS / 60)} minutes.
          </Text>
        </Box>
      )}

      <Box marginBottom={1}>
        {detail.kind === "plugin" ? (
          <Text>
            {detail.marketplace.plugins.length} total plugins
            {detail.marketplace.installedCount > 0 && ` • ${detail.marketplace.installedCount} installed`}
          </Text>
        ) : (
          <Text>
            {detail.marketplace.packages.length} available packages
            {detail.marketplace.packages.some((p) => p.installed) && (
              ` • ${detail.marketplace.packages.filter((p) => p.installed).length} installed`
            )}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedIndex;
          const color = action.tone === "danger" ? "red" : "white";

          return (
            <Box key={`${action.type}:${action.label}`}>
              <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {action.label}
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
