import React from "react";
import { Box, Text } from "ink";
import type { Tab } from "../lib/types.js";

interface HintBarProps {
  tab: Tab;
  hasDetail: boolean;
  toolsHint?: string;
  consultationAvailable?: boolean;
  /** Replaces the generic detail hint for overlays whose actions differ (e.g. the profile detail has no pullback). */
  detailHint?: string;
  /** Replaces the tab's list hint while a sub-mode is active (Projects drill-in, Profiles builder). */
  modeHint?: string;
}

const HINTS: Record<Tab, string> = {
  discover: "/ search · Space plugin toggle · Enter details · s sort · r reverse · R refresh · q quit",
  installed: "/ search · Space plugin toggle · Enter details · s sort · r reverse · R refresh · q quit",
  marketplaces: "Enter select · u update · r remove · R refresh · q quit",
  tools: "Enter detail · i install · u update · d uninstall · e edit config · Space toggle · R refresh · q quit",
  sync: "y to sync missing/changed items (press twice) · Enter details · d diff/detail · R refresh · q quit",
  // The tab footers carry the per-mode keys (drill-in / builder); this bar holds the list-level ones.
  projects: "Enter open · P apply profile · S save lock as profile · c consult advisor · a add · A adopt · d remove · R refresh · q quit",
  profiles: "Enter details · P apply to a project… · G apply to Global · e edit · n new · d delete · R refresh · q quit",
  settings: "↑/↓ select · Enter edit · Esc cancel · R refresh · q quit",
};

export const HintBar = React.memo(function HintBar({
  tab,
  hasDetail,
  toolsHint,
  consultationAvailable = false,
  detailHint,
  modeHint,
}: HintBarProps) {
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
        ? (detailHint ?? `↑/↓ to navigate · Enter to select${consultationAvailable ? " · c consult advisor" : ""} · p pullback (if available) · Esc to back`)
        : (modeHint ?? HINTS[tab]);

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
