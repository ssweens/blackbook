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
  sync: "y to sync missing/changed items (press twice) · Enter details · d diff/detail · R refresh · q quit",
  projects: "Enter open · a add · A adopt · P apply profile · d remove · (in project) p push · u pull · e toggle · d delete · Esc back · R refresh · q quit",
  settings: "↑/↓ select · Enter edit · Esc cancel · R refresh · q quit",
};

export const HintBar = React.memo(function HintBar({ tab, hasDetail, toolsHint }: HintBarProps) {
  // toolsHint already fully accounts for every tools-tab state, INCLUDING Tool
  // Detail being open (it has its own detailTool branch) — so it must be
  // checked before the generic hasDetail hint, not after. The old order meant
  // hasDetail (true whenever Tool Detail is open, since it's a "detail" mode
  // overlay) always won first, making the tools-specific hint unreachable
  // exactly when it mattered most: i/u/d/e/Space/m were never hinted while
  // viewing a tool's detail.
  const hint =
    tab === "tools" && toolsHint
      ? toolsHint
      : hasDetail
        ? "↑/↓ to navigate · Enter to select · p pullback (if available) · Esc to back"
        : HINTS[tab];

  return (
    // height caps the text row to exactly 1 line regardless of terminal width
    // or hint length — see StatusBar.tsx for why an unbounded wrap here would
    // silently exceed the CHROME_ROWS budget and trigger Ink's full-screen
    // clearTerminal fallback on every re-render.
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} marginTop={1} paddingTop={1} height={3}>
      <Text color="gray" italic wrap="truncate">
        {hint}
      </Text>
    </Box>
  );
});
