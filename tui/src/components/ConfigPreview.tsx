import React from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface ConfigPreviewProps {
  config: FileStatus | null;
}

function getToolId(config: FileStatus): string {
  if (config.tools && config.tools.length > 0) {
    return config.tools[0] ?? "";
  }
  return "";
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  if (!config) return null;

  const toolId = getToolId(config);

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
        <Text color="gray">Tool: </Text>
        <Text color="magenta">{toolId}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{config.source} → {config.target}</Text>
      </Box>
    </Box>
  );
}
