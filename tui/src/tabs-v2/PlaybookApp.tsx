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

import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { usePlaybookStore, type PlaybookTab } from "../lib/playbook-store.js";
import { DashboardTab, handleDashboardInput, dashboardEffectiveToolId } from "./DashboardTab.js";
import { SettingsTab, handleSettingsInput } from "./SettingsTab.js";
import { DriftDiffView, handleDiffInput } from "./DriftDiffView.js";
import { ItemActionMenu, handleActionMenuInput, actionsForItem, type ItemContext, type ItemActionId } from "./ItemActionMenu.js";
import { PlaybookTab as PlaybookBrowseTab } from "./PlaybookTab.js";
import { SourcesTab } from "./SourcesTab.js";

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
  const [diffOp, setDiffOp] = useState<import("../lib/playbook/index.js").DiffOp | null>(null);
  const [diffScroll, setDiffScroll] = useState(0);
  const [pullbackState, setPullbackState] = useState<import("./DriftDiffView.js").PullbackState>(null);
  const [actionCtx, setActionCtx] = useState<ItemContext | null>(null);
  const closeDiff = () => { setDiffOp(null); setDiffScroll(0); setPullbackState(null); };
  const closeActionMenu = () => setActionCtx(null);
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
    // Action menu open — route input to it
    if (actionCtx) {
      const actions = actionsForItem(actionCtx);
      handleActionMenuInput(input, key, actions, (id) => {
        handleItemAction(id, actionCtx, setDiffOp, closeActionMenu);
      }, closeActionMenu);
      return;
    }

    // Diff view open — route all input through handleDiffInput
    if (diffOp) {
      const selectedTool = dashboardEffectiveToolId(usePlaybookStore);
      handleDiffInput(
        key, input, closeDiff, diffOp, pullbackState,
        () => { void usePlaybookStore.getState().applyTool(selectedTool); },
        () => {
          setPullbackState("running");
          usePlaybookStore.getState().pullbackArtifact(diffOp)
            .then(() => setPullbackState({ ok: true, message: `${diffOp.name} pulled back → playbook` }))
            .catch((e: unknown) => setPullbackState({ ok: false, message: e instanceof Error ? e.message : String(e) }));
        },
      );
      return;
    }

    // Quit
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    // Reload — refresh preview for currently highlighted tool
    if (input === "r") {
      // Use the same tool resolution as handleDashboardInput
      if (activeTab === "dashboard") {
        void usePlaybookStore.getState().refreshPreviewForTool(
          dashboardEffectiveToolId(usePlaybookStore),
        );
      } else {
        void reloadPlaybook();
      }
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
      handleDashboardInput(input, key, store, setDiffOp, setActionCtx);
    }
    if (activeTab === "settings") {
      handleSettingsInput(input, key);
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Action menu overlay */}
      {actionCtx && (
        <Box flexDirection="column" paddingX={4} paddingY={2}>
          <ItemActionMenu ctx={actionCtx} />
        </Box>
      )}

      {/* Diff overlay — replaces tab content when active */}
      {!actionCtx && diffOp && (
        <DriftDiffView
          op={diffOp}
          scrollOffset={diffScroll}
          setScrollOffset={setDiffScroll}
          onBack={closeDiff}
          pullbackState={pullbackState}
        />
      )}

      {!actionCtx && !diffOp && (
        <>
      {/* Tab bar */}
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />

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
          {activeTab === "settings"
            ? "↑↓ select  i install  u update  x uninstall  ←→ tabs  q quit"
            : "1-4/←→ tabs  r reload  q quit"}
        </Text>
      </Box>
        </>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

function handleItemAction(
  id: ItemActionId,
  ctx: ItemContext,
  setDiffOp: (op: import("../lib/playbook/index.js").DiffOp | null) => void,
  close: () => void,
) {
  const store = usePlaybookStore.getState();

  switch (id) {
    case "view-diff":
      if (ctx.op?.sourcePath && ctx.op.targetPath) {
        setDiffOp(ctx.op);
      }
      close();
      return;

    case "apply":
      // Per-op apply isn't precise yet — falls back to tool-wide apply.
      // TODO: wire applySingleOp(ctx.op) for true per-item application.
      void store.applyTool(ctx.toolId);
      close();
      return;

    case "pullback":
      if (ctx.op) void store.pullbackArtifact(ctx.op);
      close();
      return;

    case "track":
    case "untrack":
    case "uninstall":
    case "disable":
      store.addNotification({
        level: "warning",
        message: `'${id}' for ${ctx.displayName} — not yet implemented (TODO)`,
      });
      close();
      return;

    case "skip":
      close();
      return;
  }
}

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
