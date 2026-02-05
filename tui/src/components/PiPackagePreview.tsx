import React from "react";
import { Box, Text } from "ink";
import type { PiPackage } from "../lib/types.js";

interface PiPackagePreviewProps {
  pkg: PiPackage | null;
}

export function PiPackagePreview({ pkg }: PiPackagePreviewProps): React.ReactElement | null {
  if (!pkg) {
    return null;
  }

  const contents: string[] = [];
  if (pkg.extensions.length > 0) contents.push(`${pkg.extensions.length} ext`);
  if (pkg.skills.length > 0) contents.push(`${pkg.skills.length} skill`);
  if (pkg.prompts.length > 0) contents.push(`${pkg.prompts.length} prompt`);
  if (pkg.themes.length > 0) contents.push(`${pkg.themes.length} theme`);

  const contentsText = contents.length > 0 ? contents.join(", ") : "—";

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} height={4}>
      <Box>
        <Text color="gray">Source: </Text>
        <Text color="cyan">{pkg.marketplace}</Text>
      </Box>
      <Box>
        <Text color="gray">Contents: </Text>
        <Text color="cyan">{contentsText}</Text>
      </Box>
    </Box>
  );
}
