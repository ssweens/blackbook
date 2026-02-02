import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ConfigFile } from "../lib/types.js";

interface ConfigPreviewProps {
  config: ConfigFile | null;
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  if (!config) return null;

  const mappingSummary = useMemo(() => {
    if (config.mappings && config.mappings.length > 0) {
      return config.mappings[0];
    }
    if (config.sourcePath && config.targetPath) {
      return { source: config.sourcePath, target: config.targetPath };
    }
    return null;
  }, [config]);

  const mappingCount = config.mappings?.length ?? (config.sourcePath ? 1 : 0);

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={4}>
      <Box>
        <Text color="gray">Tool: </Text>
        <Text color="magenta">{config.toolId}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">
          {mappingSummary ? `${mappingSummary.source} → ${mappingSummary.target}` : "(no mappings)"}
        </Text>
        {mappingCount > 1 && (
          <Text color="gray"> {`(+${mappingCount - 1} more)`}</Text>
        )}
      </Box>
    </Box>
  );
}
