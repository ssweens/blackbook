/**
 * PlaybookApp — the new playbook-centric TUI.
 *
 * 4 tabs: Dashboard · Playbook · Sources · Settings
 *
 * Global keybinds:
 *   1-4 / Tab / Shift+Tab  — switch tabs
 *   r                      — reload playbook + refresh preview
 *   q / Ctrl+C             — quit
 */

import React, { useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { usePlaybookStore, type PlaybookTab } from "../lib/playbook-store.js";
import { DashboardTab } from "./DashboardTab.js";
import { PlaybookTab as PlaybookTabComp } from "./PlaybookTab.js";
import { SourcesTab } from "./SourcesTab.js";
import { SettingsTab } from "./SettingsTab.js";
import { NotificationsBar } from "./NotificationsBar.js";

const TABS: { id: PlaybookTab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "playbook", label: "Playbook" },
  { id: "sources", label: "Sources" },
  { id: "settings", label: "Settings" },
];

export function PlaybookApp({ playbookPath }: { playbookPath?: string }) {
  const { exit } = useApp();
  const {
    activeTab,
    setActiveTab,
    loadPlaybookFromPath,
    reloadPlaybook,
    notifications,
    dismissNotification,
  } = usePlaybookStore();

  // Load playbook on mount — skipped if cli.tsx already pre-populated the store.
  useEffect(() => {
    if (playbookPath && !usePlaybookStore.getState().playbook) {
      void loadPlaybookFromPath(playbookPath);
    } else if (playbookPath) {
      // Already loaded synchronously — just kick off the async background work.
      void usePlaybookStore.getState().detectAllTools();
      void usePlaybookStore.getState().refreshPreview();
    }
  }, [playbookPath]);

  const tabIdx = TABS.findIndex((t) => t.id === activeTab);

  useInput((input, key) => {
    // Quit
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    // Reload
    if (input === "r") {
      void reloadPlaybook();
      return;
    }
    // Number shortcuts
    const num = parseInt(input, 10);
    if (num >= 1 && num <= TABS.length) {
      setActiveTab(TABS[num - 1]!.id);
      return;
    }
    // Tab / Shift+Tab cycling
    if (key.tab && !key.shift) {
      const next = (tabIdx + 1) % TABS.length;
      setActiveTab(TABS[next]!.id);
    }
    if (key.tab && key.shift) {
      const next = (tabIdx - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[next]!.id);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />

      {/* Error and loading are surfaced inside DashboardTab */}

      {/* Tab content */}
      <Box flexGrow={1}>
        {activeTab === "dashboard" && (
          <DashboardTab isFocused={activeTab === "dashboard"} />
        )}
        {activeTab === "playbook" && (
          <PlaybookTabComp isFocused={activeTab === "playbook"} />
        )}
        {activeTab === "sources" && (
          <SourcesTab isFocused={activeTab === "sources"} />
        )}
        {activeTab === "settings" && (
          <SettingsTab isFocused={activeTab === "settings"} />
        )}
      </Box>

      {/* Notifications */}
      <NotificationsBar
        notifications={notifications}
        onDismiss={dismissNotification}
      />

      {/* Status bar */}
      <Box paddingX={2} borderStyle="single" borderTop>
        <Text dimColor>
          1-4: switch tabs  ·  r: reload  ·  q: quit
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onSelect,
}: {
  activeTab: PlaybookTab;
  onSelect: (t: PlaybookTab) => void;
}) {
  return (
    <Box borderStyle="single" borderBottom paddingX={1}>
      {TABS.map((t, i) => {
        const active = t.id === activeTab;
        return (
          <Box key={t.id} marginRight={2}>
            <Text
              bold={active}
              color={active ? "cyan" : undefined}
              dimColor={!active}
            >
              [{i + 1}] {t.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
