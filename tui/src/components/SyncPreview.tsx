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

  if (item.kind === "config") {
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
          <Text color="cyan">{item.config.sourcePath}</Text>
          <Text color="gray"> → </Text>
          <Text color="cyan">{item.config.targetPath}</Text>
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
