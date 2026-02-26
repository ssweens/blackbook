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
    const bothChangedInstances = item.file.instances.filter((i) => i.driftKind === "both-changed").map((i) => i.instanceName);
    const targetChangedInstances = item.file.instances.filter((i) => i.driftKind === "target-changed").map((i) => i.instanceName);
    const sourceChangedInstances = item.file.instances
      .filter((i) => i.status === "drifted" && i.driftKind !== "target-changed" && i.driftKind !== "both-changed")
      .map((i) => i.instanceName);

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
          {sourceChangedInstances.length > 0 && (
            <>
              <Text color="gray">{item.missingInstances.length > 0 ? " · " : ""}Source changed (sync): </Text>
              <Text color="yellow">{sourceChangedInstances.join(", ")}</Text>
            </>
          )}
          {targetChangedInstances.length > 0 && (
            <>
              <Text color="gray">{(item.missingInstances.length > 0 || sourceChangedInstances.length > 0) ? " · " : ""}Target changed (pullback): </Text>
              <Text color="magenta">{targetChangedInstances.join(", ")}</Text>
            </>
          )}
          {bothChangedInstances.length > 0 && (
            <>
              <Text color="gray">{(item.missingInstances.length > 0 || sourceChangedInstances.length > 0 || targetChangedInstances.length > 0) ? " · " : ""}Both changed: </Text>
              <Text color="red">{bothChangedInstances.join(", ")}</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  // Default to plugin preview
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
