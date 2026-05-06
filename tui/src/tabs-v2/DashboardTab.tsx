/**
 * Dashboard tab — one row per tool INSTANCE.
 *
 * Two modes:
 *   List mode   (default): ↑↓ moves between instances, Enter enters detail
 *   Detail mode           : ↑↓ navigates inventory rows, Enter opens action menu, Esc exits
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import type { DiffOp, ToolId, ToolInstance } from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore, type ToolStatus } from "../lib/playbook-store.js";
import type { EngineSyncResult, PerInstanceResult } from "../lib/sync/index.js";
import {
  InventoryView, InventorySummary,
  buildInventoryRows, nextRow, firstActionableRow,
  type InvRow,
} from "./InventoryView.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];

// ─────────────────────────────────────────────────────────────────────────────
// Item model
// ─────────────────────────────────────────────────────────────────────────────

interface DashItem {
  toolId: ToolId;
  instanceId: string;
  instance: ToolInstance;
  label: string;
}

function buildItems(playbook: NonNullable<PlaybookStore["playbook"]>): DashItem[] {
  const items: DashItem[] = [];
  for (const toolId of ALL_TOOLS) {
    if (!playbook.manifest.tools_enabled.includes(toolId)) continue;
    const tc = playbook.tools[toolId];
    if (!tc) continue;
    for (const inst of tc.config.instances.filter((i) => i.enabled)) {
      items.push({ toolId, instanceId: inst.id, instance: inst, label: inst.name });
    }
  }
  return items;
}

function bundleLabelFor(toolId: ToolId): string {
  return toolId === "claude" || toolId === "codex" ? "plugins" : "packages";
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level shared state (component + input handler)
// ─────────────────────────────────────────────────────────────────────────────

type LocalState = {
  detailFocused: boolean;
  setDetailFocused: (v: boolean) => void;
  scrollIdx: number;
  setScrollIdx: (v: number) => void;
  rows: InvRow[];
  items: DashItem[];
  effectiveIdx: number;
};
let _local: LocalState | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardTab({ isFocused: _isFocused }: { isFocused: boolean }) {
  const toolStatuses      = usePlaybookStore((s) => s.toolStatuses);
  const detectionLoading  = usePlaybookStore((s) => s.detectionLoading);
  const enginePreview     = usePlaybookStore((s) => s.enginePreview);
  const enginePreviewLoading = usePlaybookStore((s) => s.enginePreviewLoading);
  const selectedToolId    = usePlaybookStore((s) => s.selectedToolId);
  const selectedInstanceId = usePlaybookStore((s) => s.selectedInstanceId);
  const playbook          = usePlaybookStore((s) => s.playbook);
  const playbookLoading   = usePlaybookStore((s) => s.playbookLoading);
  const playbookError     = usePlaybookStore((s) => s.playbookError);
  const applyState        = usePlaybookStore((s) => s.applyState);

  const [detailFocused, setDetailFocused] = useState(false);
  const [scrollIdx, setScrollIdx]         = useState(0);

  if (!playbook) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {playbookLoading ? <Text dimColor>Loading…</Text>
         : playbookError ? <><Text color="red">✗ {playbookError}</Text><Text dimColor>Check ~/.config/blackbook/config.yaml</Text></>
         : <Text color="yellow">No playbook loaded.</Text>}
      </Box>
    );
  }

  const items = buildItems(playbook);

  let selIdx = 0;
  if (selectedToolId && selectedInstanceId) {
    const found = items.findIndex(
      (it) => it.toolId === selectedToolId && it.instanceId === selectedInstanceId,
    );
    if (found >= 0) selIdx = found;
  }
  const effectiveIdx = Math.max(0, Math.min(selIdx, items.length - 1));
  const selected = items[effectiveIdx] ?? null;

  // Build inventory rows for selected instance
  const instanceResult = selected
    ? enginePreview?.perInstance.find(
        (p) => p.toolId === selected.toolId && p.instanceId === selected.instanceId,
      )
    : undefined;
  const rows = selected
    ? buildInventoryRows(instanceResult, selected.toolId, bundleLabelFor(selected.toolId))
    : [];

  _local = {
    detailFocused, setDetailFocused,
    scrollIdx, setScrollIdx,
    rows,
    items,
    effectiveIdx,
    // Preserve from prior render to avoid stale reads in input handler
    ...((_local?.rows === rows) ? {} : {}),
  };
  // Patch inventory state from last render (avoids stale closure in input handler)
  if (_local) {
    Object.assign(_local, { rows, effectiveIdx, items });
  }

  const wasChecked = enginePreview?.perInstance.some(
    (p) => p.toolId === selected?.toolId && p.instanceId === selected?.instanceId,
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {applyState?.phase === "confirming" && (
        <Box paddingX={2} borderStyle="single" borderColor="yellow">
          <Text color="yellow">
            ⚠ {applyState.pendingRemovals} file{applyState.pendingRemovals !== 1 ? "s" : ""} will be removed from{" "}
            <Text bold>{applyState.toolId}</Text>.{"  "}
            <Text bold>y</Text> confirm{"  "}
            <Text bold>n / Esc</Text> cancel
          </Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Instance list */}
        <Box flexDirection="column" width={22} borderStyle="single" borderRight paddingX={1}>
          <Text bold dimColor>Instances</Text>
          {items.map((item, i) => {
            const isSelected = i === effectiveIdx && !detailFocused;
            const status = toolStatuses[item.toolId];
            const installed = status?.detection.installed;
            const glyph = installed === undefined ? "?" : installed ? "✓" : "·";
            const glyphColor = installed ? "green" : "gray";
            const applying = applyState?.toolId === item.toolId;
            const bg = isSelected ? "blue" as const : undefined;
            const fg = isSelected ? "white" as const : undefined;
            const label = item.label.slice(0, 14);
            // Box flexDirection="row" (default) renders children inline = exactly one line,
            // no blank-line artifacts, and each Text keeps its own color.
            return (
              <Box key={`${item.toolId}:${item.instanceId}`} {...(bg ? { backgroundColor: bg } : {})}>
                <Text color={fg}>{isSelected ? "▶ " : "  "}</Text>
                <Text color={glyphColor}>{glyph}</Text>
                <Text color={fg}>{" "}{label}</Text>
                {applying && <Text color="cyan"> ⟳</Text>}
              </Box>
            );
          })}
          {detectionLoading && <Text dimColor>detecting…</Text>}
        </Box>

        {/* Detail panel */}
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          {selected && (
            <InstanceDetail
              item={selected}
              status={toolStatuses[selected.toolId]}
              previewLoading={enginePreviewLoading}
              applying={applyState?.toolId === selected.toolId && applyState.phase === "running"}
              detailFocused={detailFocused}
              scrollIdx={scrollIdx}
              rows={rows}
              wasChecked={!!wasChecked}
              instanceResult={instanceResult}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance detail panel
// ─────────────────────────────────────────────────────────────────────────────

function InstanceDetail({
  item, status, previewLoading, applying,
  detailFocused, scrollIdx, rows, wasChecked, instanceResult,
}: {
  item: DashItem;
  status: ToolStatus | undefined;
  previewLoading: boolean;
  applying: boolean;
  detailFocused: boolean;
  scrollIdx: number;
  rows: InvRow[];
  wasChecked: boolean;
  instanceResult: PerInstanceResult | undefined;
}) {
  const det = status?.detection;

  return (
    <Box flexDirection="column" gap={0} flexGrow={1}>
      {/* Header */}
      <Box gap={1}>
        <Text bold>{item.label}</Text>
        <Text dimColor>({item.toolId})</Text>
        {det?.version && <Text dimColor>{det.version.split("\n")[0]}</Text>}
        {applying && <Text color="cyan">  applying…</Text>}
      </Box>
      <Text dimColor>
        {det?.installed
          ? `✓ ${item.instance.config_dir}`
          : "· not detected on PATH"}
      </Text>

      {/* Inventory */}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Box gap={1}>
          <Text bold dimColor>{previewLoading ? "computing…" : "Inventory"}</Text>
        </Box>

        {!wasChecked && !previewLoading && (
          <Text dimColor>  press Enter to load</Text>
        )}
        {wasChecked && !previewLoading && (
          <>
            <InventorySummary rows={rows} />
            {detailFocused && (
              <InventoryView
                rows={rows}
                scrollIdx={scrollIdx}
                detailFocused={detailFocused}
                configDir={item.instance.config_dir}
                playbookName="playbook"
              />
            )}
            {!detailFocused && rows.filter(r => !r.isHeader).length > 0 && (
              <Text dimColor>  ↑↓ select  · Enter view inventory</Text>
            )}
          </>
        )}
      </Box>

      {/* Keybinds (list mode) */}
      {!detailFocused && (
        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ select  · Enter view inventory
            {rows.some(r => !r.isHeader && r.glyph !== "✓") && !applying
              ? <Text>  · <Text bold dimColor>a</Text> sync playbook→disk</Text>
              : null}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input handler — called from PlaybookApp's single useInput
// ─────────────────────────────────────────────────────────────────────────────

export function handleDashboardInput(
  input: string,
  key: Key,
  store: typeof usePlaybookStore,
  setDiffOp?: (op: DiffOp | null) => void,
  openActionMenu?: (ctx: import("./ItemActionMenu.js").ItemContext) => void,
) {
  const state = store.getState();
  const { applyState, playbook } = state;
  const local = _local;
  if (!local || !playbook) return;

  const { items, effectiveIdx } = local;
  const selected = items[effectiveIdx] ?? null;

  // ── Confirmation overlay ──────────────────────────────────────────────────
  if (applyState?.phase === "confirming") {
    if (input === "y" || input === "Y") void state.applyTool(applyState.toolId, true);
    if (key.escape || input === "n" || input === "N") state.cancelApply();
    return;
  }

  // ── Detail mode (inventory navigation) ───────────────────────────────────
  if (local.detailFocused) {
    if (key.escape) {
      local.setDetailFocused(false);
      local.setScrollIdx(0);
      return;
    }
    if (key.downArrow) {
      local.setScrollIdx(nextRow(local.rows, local.scrollIdx, +1));
      return;
    }
    if (key.upArrow) {
      local.setScrollIdx(nextRow(local.rows, local.scrollIdx, -1));
      return;
    }
    if (key.pageDown) {
      let i = local.scrollIdx;
      for (let n = 0; n < 10; n++) {
        const next = nextRow(local.rows, i, +1);
        if (next === i) break;
        i = next;
      }
      local.setScrollIdx(i);
      return;
    }
    if (key.pageUp) {
      let i = local.scrollIdx;
      for (let n = 0; n < 10; n++) {
        const next = nextRow(local.rows, i, -1);
        if (next === i) break;
        i = next;
      }
      local.setScrollIdx(i);
      return;
    }

    // Enter → action menu for highlighted row
    if (key.return && openActionMenu) {
      const row = local.rows[local.scrollIdx];
      if (row && !row.isHeader && row.action) {
        openActionMenu(row.action);
      } else {
        // cursor on header — nudge to first actionable
        const first = firstActionableRow(local.rows);
        if (first >= 0) local.setScrollIdx(first);
      }
      return;
    }

    // 'a' = apply this tool
    if (input === "a" && selected && applyState === null) {
      void state.applyTool(selected.toolId);
    }
    return;
  }

  // ── Instance list navigation ──────────────────────────────────────────────
  if (key.downArrow) {
    const next = Math.min(items.length - 1, effectiveIdx + 1);
    const nextItem = items[next];
    if (nextItem) state.setSelectedInstance(nextItem.toolId, nextItem.instanceId);
    local.setScrollIdx(0);
    return;
  }
  if (key.upArrow) {
    const next = Math.max(0, effectiveIdx - 1);
    const nextItem = items[next];
    if (nextItem) state.setSelectedInstance(nextItem.toolId, nextItem.instanceId);
    local.setScrollIdx(0);
    return;
  }
  if (key.return) {
    local.setDetailFocused(true);
    // Position on first actionable row (skip header)
    const first = firstActionableRow(local.rows);
    if (first >= 0) local.setScrollIdx(first);
    // Auto-fetch if not yet loaded
    if (selected) {
      const preview = state.enginePreview;
      const loaded = preview?.perInstance.some(
        (p) => p.toolId === selected.toolId && p.instanceId === selected.instanceId,
      );
      if (!loaded) void state.refreshPreviewForTool(selected.toolId);
    }
    return;
  }
  if (input === "a" && selected && applyState === null) {
    void state.applyTool(selected.toolId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers exported for PlaybookApp
// ─────────────────────────────────────────────────────────────────────────────

export function dashboardEffectiveToolId(store: typeof usePlaybookStore): ToolId {
  const state = store.getState();
  if (!state.playbook) return "claude";
  const items = buildItems(state.playbook);
  const selIdx = items.findIndex(
    (it) => it.toolId === state.selectedToolId && it.instanceId === state.selectedInstanceId,
  );
  const effectiveIdx = Math.max(0, Math.min(selIdx >= 0 ? selIdx : 0, items.length - 1));
  return items[effectiveIdx]?.toolId ?? "claude";
}
