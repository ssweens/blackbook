import React from "react";
import { Box, Text } from "ink";
import type { Tab } from "../lib/types.js";

interface HintBarProps {
  tab: Tab;
  hasDetail: boolean;
  toolsHint?: string;
}

const HINTS: Record<Tab, string> = {
  discover: "/ search · Space plugin toggle · Enter details · s sort · r reverse · R refresh · q quit",
  installed: "/ search · Space plugin toggle · Enter details · s sort · r reverse · R refresh · q quit",
  marketplaces: "Enter select · u update · r remove · R refresh · q quit",
  tools: "Enter detail · i install · u update · d uninstall · e edit config · Space toggle · R refresh · q quit",
  sync: "y to sync missing/drifted items (press twice) · Enter details · R refresh · q quit",
};

export function HintBar({ tab, hasDetail, toolsHint }: HintBarProps) {
  const hint = hasDetail
    ? "ctrl+p to navigate · Enter to select · Esc to back"
    : tab === "tools" && toolsHint
      ? toolsHint
      : HINTS[tab];

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} marginTop={1} paddingTop={1}>
      <Text color="gray" italic>
        {hint}
      </Text>
    </Box>
  );
}
