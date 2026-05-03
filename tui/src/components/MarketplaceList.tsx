import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { MarketplaceRow } from "../lib/marketplace-row.js";

interface MarketplaceListProps {
  rows: MarketplaceRow[];
  selectedIndex: number;
  maxHeight?: number;
}

function formatDate(date?: Date): string {
  if (!date) return "never";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

export const MarketplaceList = React.memo(function MarketplaceList({ rows, selectedIndex, maxHeight = 22 }: MarketplaceListProps) {
  const { visibleRows, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (rows.length <= maxHeight) {
      return { visibleRows: rows, startIndex: 0, hasMore: false, hasPrev: false };
    }

    const maxStart = Math.max(0, rows.length - maxHeight);
    const start = Math.min(Math.max(0, selectedIndex - (maxHeight - 1)), maxStart);

    return {
      visibleRows: rows.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < rows.length,
      hasPrev: start > 0,
    };
  }, [rows, selectedIndex, maxHeight]);

  const pluginNameWidth = useMemo(() => {
    const names = rows.filter((r) => r.kind === "plugin").map((r) => r.marketplace.name.length);
    return Math.min(30, Math.max(...names, 10));
  }, [rows]);

  const piNameWidth = useMemo(() => {
    const names = rows.filter((r) => r.kind === "pi").map((r) => r.marketplace.name.length);
    return Math.min(30, Math.max(...names, 10));
  }, [rows]);

  return (
    <Box flexDirection="column">
      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleRows.map((row, i) => {
        const absoluteIndex = startIndex + i;
        const isSelected = selectedIndex === absoluteIndex;

        if (row.kind === "add-plugin") {
          return (
            <Box key="add-plugin" flexDirection="column" marginBottom={1}>
              <Box marginBottom={1}>
                <Text bold>Plugin Marketplaces</Text>
              </Box>
              <Box>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color="green">+ Add Plugin Marketplace</Text>
              </Box>
            </Box>
          );
        }

        if (row.kind === "add-pi") {
          return (
            <Box key="add-pi" flexDirection="column" marginTop={1} marginBottom={1}>
              <Box marginBottom={1}>
                <Text bold>Pi Package Marketplaces</Text>
              </Box>
              <Box>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color="green">+ Add Pi Marketplace</Text>
              </Box>
            </Box>
          );
        }

        if (row.kind === "plugin") {
          const m = row.marketplace;
          const hasInstalled = m.installedCount > 0;
          const isReadOnly = m.source === "claude";
          const paddedName = m.name.padEnd(pluginNameWidth);
          const statusIcon = m.enabled ? "●" : "○";
          const statusColor = m.enabled ? "green" : "gray";

          return (
            <Box key={`plugin:${m.name}`} flexDirection="column">
              <Box>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color={statusColor}>{statusIcon} </Text>
                {hasInstalled && <Text color="yellow">* </Text>}
                <Text bold={isSelected} color={m.enabled ? "white" : "gray"}>{paddedName}</Text>
                {hasInstalled && <Text color="yellow"> *</Text>}
                {isReadOnly && <Text color="magenta"> (Claude)</Text>}
                {!m.enabled && <Text color="gray"> (disabled)</Text>}
              </Box>

              <Box marginLeft={4}><Text color="gray">{m.url}</Text></Box>
              <Box marginLeft={4} marginBottom={1}>
                <Text color="gray">
                  {m.plugins.length} plugins
                  {m.installedCount > 0 && ` • ${m.installedCount} installed`}
                  {m.updatedAt && ` • Updated ${formatDate(m.updatedAt)}`}
                </Text>
              </Box>
            </Box>
          );
        }

        const pm = row.marketplace;
        const hasInstalled = pm.packages.some((p) => p.installed);
        const installedCount = pm.packages.filter((p) => p.installed).length;
        const paddedName = pm.name.padEnd(piNameWidth);
        const statusIcon = pm.enabled ? "●" : "○";
        const statusColor = pm.enabled ? "green" : "gray";

        return (
          <Box key={`pi:${pm.name}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
              <Text color={statusColor}>{statusIcon} </Text>
              {hasInstalled && <Text color="yellow">* </Text>}
              <Text bold={isSelected} color={pm.enabled ? "white" : "gray"}>{paddedName}</Text>
              {hasInstalled && <Text color="yellow"> *</Text>}
              {pm.builtIn && <Text color="magenta"> (built-in)</Text>}
              {!pm.enabled && <Text color="gray"> (disabled)</Text>}
            </Box>

            <Box marginLeft={4}><Text color="gray">{pm.source}</Text></Box>
            <Box marginLeft={4} marginBottom={1}>
              <Text color="gray">
                {pm.packages.length} available
                {installedCount > 0 && ` • ${installedCount} installed`}
              </Text>
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {rows.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
});
