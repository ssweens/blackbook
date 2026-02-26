import React from "react";
import { Box, Text } from "ink";
import type { Tab } from "../lib/types.js";

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "sync", label: "Sync" },
  { id: "tools", label: "Tools" },
  { id: "discover", label: "Discover" },
  { id: "installed", label: "Installed" },
  { id: "marketplaces", label: "Marketplaces" },
  { id: "settings", label: "Settings" },
];

export function TabBar({ activeTab }: TabBarProps) {
  return (
    <Box marginBottom={1}>
      <Text bold color="cyan">Library</Text>
      <Text>  </Text>
      {TABS.map((tab, i) => (
        <React.Fragment key={tab.id}>
          {activeTab === tab.id ? (
            <>
              <Text color="cyan">[</Text>
              <Text bold color="white">{tab.label}</Text>
              <Text color="cyan">]</Text>
            </>
          ) : (
            <Text color="gray">{tab.label}</Text>
          )}
          {i < TABS.length - 1 && <Text>  </Text>}
        </React.Fragment>
      ))}
      <Text color="gray">  (←/→ or tab to cycle)</Text>
    </Box>
  );
}
