import React from "react";
import { Box, Text } from "ink";
import type { Tab } from "../lib/types.js";

interface HintBarProps {
  tab: Tab;
  hasDetail: boolean;
}

const HINTS: Record<Tab, string> = {
  discover: "/ search · Space toggle · Enter details · s sort · r reverse · q quit",
  installed: "/ search · Space toggle · Enter details · s sort · r reverse · q quit",
  marketplaces: "Enter select · u update · r remove · q quit",
  tools: "Enter toggle · Space toggle · e edit config dir · q quit",
  sync: "y to sync (press twice) · Enter details · q quit",
};

export function HintBar({ tab, hasDetail }: HintBarProps) {
  const hint = hasDetail
    ? "ctrl+p to navigate · Enter to select · Esc to back"
    : HINTS[tab];

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} marginTop={1} paddingTop={1}>
      <Text color="gray" italic>
        {hint}
      </Text>
    </Box>
  );
}
