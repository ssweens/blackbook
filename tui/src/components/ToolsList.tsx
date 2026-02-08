import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ManagedToolRow, ToolDetectionResult } from "../lib/types.js";

interface ToolsListProps {
  tools: ManagedToolRow[];
  selectedIndex: number;
  detection: Record<string, ToolDetectionResult>;
  detectionPending: Record<string, boolean>;
  actionInProgress: string | null;
  maxHeight?: number;
}

export function ToolsList({
  tools,
  selectedIndex,
  detection,
  detectionPending,
  actionInProgress,
  maxHeight = 12,
}: ToolsListProps) {
  const pendingCount = useMemo(
    () => Object.values(detectionPending).filter((isPending) => isPending).length,
    [detectionPending]
  );
  const totalChecks = useMemo(() => Object.keys(detectionPending).length, [detectionPending]);

  const { visibleTools, startIndex, hasMore, hasPrev } = useMemo(() => {
    if (tools.length <= maxHeight) {
      return {
        visibleTools: tools,
        startIndex: 0,
        hasMore: false,
        hasPrev: false,
      };
    }

    const maxStart = Math.max(0, tools.length - maxHeight);
    const start = Math.min(Math.max(0, selectedIndex - (maxHeight - 1)), maxStart);

    return {
      visibleTools: tools.slice(start, start + maxHeight),
      startIndex: start,
      hasMore: start + maxHeight < tools.length,
      hasPrev: start > 0,
    };
  }, [tools, selectedIndex, maxHeight]);

  const getStatusIcon = (result: ToolDetectionResult | undefined): { icon: string; color: string; label: string } => {
    if (!result) return { icon: "⟳", color: "gray", label: "Checking" };
    if (!result.installed) return { icon: "✗", color: "red", label: "Not installed" };
    return { icon: "✓", color: "green", label: "Installed" };
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Manage tools</Text>
      </Box>

      {pendingCount > 0 && (
        <Box marginBottom={1}>
          <Text color="cyan">
            ↻ Checking tool statuses… {pendingCount} remaining
            {totalChecks > 0 ? ` (${totalChecks - pendingCount}/${totalChecks} complete)` : ""}
          </Text>
        </Box>
      )}

      {hasPrev && (
        <Box>
          <Text color="gray">  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {visibleTools.map((tool, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = selectedIndex === actualIndex;
        const status = getStatusIcon(detection[tool.toolId]);
        const result = detection[tool.toolId];
        const installedVersion = result?.installedVersion;
        const latestVersion = result?.latestVersion;
        const hasUpdate = result?.hasUpdate;
        const enabledLabel = tool.synthetic ? "Not configured" : tool.enabled ? "Enabled" : "Disabled";
        const enabledColor = tool.synthetic ? "yellow" : tool.enabled ? "green" : "gray";
        const running = actionInProgress === tool.toolId;
        const pending = detectionPending[tool.toolId] === true;
        const loading = running || pending;

        return (
          <Box key={`${tool.toolId}:${tool.instanceId}`} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
              <Text bold={isSelected} color="white">
                {tool.displayName}
              </Text>
              <Text color="gray"> ({tool.toolId}:{tool.instanceId})</Text>
              <Text> </Text>
              <Text color={enabledColor}>{enabledLabel}</Text>
              <Text> </Text>
              {loading ? (
                <Text color="gray">⟳</Text>
              ) : (
                <Text color={status.color}>{status.icon}</Text>
              )}
              {result?.installed ? (
                <Text color="gray"> v{installedVersion || "?"}</Text>
              ) : (
                <Text color="gray"> v{loading ? "..." : "—"}</Text>
              )}
              <Text color={hasUpdate ? "yellow" : "gray"}>
                {latestVersion ? ` · latest v${latestVersion}` : loading ? " · latest ..." : " · latest ?"}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <Text color="gray">{tool.configDir}</Text>
            </Box>
          </Box>
        );
      })}

      {hasMore && (
        <Box>
          <Text color="gray">  ↓ {tools.length - startIndex - maxHeight} more below</Text>
        </Box>
      )}
    </Box>
  );
}
