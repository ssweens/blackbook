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
import { DashboardTab, handleDashboardInput } from "./DashboardTab.js";
import { PlaybookTab as PlaybookBrowseTab } from "./PlaybookTab.js";
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
  const activeTab = usePlaybookStore((s) => s.activeTab);
  const setActiveTab = usePlaybookStore((s) => s.setActiveTab);
  const reloadPlaybook = usePlaybookStore((s) => s.reloadPlaybook);
  const notifications = usePlaybookStore((s) => s.notifications);
  const dismissNotification = usePlaybookStore((s) => s.dismissNotification);

  // On mount: if playbook was already loaded synchronously in cli.tsx, just
  // kick off background detection + preview. If it wasn't (error during load),
  // don't retry — the error is already in the store.
  // Auto-detect tools on mount — fast (just `which` calls, all async).
  // Preview is manual-only (press r) — file hashing is sync I/O that blocks
  // the event loop and kills input handling.
  useEffect(() => {
    const state = usePlaybookStore.getState();
    if (state.playbook) {
      state.detectAllTools().catch(() => {});
    }
  }, []);

  const tabIdx = TABS.findIndex((t) => t.id === activeTab);

  // Single useInput handler for the entire app — no child useInput hooks.
  // This avoids ink's setRawMode conflicts when multiple useInput are active.
  const store = usePlaybookStore;
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
    // Number shortcuts for tabs
    const num = parseInt(input, 10);
    if (num >= 1 && num <= TABS.length) {
      setActiveTab(TABS[num - 1]!.id);
      return;
    }
    // Tab / Shift+Tab / left / right cycling
    if ((key.tab && !key.shift) || key.rightArrow) {
      const next = (tabIdx + 1) % TABS.length;
      setActiveTab(TABS[next]!.id);
      return;
    }
    if ((key.tab && key.shift) || key.leftArrow) {
      const next = (tabIdx - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[next]!.id);
      return;
    }

    // Delegate remaining keys to active tab
    if (activeTab === "dashboard") {
      handleDashboardInput(input, key, store);
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
          <PlaybookBrowseTab isFocused={activeTab === "playbook"} />
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
