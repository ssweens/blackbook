import React from "react";
import { Box, Text } from "ink";
import type { SyncPreviewItem } from "../lib/types.js";

interface SyncPreviewProps {
  item: SyncPreviewItem | null;
}

export function SyncPreview({ item }: SyncPreviewProps) {
  if (!item) {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
        <Text color="gray">No item selected</Text>
      </Box>
    );
  }

  if (item.kind === "asset") {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
        <Box>
          <Text color="gray">Asset: </Text>
          <Text color="white">{item.asset.name}</Text>
        </Box>
        <Box>
          <Text color="gray">Missing instances: </Text>
          <Text color="yellow">{item.missingInstances.join(", ") || "—"}</Text>
        </Box>
        <Box>
          <Text color="gray">Drifted instances: </Text>
          <Text color="yellow">{item.driftedInstances.join(", ") || "—"}</Text>
        </Box>
      </Box>
    );
  }

  if (item.kind === "tool") {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
        <Box>
          <Text color="gray">Tool: </Text>
          <Text color="white">{item.name}</Text>
        </Box>
        <Box>
          <Text color="gray">Installed: </Text>
          <Text color="yellow">v{item.installedVersion}</Text>
        </Box>
        <Box>
          <Text color="gray">Latest: </Text>
          <Text color="green">v{item.latestVersion}</Text>
        </Box>
      </Box>
    );
  }

  if (item.kind === "file") {
    const conflictInstances = item.file.instances.filter((i) => i.driftKind === "both-changed").map((i) => i.instanceName);
    const pullbackInstances = item.file.instances.filter((i) => i.driftKind === "target-changed").map((i) => i.instanceName);
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
        <Box>
          <Text color="gray">File: </Text>
          <Text color="white">{item.file.name}</Text>
          {item.file.pullback && <Text color="magenta"> (pullback)</Text>}
        </Box>
        <Box>
          <Text color="gray">Source: </Text>
          <Text color="cyan">{item.file.source} → {item.file.target}</Text>
        </Box>
        <Box>
          {item.missingInstances.length > 0 && (
            <>
              <Text color="gray">Missing: </Text>
              <Text color="yellow">{item.missingInstances.join(", ")}</Text>
            </>
          )}
          {pullbackInstances.length > 0 && (
            <>
              <Text color="gray">{item.missingInstances.length > 0 ? " · " : ""}Pullback: </Text>
              <Text color="magenta">{pullbackInstances.join(", ")}</Text>
            </>
          )}
          {conflictInstances.length > 0 && (
            <>
              <Text color="gray">{(item.missingInstances.length > 0 || pullbackInstances.length > 0) ? " · " : ""}Conflict: </Text>
              <Text color="red">{conflictInstances.join(", ")}</Text>
            </>
          )}
          {item.missingInstances.length === 0 && pullbackInstances.length === 0 && conflictInstances.length === 0 && item.driftedInstances.length > 0 && (
            <>
              <Text color="gray">Drifted: </Text>
              <Text color="yellow">{item.driftedInstances.join(", ")}</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  if (item.kind === "config") {
    const mappingSummary = item.config.mappings && item.config.mappings.length > 0
      ? item.config.mappings[0]
      : item.config.sourcePath && item.config.targetPath
        ? { source: item.config.sourcePath, target: item.config.targetPath }
        : null;
    const mappingCount = item.config.mappings?.length ?? (item.config.sourcePath ? 1 : 0);

    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
        <Box>
          <Text color="gray">Config: </Text>
          <Text color="white">{item.config.name}</Text>
          <Text color="gray"> · </Text>
          <Text color="magenta">{item.config.toolId}</Text>
        </Box>
        <Box>
          <Text color="gray">Source: </Text>
          <Text color="cyan">
            {mappingSummary ? `${mappingSummary.source} → ${mappingSummary.target}` : "(no mappings)"}
          </Text>
          {mappingCount > 1 && <Text color="gray"> {`(+${mappingCount - 1} more)`}</Text>}
        </Box>
        <Box>
          <Text color="gray">Status: </Text>
          <Text color="yellow">
            {item.missing && item.drifted ? "Missing & Drifted" : item.missing ? "Missing" : "Drifted"}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={5}>
      <Box>
        <Text color="gray">Plugin: </Text>
        <Text color="white">{item.plugin.name}</Text>
      </Box>
      <Box>
        <Text color="gray">Missing instances: </Text>
        <Text color="yellow">{item.missingInstances.join(", ")}</Text>
      </Box>
    </Box>
  );
}
