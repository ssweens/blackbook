import React from "react";
import { Box, Text } from "ink";
import type { ConfigFile } from "../lib/types.js";

interface ConfigPreviewProps {
  config: ConfigFile | null;
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  if (!config) return null;

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={4}>
      <Box>
        <Text color="gray">Tool: </Text>
        <Text color="magenta">{config.toolId}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{config.sourcePath}</Text>
        <Text color="gray"> → </Text>
        <Text color="cyan">{config.targetPath}</Text>
      </Box>
    </Box>
  );
}
