/**
 * Dashboard tab — one row per tool INSTANCE, not per tool type.
 *
 * Layout:
 *   Left panel  : instance list (one row per enabled instance across all tools)
 *   Right panel : selected instance — detection, drift ops, bundle status
 *
 * Two focus modes:
 *   Tool mode   (default): ↑↓ moves between instances, Enter enters detail
 *   Detail mode           : ↑↓ scrolls drift items, Enter on ~ opens diff, Esc exits
 *
 * Keys:
 *   ↑↓      navigate instances / scroll drift
 *   Enter   enter detail (auto-fetches drift if not loaded)
 *   a       apply (playbook→disk) for selected instance
 *   p       pull back highlighted ~ item (disk→playbook)
 *   y/n     confirm/cancel removals
 *   Esc     exit detail / cancel
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import type { DiffOp, ToolId, ToolInstance } from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore, type ToolStatus } from "../lib/playbook-store.js";
import type { EngineSyncResult, PerInstanceResult } from "../lib/sync/index.js";
import { requireAdapter } from "../lib/adapters/index.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];
const DETAIL_PAGE_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Item model: one row per instance
// ─────────────────────────────────────────────────────────────────────────────

interface DashItem {
  toolId: ToolId;
  instanceId: string;
  instance: ToolInstance;
  /** Label shown in list: instance name (unique enough to distinguish) */
  label: string;
}

function buildItems(playbook: NonNullable<PlaybookStore["playbook"]>): DashItem[] {
  const items: DashItem[] = [];
  for (const toolId of ALL_TOOLS) {
    if (!playbook.manifest.tools_enabled.includes(toolId)) continue;
    const tc = playbook.tools[toolId];
    if (!tc) continue;
    const instances = tc.config.instances.filter((i) => i.enabled);
    for (const inst of instances) {
      items.push({
        toolId,
        instanceId: inst.id,
        instance: inst,
        label: inst.name,
      });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level local state (shared with input handler)
// ─────────────────────────────────────────────────────────────────────────────

type LocalState = {
  detailFocused: boolean;
  setDetailFocused: (v: boolean) => void;
  driftScrollIdx: number;
  setDriftScrollIdx: (v: number) => void;
  driftOps: DiffOp[];
  /** The actionable op at the current scroll position (skips headers), or null. */
  highlightedOp: DiffOp | null;
  /** Total inventory item count for scroll bounds. */
  inventoryLength: number;
  items: DashItem[];
  effectiveIdx: number;
};
let _local: LocalState | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardTab({ isFocused: _isFocused }: { isFocused: boolean }) {
  const toolStatuses     = usePlaybookStore((s) => s.toolStatuses);
  const detectionLoading = usePlaybookStore((s) => s.detectionLoading);
  const enginePreview    = usePlaybookStore((s) => s.enginePreview);
  const enginePreviewLoading = usePlaybookStore((s) => s.enginePreviewLoading);
  const selectedToolId   = usePlaybookStore((s) => s.selectedToolId);
  const selectedInstanceId = usePlaybookStore((s) => s.selectedInstanceId);
  const playbook         = usePlaybookStore((s) => s.playbook);
  const playbookLoading  = usePlaybookStore((s) => s.playbookLoading);
  const playbookError    = usePlaybookStore((s) => s.playbookError);
  const applyState       = usePlaybookStore((s) => s.applyState);

  const [detailFocused, setDetailFocused] = useState(false);
  const [driftScrollIdx, setDriftScrollIdx] = useState(0);

  if (!playbook) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {playbookLoading ? <Text dimColor>Loading…</Text>
         : playbookError ? <><Text color="red">✗ {playbookError}</Text><Text dimColor>Check ~/.config/blackbook/config.yaml</Text></>
         : <><Text color="yellow">No playbook loaded.</Text><Text dimColor>blackbook --playbook=/path/to/playbook</Text></>}
      </Box>
    );
  }

  const items = buildItems(playbook);

  // Resolve selected index from (toolId, instanceId)
  let selIdx = 0;
  if (selectedToolId && selectedInstanceId) {
    const found = items.findIndex(
      (it) => it.toolId === selectedToolId && it.instanceId === selectedInstanceId,
    );
    if (found >= 0) selIdx = found;
  }
  const effectiveIdx = Math.max(0, Math.min(selIdx, items.length - 1));
  const selected = items[effectiveIdx] ?? null;

  // Drift ops for selected instance
  const instanceResult = selected
    ? enginePreview?.perInstance.find(
        (p) => p.toolId === selected.toolId && p.instanceId === selected.instanceId,
      )
    : undefined;
  // All ops — no-ops show as ✓ (in sync)
  const allOps = instanceResult?.diff.ops ?? [];
  const driftOps = allOps.filter((o) => o.kind !== "no-op");

  // Preserve highlightedOp/inventoryLength from previous render — they're set
  // by InstanceDetail below. Setting fresh state here would race with input
  // events that fire between the parent render and the child render.
  _local = {
    detailFocused, setDetailFocused,
    driftScrollIdx, setDriftScrollIdx,
    driftOps, items, effectiveIdx,
    highlightedOp: _local?.highlightedOp ?? null,
    inventoryLength: _local?.inventoryLength ?? 0,
  };

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
        <Box flexDirection="column" width={28} borderStyle="single" borderRight paddingX={1}>
          <Text bold dimColor>Instances</Text>
          {items.map((item, i) => {
            const isSelected = i === effectiveIdx && !detailFocused;
            const status = toolStatuses[item.toolId];
            const installed = status?.detection.installed;
            const glyph = installed === undefined ? "?" : installed ? "✓" : "·";
            const glyphColor = installed ? "green" : "gray";
            const applying = applyState?.toolId === item.toolId;
            const bg = isSelected ? "blue" : undefined;
            const fg = isSelected ? "white" : undefined;
            return (
              <Text key={`${item.toolId}:${item.instanceId}`} backgroundColor={bg} color={fg}>
                {isSelected ? "▶ " : "  "}
                <Text color={glyphColor}>{glyph}</Text>{" "}
                {item.label.padEnd(18).slice(0, 18)}
                {applying ? <Text color="cyan"> ⟳</Text> : null}
              </Text>
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
              enginePreview={enginePreview}
              previewLoading={enginePreviewLoading}
              applying={applyState?.toolId === selected.toolId && applyState.phase === "running"}
              detailFocused={detailFocused}
              driftScrollIdx={driftScrollIdx}
              driftOps={driftOps}
              instanceResult={instanceResult}
              playbook={playbook}
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
  item, status, enginePreview, previewLoading, applying,
  detailFocused, driftScrollIdx, driftOps, instanceResult, playbook,
}: {
  item: DashItem;
  status: ToolStatus | undefined;
  enginePreview: EngineSyncResult | null;
  previewLoading: boolean;
  applying: boolean;
  detailFocused: boolean;
  driftScrollIdx: number;
  driftOps: DiffOp[];
  instanceResult: PerInstanceResult | undefined;
  playbook: NonNullable<PlaybookStore["playbook"]>;
}) {
  const det = status?.detection;
  const tc = playbook.tools[item.toolId];

  const allOps = instanceResult?.diff.ops ?? [];
  const adds    = driftOps.filter((o) => o.kind === "add").length;
  const updates = driftOps.filter((o) => o.kind === "update").length;
  const removes = driftOps.filter((o) => o.kind === "remove").length;
  const synced  = allOps.filter((o) => o.kind === "no-op").length;
  const hasDrift = adds > 0 || updates > 0 || removes > 0;

  const untrackedBundles = instanceResult?.untrackedBundles ?? [];

  // Group ops by state for an intuitive inventory display
  const opsByKind = {
    add:    allOps.filter((o) => o.kind === "add"),
    update: allOps.filter((o) => o.kind === "update"),
    remove: allOps.filter((o) => o.kind === "remove"),
    noOp:   allOps.filter((o) => o.kind === "no-op"),
  };

  type InvItem = { label: string; color: string; dim: boolean; isHeader?: boolean; op?: DiffOp };
  const inventoryItems: InvItem[] = [];

  if (opsByKind.update.length > 0) {
    inventoryItems.push({ label: `▸ Modified — different in playbook vs disk (Enter for diff, p to pull from disk):`, color: "yellow", dim: false, isHeader: true });
    for (const op of opsByKind.update) {
      inventoryItems.push({ label: `  ~ ${op.artifactType}/${op.name}`, color: "yellow", dim: false, op });
    }
  }
  if (opsByKind.add.length > 0) {
    inventoryItems.push({ label: `▸ Missing on disk — in playbook, would be installed:`, color: "green", dim: false, isHeader: true });
    for (const op of opsByKind.add) {
      inventoryItems.push({ label: `  + ${op.artifactType}/${op.name}`, color: "green", dim: false, op });
    }
  }
  if (opsByKind.remove.length > 0) {
    inventoryItems.push({ label: `▸ Extra on disk — not in playbook, apply would remove:`, color: "red", dim: false, isHeader: true });
    for (const op of opsByKind.remove) {
      inventoryItems.push({ label: `  − ${op.artifactType}/${op.name}`, color: "red", dim: false, op });
    }
  }
  if (untrackedBundles.length > 0) {
    inventoryItems.push({ label: `▸ Bundles installed but not declared in playbook:`, color: "yellow", dim: false, isHeader: true });
    for (const name of untrackedBundles) {
      inventoryItems.push({ label: `  ? bundle/${name}`, color: "yellow", dim: false });
    }
  }
  if (opsByKind.noOp.length > 0) {
    inventoryItems.push({ label: `▸ In sync — playbook and disk match (${opsByKind.noOp.length}):`, color: "gray", dim: true, isHeader: true });
    for (const op of opsByKind.noOp) {
      inventoryItems.push({ label: `  ✓ ${op.artifactType}/${op.name}`, color: "gray", dim: true, op });
    }
  }

  // Highlighted op = the op (if any) at driftScrollIdx — used for Enter/p actions
  const highlightedOp = inventoryItems[driftScrollIdx]?.op ?? null;

  // Update the input handler's view of the inventory
  if (_local) {
    _local.highlightedOp = highlightedOp;
    _local.inventoryLength = inventoryItems.length;
  }

  const visibleItems = inventoryItems.slice(driftScrollIdx, driftScrollIdx + DETAIL_PAGE_SIZE);
  const canScrollUp   = driftScrollIdx > 0;
  const canScrollDown = driftScrollIdx + DETAIL_PAGE_SIZE < inventoryItems.length;

  const wasChecked = enginePreview?.perInstance.some(
    (p) => p.toolId === item.toolId && p.instanceId === item.instanceId,
  );



  return (
    <Box flexDirection="column" gap={0}>
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
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text bold dimColor>{previewLoading ? "computing…" : "Inventory"}</Text>
          {detailFocused && inventoryItems.length > 0 && (
            <Text dimColor>
              ({driftScrollIdx + 1}/{inventoryItems.length})  ↑↓ scroll
              {highlightedOp?.kind === "update" ? "  Enter diff  p pull" : ""}
              {"  Esc back"}
            </Text>
          )}
        </Box>

        {!previewLoading && (!enginePreview || !wasChecked) && (
          <Text dimColor>  press Enter to load</Text>
        )}

        {wasChecked && !previewLoading && (
          <>
            {/* Summary line */}
            <Box>
              <Text dimColor>  </Text>
              {synced  > 0 && <Text dimColor>{synced} synced  </Text>}
              {updates > 0 && <Text color="yellow">{updates} modified  </Text>}
              {adds    > 0 && <Text color="green">{adds} missing on disk  </Text>}
              {removes > 0 && <Text color="red">{removes} not in playbook  </Text>}
              {untrackedBundles.length > 0 && <Text color="yellow">{untrackedBundles.length} untracked bundle{untrackedBundles.length !== 1 ? "s" : ""}</Text>}
              {!hasDrift && untrackedBundles.length === 0 && synced > 0 && <Text color="green">✓ fully in sync</Text>}
            </Box>

            {/* Full inventory list */}
            {inventoryItems.length > 0 && (
              <Box flexDirection="column">
                {canScrollUp && <Text dimColor>    ↑ {driftScrollIdx} more above</Text>}
                {visibleItems.map((item, i) => (
                  <Text key={i} color={item.color} dimColor={item.dim}>
                    {"    "}{item.label}
                  </Text>
                ))}
                {canScrollDown && (
                  <Text dimColor>    ↓ {inventoryItems.length - driftScrollIdx - DETAIL_PAGE_SIZE} more below</Text>
                )}
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Env check */}
      {enginePreview && !enginePreview.envCheck.ok && (
        <Box marginTop={1}>
          <Text color="yellow">⚠ unset env: {enginePreview.envCheck.missing.join(", ")}</Text>
        </Box>
      )}

      {/* Keybinds */}
      <Box marginTop={1}>
        {!detailFocused ? (
          <Text dimColor>
            ↑↓ select  · Enter view inventory
            {hasDrift && !applying ? (
              <Text>
                {" · "}<Text bold dimColor>a</Text> sync playbook → disk
                {removes > 0 && <Text color="yellow"> (will delete {removes})</Text>}
              </Text>
            ) : null}
          </Text>
        ) : (
          <Text dimColor>↑↓ scroll  <Text bold dimColor>a</Text> sync playbook→disk  <Text bold dimColor>p</Text> pull disk→playbook  Esc back</Text>
        )}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input handler (called from PlaybookApp's single useInput)
// ─────────────────────────────────────────────────────────────────────────────

export function handleDashboardInput(
  input: string,
  key: Key,
  store: typeof usePlaybookStore,
  setDiffOp?: (op: DiffOp | null) => void,
) {
  const state = store.getState();
  const { applyState, playbook, selectedToolId, selectedInstanceId } = state;
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

  // ── Detail mode ───────────────────────────────────────────────────────────
  if (local.detailFocused) {
    if (key.escape) {
      local.setDetailFocused(false);
      local.setDriftScrollIdx(0);
      return;
    }
    if (key.downArrow) {
      local.setDriftScrollIdx(Math.min(
        local.driftScrollIdx + 1,
        Math.max(0, local.inventoryLength - 1),
      ));
      return;
    }
    if (key.upArrow) {
      local.setDriftScrollIdx(Math.max(0, local.driftScrollIdx - 1));
      return;
    }
    if (key.return && setDiffOp) {
      const highlighted = local.highlightedOp;
      if (highlighted?.kind === "update" && highlighted.sourcePath && highlighted.targetPath) {
        setDiffOp(highlighted);
      }
      return;
    }
    if (input === "p") {
      const highlighted = local.highlightedOp;
      if (highlighted?.kind === "update") {
        void state.pullbackArtifact(highlighted);
        local.setDetailFocused(false);
        local.setDriftScrollIdx(0);
      }
      return;
    }
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
    local.setDriftScrollIdx(0);
    return;
  }
  if (key.upArrow) {
    const next = Math.max(0, effectiveIdx - 1);
    const nextItem = items[next];
    if (nextItem) state.setSelectedInstance(nextItem.toolId, nextItem.instanceId);
    local.setDriftScrollIdx(0);
    return;
  }
  if (key.return) {
    local.setDetailFocused(true);
    if (selected) {
      const preview = state.enginePreview;
      const alreadyLoaded = preview?.perInstance.some(
        (p) => p.toolId === selected.toolId && p.instanceId === selected.instanceId,
      );
      if (!alreadyLoaded) {
        void state.refreshPreviewForTool(selected.toolId);
      }
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
  const playbook = state.playbook;
  if (!playbook) return "claude";
  const items = buildItems(playbook);
  const selIdx = items.findIndex(
    (it) => it.toolId === state.selectedToolId && it.instanceId === state.selectedInstanceId,
  );
  const effectiveIdx = Math.max(0, Math.min(selIdx >= 0 ? selIdx : 0, items.length - 1));
  return items[effectiveIdx]?.toolId ?? "claude";
}

// ─────────────────────────────────────────────────────────────────────────────
// Glyph/color helpers
// ─────────────────────────────────────────────────────────────────────────────

function opGlyph(kind: string): string {
  return kind === "add" ? "+" : kind === "remove" ? "-" : kind === "update" ? "~" : "✓";
}

function opColor(kind: string): string {
  return kind === "add" ? "green" : kind === "remove" ? "red" : kind === "update" ? "yellow" : "gray";
}
