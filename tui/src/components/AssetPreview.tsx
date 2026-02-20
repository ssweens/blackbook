import React from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface AssetPreviewProps {
  asset: FileStatus | null;
}

export function AssetPreview({ asset }: AssetPreviewProps) {
  if (!asset) return null;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      height={4}
    >
      <Box>
        <Text color="gray">Source: </Text>
        <Text color="cyan">{asset.source}</Text>
      </Box>
    </Box>
  );
}
