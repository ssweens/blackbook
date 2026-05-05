/**
 * ItemActionMenu — modal that opens when Enter is pressed on an inventory item.
 *
 * Shows the item's current state, then a list of state-aware options the user
 * can choose. Each option mutates the desired state of that item:
 *   - Track in playbook (copy disk → playbook + commit)
 *   - Untrack from playbook (remove from playbook + commit)
 *   - Apply playbook → disk (overwrite disk with playbook content)
 *   - Pull disk → playbook (overwrite playbook + commit)
 *   - Uninstall (remove from disk via tool's native lifecycle)
 *   - Disable in playbook (mark enabled: false)
 *   - View diff (modified items only)
 *   - Skip / leave as-is
 *
 * Keys: number 1-9 to pick, Esc to cancel.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import type { DiffOp, ToolId } from "../lib/playbook/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ItemState = "modified" | "missing" | "extra" | "untracked" | "synced";

export type ItemContext = {
  state: ItemState;
  toolId: ToolId;
  /** Either an artifact op or a bundle name */
  op?: DiffOp;
  bundleName?: string;
  /** Display name for the modal title */
  displayName: string;
  /** Type label: "skill", "AGENTS.md", "plugin", "package", etc. */
  typeLabel: string;
};

export type ItemActionId =
  | "view-diff"
  | "apply"
  | "pullback"
  | "track"
  | "untrack"
  | "uninstall"
  | "disable"
  | "skip";

export type ItemAction = {
  id: ItemActionId;
  key: string;            // single-char shortcut
  label: string;          // short label
  description: string;    // longer one-line explanation of consequence
  destructive?: boolean;  // changes UI styling
};

// ─────────────────────────────────────────────────────────────────────────────
// Action menus per state
// ─────────────────────────────────────────────────────────────────────────────

export function actionsForItem(ctx: ItemContext): ItemAction[] {
  const isBundle = !!ctx.bundleName;

  switch (ctx.state) {
    case "modified":
      // Both sides exist, content differs
      return [
        { id: "view-diff", key: "v", label: "View diff", description: "See what differs between playbook and disk" },
        { id: "apply",     key: "a", label: "Apply playbook → disk", description: "Overwrite disk with playbook content" },
        { id: "pullback",  key: "p", label: "Pull disk → playbook", description: "Overwrite playbook with disk content (commits + pushes)", destructive: true },
        { id: "skip",      key: "s", label: "Skip", description: "Leave as-is" },
      ];

    case "missing":
      // In playbook, not on disk
      return [
        { id: "apply",   key: "a", label: "Install on disk", description: isBundle ? `Install ${ctx.typeLabel} via tool's native install` : "Copy from playbook to disk" },
        { id: "untrack", key: "u", label: "Remove from playbook", description: "Don't want it anywhere — delete from playbook (commits + pushes)", destructive: true },
        { id: "skip",    key: "s", label: "Skip", description: "Leave as-is" },
      ];

    case "extra":
      // On disk, not in playbook (or declared but disabled)
      return [
        { id: "track",     key: "t", label: "Track in playbook", description: isBundle ? `Add ${ctx.typeLabel} to playbook (commits + pushes)` : "Copy disk → playbook (commits + pushes)" },
        { id: "uninstall", key: "x", label: "Delete from disk", description: isBundle ? `Uninstall via tool's native lifecycle` : "Remove file from this machine", destructive: true },
        { id: "skip",      key: "s", label: "Skip", description: "Leave as-is" },
      ];

    case "untracked":
      // Bundle installed but not declared (only bundles reach this state)
      return [
        { id: "track",     key: "t", label: "Track in playbook", description: `Add ${ctx.typeLabel} to playbook (commits + pushes)` },
        { id: "disable",   key: "d", label: "Track but disabled", description: `Add to playbook with enabled: false (commits + pushes)` },
        { id: "uninstall", key: "x", label: "Uninstall", description: `Remove from this machine`, destructive: true },
        { id: "skip",      key: "s", label: "Skip", description: "Leave as-is" },
      ];

    case "synced":
      // Both sides match — limited utility
      return [
        ...(ctx.op?.kind === "no-op" && ctx.op.sourcePath && ctx.op.targetPath
          ? [{ id: "view-diff" as const, key: "v", label: "View diff", description: "Should be empty (in sync)" }]
          : []),
        { id: "untrack",   key: "u", label: "Remove from playbook", description: "Stop tracking — delete from playbook (commits + pushes)", destructive: true },
        { id: "uninstall", key: "x", label: "Uninstall", description: isBundle ? `Remove from this machine via tool's lifecycle` : `Remove from this machine`, destructive: true },
        { id: "skip",      key: "s", label: "Skip", description: "Leave as-is" },
      ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input handler — called from PlaybookApp's single useInput
// ─────────────────────────────────────────────────────────────────────────────

export function handleActionMenuInput(
  input: string,
  key: Key,
  actions: ItemAction[],
  onPick: (id: ItemActionId) => void,
  onCancel: () => void,
): void {
  if (key.escape) { onCancel(); return; }
  const match = actions.find((a) => a.key === input.toLowerCase());
  if (match) onPick(match.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  ctx: ItemContext;
}

export function ItemActionMenu({ ctx }: Props) {
  const actions = actionsForItem(ctx);
  const stateColor = stateColorFor(ctx.state);
  const stateLabel = stateLabelFor(ctx.state);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      {/* Title */}
      <Box>
        <Text bold>{ctx.displayName}</Text>
        <Text dimColor>  ({ctx.typeLabel} · {ctx.toolId})</Text>
      </Box>

      {/* Current state */}
      <Box marginTop={1}>
        <Text dimColor>Current state: </Text>
        <Text color={stateColor} bold>{stateLabel}</Text>
      </Box>

      {/* Question */}
      <Box marginTop={1}>
        <Text>What should this be?</Text>
      </Box>

      {/* Options */}
      <Box flexDirection="column" marginTop={1}>
        {actions.map((a) => (
          <Box key={a.id}>
            <Text bold color={a.destructive ? "red" : "cyan"}>[{a.key}]</Text>
            <Text bold> {a.label}</Text>
            <Text dimColor>  — {a.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Esc to cancel</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function stateColorFor(state: ItemState): string {
  return state === "modified" ? "yellow"
    : state === "missing"     ? "green"
    : state === "extra"       ? "red"
    : state === "untracked"   ? "yellow"
    : "gray";
}

function stateLabelFor(state: ItemState): string {
  return state === "modified" ? "Modified — playbook differs from disk"
    : state === "missing"     ? "Missing on disk — declared in playbook"
    : state === "extra"       ? "Extra on disk — not in playbook"
    : state === "untracked"   ? "Installed — not declared in playbook"
    : "In sync — playbook and disk match";
}
