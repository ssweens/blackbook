import React from "react";
import { Box, Text } from "ink";
import type { Asset } from "../lib/types.js";

interface AssetPreviewProps {
  asset: Asset | null;
}

export function AssetPreview({ asset }: AssetPreviewProps) {
  if (!asset) return null;

  const overrideCount = asset.overrides ? Object.keys(asset.overrides).length : 0;
  const targetLabel = asset.defaultTarget || "(default)";

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={4}>
      <Box>
        <Text color="gray">Source: </Text>
        <Text color="cyan">{asset.source}</Text>
      </Box>
      <Box>
        <Text color="gray">Default target: </Text>
        <Text color="cyan">{targetLabel}</Text>
      </Box>
      <Box>
        <Text color="gray">Overrides: </Text>
        <Text color="cyan">{overrideCount > 0 ? overrideCount.toString() : "—"}</Text>
      </Box>
    </Box>
  );
}
