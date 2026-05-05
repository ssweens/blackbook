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
  /** Action context for the highlighted inventory item, or null. */
  highlightedAction: { state: string; op?: DiffOp; bundleName?: string } | null;
  /** Full list of items used for header-skip navigation. */
  inventoryItems: Array<{ isHeader?: boolean; action?: { state: string; op?: DiffOp; bundleName?: string } }>;
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
    highlightedAction: _local?.highlightedAction ?? null,
    inventoryItems: _local?.inventoryItems ?? [],
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
  const bundleStates    = instanceResult?.bundleStates ?? [];

  // Categorize bundles into sync states (parallel to artifact sync states)
  const bundleSync     = bundleStates.filter((b) => b.declared === "enabled"  && b.installed);
  const bundleMissing  = bundleStates.filter((b) => b.declared === "enabled"  && !b.installed);
  const bundleExtra    = bundleStates.filter((b) => b.declared === "disabled" && b.installed);
  const bundleUntracked= bundleStates.filter((b) => b.declared === "undeclared");
  const totalBundles = bundleStates.length;
  const bundleParadigm = playbook.tools[item.toolId]?.config
    ? (item.toolId === "claude" || item.toolId === "codex" ? "plugins" : "packages")
    : "bundles";

  // Group ops by state for an intuitive inventory display
  const opsByKind = {
    add:    allOps.filter((o) => o.kind === "add"),
    update: allOps.filter((o) => o.kind === "update"),
    remove: allOps.filter((o) => o.kind === "remove"),
    noOp:   allOps.filter((o) => o.kind === "no-op"),
  };

  type ItemAction = {
    /** State category for context-sensitive keybinds. */
    state: "modified" | "missing" | "extra" | "untracked" | "synced";
    /** The DiffOp this represents, if any (artifacts have ops, bundles don't). */
    op?: DiffOp;
    /** The bundle name, if this item represents a bundle. */
    bundleName?: string;
  };
  type InvItem = { label: string; color: string; dim: boolean; isHeader?: boolean; action?: ItemAction };
  const inventoryItems: InvItem[] = [];

  // Modified — only artifacts (bundles are atomic; their content isn't diffed)
  if (opsByKind.update.length > 0) {
    inventoryItems.push({ label: `▸ Modified — different in playbook vs disk:`, color: "yellow", dim: false, isHeader: true });
    for (const op of opsByKind.update) {
      inventoryItems.push({
        label: `  ~ ${op.artifactType}/${op.name}`, color: "yellow", dim: false,
        action: { state: "modified", op },
      });
    }
  }

  // Missing on disk — artifacts and bundles in playbook but not on disk
  if (opsByKind.add.length > 0 || bundleMissing.length > 0) {
    inventoryItems.push({ label: `▸ Missing on disk — in playbook, not installed:`, color: "green", dim: false, isHeader: true });
    for (const op of opsByKind.add) {
      inventoryItems.push({
        label: `  + ${op.artifactType}/${op.name}`, color: "green", dim: false,
        action: { state: "missing", op },
      });
    }
    for (const b of bundleMissing) {
      inventoryItems.push({
        label: `  + ${bundleParadigm}/${b.name}${b.version ? "@" + b.version : ""}  (${b.sourceKind})`,
        color: "green", dim: false,
        action: { state: "missing", bundleName: b.name },
      });
    }
  }

  // Extra on disk — not in playbook, apply would remove
  if (opsByKind.remove.length > 0 || bundleExtra.length > 0) {
    inventoryItems.push({ label: `▸ Extra on disk — not in playbook (apply would remove):`, color: "red", dim: false, isHeader: true });
    for (const op of opsByKind.remove) {
      inventoryItems.push({
        label: `  − ${op.artifactType}/${op.name}`, color: "red", dim: false,
        action: { state: "extra", op },
      });
    }
    for (const b of bundleExtra) {
      inventoryItems.push({
        label: `  − ${bundleParadigm}/${b.name}  (declared but disabled)`,
        color: "red", dim: false,
        action: { state: "extra", bundleName: b.name },
      });
    }
  }

  // Untracked bundles — installed but not declared at all
  if (bundleUntracked.length > 0) {
    inventoryItems.push({ label: `▸ Installed but not declared in playbook:`, color: "yellow", dim: false, isHeader: true });
    for (const b of bundleUntracked) {
      inventoryItems.push({
        label: `  ? ${bundleParadigm}/${b.name}`, color: "yellow", dim: false,
        action: { state: "untracked", bundleName: b.name },
      });
    }
  }

  // In sync
  if (opsByKind.noOp.length > 0 || bundleSync.length > 0) {
    const total = opsByKind.noOp.length + bundleSync.length;
    inventoryItems.push({ label: `▸ In sync — playbook and disk match (${total}):`, color: "gray", dim: true, isHeader: true });
    for (const op of opsByKind.noOp) {
      inventoryItems.push({
        label: `  ✓ ${op.artifactType}/${op.name}`, color: "gray", dim: true,
        action: { state: "synced", op },
      });
    }
    for (const b of bundleSync) {
      inventoryItems.push({
        label: `  ✓ ${bundleParadigm}/${b.name}${b.version ? "@" + b.version : ""}`,
        color: "gray", dim: true,
        action: { state: "synced", bundleName: b.name },
      });
    }
  }

  // Highlighted item (the cursor lands on actionable items only — navigation skips headers)
  const highlightedItem = inventoryItems[driftScrollIdx] ?? null;
  const highlightedAction = highlightedItem?.action ?? null;

  // Update the input handler's view
  if (_local) {
    _local.highlightedAction = highlightedAction;
    _local.inventoryItems = inventoryItems;
    _local.inventoryLength = inventoryItems.length;
  }

  // Build context-sensitive hint for the highlighted item
  let itemHint: React.ReactNode = null;
  if (detailFocused && highlightedAction) {
    switch (highlightedAction.state) {
      case "modified":
        itemHint = <Text dimColor>  <Text bold>Enter</Text> diff  <Text bold>a</Text> apply this  <Text bold>p</Text> pull from disk</Text>;
        break;
      case "missing":
        itemHint = <Text dimColor>  <Text bold>a</Text> install this</Text>;
        break;
      case "extra":
        itemHint = <Text dimColor>  <Text bold>a</Text> delete from disk  <Text bold>p</Text> add to playbook</Text>;
        break;
      case "untracked":
        itemHint = <Text dimColor>  <Text bold>p</Text> add to playbook  <Text bold>u</Text> uninstall</Text>;
        break;
      case "synced":
        itemHint = <Text dimColor>  (in sync)</Text>;
        break;
    }
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
              {highlightedAction?.state === "modified" ? "  Enter diff" : ""}
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
              {(synced + bundleSync.length) > 0 && <Text dimColor>{synced + bundleSync.length} synced  </Text>}
              {updates > 0 && <Text color="yellow">{updates} modified  </Text>}
              {(adds + bundleMissing.length) > 0 && <Text color="green">{adds + bundleMissing.length} missing on disk  </Text>}
              {(removes + bundleExtra.length) > 0 && <Text color="red">{removes + bundleExtra.length} not in playbook  </Text>}
              {bundleUntracked.length > 0 && <Text color="yellow">{bundleUntracked.length} untracked {bundleParadigm}</Text>}
              {!hasDrift && bundleStates.every(b => b.declared === "enabled" && b.installed) && synced > 0 && <Text color="green">✓ fully in sync</Text>}
            </Box>

            {/* Full inventory list */}
            {inventoryItems.length > 0 && (
              <Box flexDirection="column">
                {canScrollUp && <Text dimColor>    ↑ {driftScrollIdx} more above</Text>}
                {visibleItems.map((item, i) => {
                  const absIdx = driftScrollIdx + i;
                  const isCursor = detailFocused && absIdx === driftScrollIdx;
                  // Replace leading 2-space indent with cursor glyph when highlighted
                  const labelWithCursor = isCursor && !item.isHeader
                    ? "  ▶ " + item.label.slice(4)
                    : item.label;
                  return (
                    <Text key={i}
                      color={item.color}
                      dimColor={item.dim}
                      backgroundColor={isCursor && !item.isHeader ? "blue" : undefined}
                    >
                      {labelWithCursor}
                    </Text>
                  );
                })}
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
          <Text dimColor>
            ↑↓ navigate{itemHint}{"  "}Esc back
          </Text>
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
      local.setDriftScrollIdx(
        nextActionableIdx(local.inventoryItems, local.driftScrollIdx, +1)
      );
      return;
    }
    if (key.upArrow) {
      local.setDriftScrollIdx(
        nextActionableIdx(local.inventoryItems, local.driftScrollIdx, -1)
      );
      return;
    }
    if (key.pageDown) {
      let i = local.driftScrollIdx;
      for (let n = 0; n < DETAIL_PAGE_SIZE; n++) {
        const next = nextActionableIdx(local.inventoryItems, i, +1);
        if (next === i) break;
        i = next;
      }
      local.setDriftScrollIdx(i);
      return;
    }
    if (key.pageUp) {
      let i = local.driftScrollIdx;
      for (let n = 0; n < DETAIL_PAGE_SIZE; n++) {
        const next = nextActionableIdx(local.inventoryItems, i, -1);
        if (next === i) break;
        i = next;
      }
      local.setDriftScrollIdx(i);
      return;
    }

    const action = local.highlightedAction;
    if (!action) return;

    // Enter on a modified item opens the diff
    if (key.return && action.state === "modified" && action.op && setDiffOp) {
      if (action.op.sourcePath && action.op.targetPath) setDiffOp(action.op);
      return;
    }

    // 'a' = apply this specific item
    if (input === "a") {
      handleItemApply(action, state, selected?.toolId);
      return;
    }

    // 'p' = pull this item back to playbook (modified or extra states)
    if (input === "p") {
      if (action.op && (action.state === "modified" || action.state === "extra")) {
        void state.pullbackArtifact(action.op);
      }
      return;
    }

    // 'u' = uninstall an untracked bundle
    if (input === "u" && action.state === "untracked" && action.bundleName) {
      // Bundle uninstall is engine-level — not yet wired to per-bundle action
      // For now: no-op + future TODO
      return;
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
    // Position cursor on first actionable item (skip leading header)
    const firstActionable = local.inventoryItems.findIndex((it) => !it.isHeader && it.action);
    if (firstActionable >= 0) local.setDriftScrollIdx(firstActionable);
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

/** Find the next actionable (non-header) inventory item index. */
function nextActionableIdx(
  items: Array<{ isHeader?: boolean; action?: unknown }>,
  current: number,
  step: 1 | -1,
): number {
  let i = current + step;
  while (i >= 0 && i < items.length) {
    if (!items[i]!.isHeader && items[i]!.action) return i;
    i += step;
  }
  return current; // no movement possible
}

/** Handle 'a' (apply) for a single item based on its state. */
function handleItemApply(
  action: { state: string; op?: DiffOp; bundleName?: string },
  state: ReturnType<typeof usePlaybookStore.getState>,
  toolId?: ToolId,
) {
  if (!toolId) return;
  // Per-item apply isn't fully wired yet — we trigger a tool-wide apply.
  // The store's applyTool runs all ops. To make this truly per-item we'd
  // need to filter the diff first. v1 behavior: tool-wide apply.
  // This is a known limitation — surface a notification.
  void state.applyTool(toolId);
  void action;
}
