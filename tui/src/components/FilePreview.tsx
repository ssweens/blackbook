import React from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface FilePreviewProps {
  file: FileStatus | null;
}

function getToolScope(file: FileStatus): string {
  if (file.tools && file.tools.length > 0) {
    return file.tools.join(", ");
  }
  return "All tools";
}

export function FilePreview({ file }: FilePreviewProps) {
  if (!file) return null;

  const scope = getToolScope(file);

  // Show resolved target path(s) from instances
  const targetPaths = [...new Set(file.instances.map((i) => i.targetPath))];
  const targetDisplay = targetPaths.length === 1 ? targetPaths[0] : targetPaths.length > 1 ? `${targetPaths[0]} (+${targetPaths.length - 1} more)` : file.target;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      height={5}
    >
      <Box>
        <Text color="gray">Source: </Text>
        <Text color="cyan">{file.source}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">Tools: </Text>
        <Text color={file.tools && file.tools.length > 0 ? "magenta" : "blue"}>{scope}</Text>
      </Box>
      <Box>
        <Text color="gray">Target: </Text>
        <Text>{targetDisplay}</Text>
      </Box>
    </Box>
  );
}
