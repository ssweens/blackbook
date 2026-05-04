/**
 * Dashboard tab — per-tool detection status + drift + apply.
 *
 * Two focus modes:
 *   Tool mode (default): ↑↓ moves between tools, Enter focuses detail
 *   Detail mode:         ↑↓ scrolls drift items, Esc returns to tool mode
 *
 * Other keys:
 *   a   apply selected tool
 *   y   confirm removals
 *   n/Esc  cancel confirmation / exit detail mode
 *   r   refresh preview for selected tool (handled in PlaybookApp)
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import type { DiffOp, ToolId } from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore, type ToolStatus } from "../lib/playbook-store.js";
import type { EngineSyncResult, PerInstanceResult } from "../lib/sync/index.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];
const DETAIL_PAGE_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// State shared between component and input handler (via store + local ref)
// ─────────────────────────────────────────────────────────────────────────────

// Local UI state lives here so the input handler can read/write it.
// We use a module-level object so handleDashboardInput can mutate it
// and the component re-renders via its own useState setter.
type DashboardLocalState = {
  detailFocused: boolean;
  driftScrollIdx: number;
  setDetailFocused: (v: boolean) => void;
  setDriftScrollIdx: (v: number) => void;
  driftOps: DiffOp[];
};

let _localState: DashboardLocalState | null = null;

export function DashboardTab({ isFocused: _isFocused }: { isFocused: boolean }) {
  const toolStatuses = usePlaybookStore((s) => s.toolStatuses);
  const detectionLoading = usePlaybookStore((s) => s.detectionLoading);
  const enginePreview = usePlaybookStore((s) => s.enginePreview);
  const enginePreviewLoading = usePlaybookStore((s) => s.enginePreviewLoading);
  const selectedToolId = usePlaybookStore((s) => s.selectedToolId);
  const playbook = usePlaybookStore((s) => s.playbook);
  const playbookLoading = usePlaybookStore((s) => s.playbookLoading);
  const playbookError = usePlaybookStore((s) => s.playbookError);
  const applyState = usePlaybookStore((s) => s.applyState);

  const tools = ALL_TOOLS.filter(
    (t) => toolStatuses[t] !== undefined || playbook?.manifest.tools_enabled.includes(t),
  );
  const activeTools = tools.length > 0 ? tools : ALL_TOOLS;
  const selectedIdx = selectedToolId ? activeTools.indexOf(selectedToolId) : 0;
  const effectiveIdx = Math.max(0, Math.min(selectedIdx, activeTools.length - 1));
  const effectiveToolId = activeTools[effectiveIdx] ?? null;

  const [detailFocused, setDetailFocused] = useState(false);
  const [driftScrollIdx, setDriftScrollIdx] = useState(0);

  // Compute drift ops for selected tool (all instances, flat)
  const instanceResults =
    enginePreview?.perInstance.filter((p) => p.toolId === effectiveToolId) ?? [];
  const driftOps = instanceResults.flatMap((r) =>
    r.diff.ops.filter((o) => o.kind !== "no-op"),
  );

  // Expose local state to handleDashboardInput
  _localState = {
    detailFocused,
    driftScrollIdx,
    setDetailFocused,
    setDriftScrollIdx,
    driftOps,
  };

  if (!playbook) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {playbookLoading ? (
          <Text dimColor>Loading…</Text>
        ) : playbookError ? (
          <>
            <Text color="red">✗ {playbookError}</Text>
            <Text dimColor>Check the path in ~/.config/blackbook/config.yaml</Text>
          </>
        ) : (
          <>
            <Text color="yellow">No playbook loaded.</Text>
            <Text dimColor>Point blackbook at one: blackbook --playbook=/path/to/playbook</Text>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {applyState?.phase === "confirming" && (
        <ConfirmRemovalsBar toolId={applyState.toolId} count={applyState.pendingRemovals} />
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Tool list */}
        <Box flexDirection="column" width={28} borderStyle="single" borderRight paddingX={1}>
          <Text bold dimColor>Tools</Text>
          {activeTools.map((toolId, i) => {
            const status = toolStatuses[toolId];
            const isSelected = i === effectiveIdx && !detailFocused;
            const enabled = playbook.manifest.tools_enabled.includes(toolId);
            const applying = applyState?.toolId === toolId;
            return (
              <ToolListItem
                key={toolId}
                toolId={toolId}
                status={status}
                enabled={enabled}
                isSelected={isSelected}
                applying={applying}
              />
            );
          })}
          {detectionLoading && <Text dimColor>detecting…</Text>}
        </Box>

        {/* Tool detail */}
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          {effectiveToolId && (
            <ToolDetail
              toolId={effectiveToolId}
              status={toolStatuses[effectiveToolId]}
              enginePreview={enginePreview}
              previewLoading={enginePreviewLoading}
              applying={applyState?.toolId === effectiveToolId && applyState.phase === "running"}
              detailFocused={detailFocused}
              driftScrollIdx={driftScrollIdx}
              driftOps={driftOps}
              instanceResults={instanceResults}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation bar
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmRemovalsBar({ toolId, count }: { toolId: ToolId; count: number }) {
  return (
    <Box paddingX={2} borderStyle="single" borderColor="yellow">
      <Text color="yellow">
        ⚠ {count} file{count !== 1 ? "s" : ""} will be removed from <Text bold>{toolId}</Text>.{"  "}
        <Text bold>y</Text> confirm{"  "}
        <Text bold>n / Esc</Text> cancel
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool list item
// ─────────────────────────────────────────────────────────────────────────────

function ToolListItem({
  toolId, status, enabled, isSelected, applying,
}: {
  toolId: ToolId; status: ToolStatus | undefined; enabled: boolean;
  isSelected: boolean; applying: boolean;
}) {
  const installed = status?.detection.installed;
  const installGlyph = installed === undefined ? "?" : installed ? "✓" : "·";
  const installColor = installed === undefined ? "gray" : installed ? "green" : "gray";
  const bg = isSelected ? "blue" : undefined;
  const fg = isSelected ? "white" : enabled ? "white" : "gray";

  return (
    <Box>
      <Text backgroundColor={bg} color={fg}>
        {isSelected ? "▶ " : "  "}
        <Text color={installColor}>{installGlyph}</Text>{" "}
        {toolId.padEnd(10)}
        {applying && <Text color="cyan"> ⟳</Text>}
        {!enabled && !applying && <Text dimColor> (off)</Text>}
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool detail panel
// ─────────────────────────────────────────────────────────────────────────────

function ToolDetail({
  toolId, status, enginePreview, previewLoading, applying,
  detailFocused, driftScrollIdx, driftOps, instanceResults,
}: {
  toolId: ToolId;
  status: ToolStatus | undefined;
  enginePreview: EngineSyncResult | null;
  previewLoading: boolean;
  applying: boolean;
  detailFocused: boolean;
  driftScrollIdx: number;
  driftOps: DiffOp[];
  instanceResults: PerInstanceResult[];
}) {
  const det = status?.detection;
  const playbook = usePlaybookStore((s) => s.playbook);
  const toolConfig = playbook?.tools[toolId];

  const totalAdds = driftOps.filter((o) => o.kind === "add").length;
  const totalUpdates = driftOps.filter((o) => o.kind === "update").length;
  const totalRemoves = driftOps.filter((o) => o.kind === "remove").length;
  const hasDrift = totalAdds > 0 || totalUpdates > 0 || totalRemoves > 0;

  // Visible window of drift ops
  const visibleOps = driftOps.slice(driftScrollIdx, driftScrollIdx + DETAIL_PAGE_SIZE);
  const canScrollUp = driftScrollIdx > 0;
  const canScrollDown = driftScrollIdx + DETAIL_PAGE_SIZE < driftOps.length;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Header */}
      <Box gap={1}>
        <Text bold>{toolId}</Text>
        {det?.version && <Text dimColor>{det.version.split("\n")[0]}</Text>}
        {applying && <Text color="cyan">  applying…</Text>}
      </Box>
      <Text dimColor>
        {det?.installed ? `✓ installed  →  ${det.configDir ?? "~"}` : "· not detected on PATH"}
      </Text>

      {/* Instances */}
      {toolConfig && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Instances</Text>
          {toolConfig.config.instances.map((inst) => (
            <Text key={inst.id}>
              {"  "}{inst.enabled ? "✓" : "·"} {inst.name}{" "}
              <Text dimColor>({inst.config_dir})</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Drift */}
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text bold dimColor>{previewLoading ? "computing…" : "Drift"}</Text>
          {detailFocused && hasDrift && (
            <Text dimColor>
              ({driftScrollIdx + 1}–{Math.min(driftScrollIdx + DETAIL_PAGE_SIZE, driftOps.length)}/{driftOps.length})
              ↑↓ scroll  {driftOps[driftScrollIdx]?.kind === "update" ? "Enter diff  " : ""}Esc exit
            </Text>
          )}
        </Box>

        {!previewLoading && !enginePreview && (
          <Text dimColor>  press r to load</Text>
        )}
        {!previewLoading && enginePreview && !toolConfig && (
          <Text dimColor>  not in playbook — add to tools_enabled in playbook.yaml</Text>
        )}
        {!previewLoading && enginePreview && toolConfig && !hasDrift && (() => {
          // Only show "in sync" if this tool was actually scanned in the current preview.
          // If r was pressed for a different tool, this tool was never checked.
          const wasChecked = enginePreview.perInstance.some((p) => p.toolId === toolId);
          return wasChecked
            ? <Text color="green">  ✓ in sync</Text>
            : <Text dimColor>  press r to load</Text>;
        })()}

        {/* Summary counts */}
        {!previewLoading && hasDrift && (
          <Box>
            <Text>  </Text>
            {totalAdds > 0 && <Text color="green">+{totalAdds} add  </Text>}
            {totalUpdates > 0 && <Text color="yellow">~{totalUpdates} update  </Text>}
            {totalRemoves > 0 && <Text color="red">-{totalRemoves} remove</Text>}
          </Box>
        )}

        {/* Drift items — paginated, focused when in detail mode */}
        {!previewLoading && hasDrift && (
          <Box flexDirection="column">
            {canScrollUp && <Text dimColor>    ↑ {driftScrollIdx} more above</Text>}
            {visibleOps.map((op, i) => {
              const isHighlighted = detailFocused && i === 0;
              return (
                <Text
                  key={`${op.artifactType}-${op.name}-${i}`}
                  color={
                    op.kind === "remove" ? "red"
                    : op.kind === "add" ? "green"
                    : "yellow"
                  }
                  dimColor={!isHighlighted}
                >
                  {"    "}
                  {op.kind === "add" ? "+" : op.kind === "remove" ? "-" : "~"}{" "}
                  {op.artifactType}/{op.name}
                </Text>
              );
            })}
            {canScrollDown && (
              <Text dimColor>    ↓ {driftOps.length - driftScrollIdx - DETAIL_PAGE_SIZE} more below</Text>
            )}
          </Box>
        )}

        {/* Bundle ops */}
        {instanceResults.flatMap((r) => r.bundleOps.filter((b) => b.op !== "skip")).map((b, i) => (
          <Text key={i} dimColor>
            {"    "}{b.op === "install" ? "+" : "-"} bundle:{b.name}
          </Text>
        ))}
      </Box>

      {/* Env check warning */}
      {enginePreview && !enginePreview.envCheck.ok && (
        <Box marginTop={1}>
          <Text color="yellow">⚠ unset env: {enginePreview.envCheck.missing.join(", ")}</Text>
        </Box>
      )}

      {/* Keybinds hint */}
      <Box marginTop={1}>
        {!detailFocused ? (
          <Text dimColor>
            ↑↓ select{hasDrift ? "  · Enter view drift" : ""}
            {hasDrift && !applying ? (
              <>
                {"  · "}
                <Text bold dimColor>a</Text> apply (playbook→disk)
                {totalRemoves > 0 && <Text color="yellow"> (confirm {totalRemoves} removal{totalRemoves !== 1 ? "s" : ""})</Text>}
              </>
            ) : null}
            {!hasDrift && enginePreview && <Text color="green">  ✓ nothing to do</Text>}
          </Text>
        ) : (
          <Text dimColor>↑↓ scroll  <Text bold dimColor>a</Text> apply playbook→disk  <Text bold dimColor>p</Text> pull disk→playbook  Esc back</Text>
        )}
      </Box>
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
  setDiffOp?: (op: import("../lib/playbook/index.js").DiffOp | null) => void,
) {
  const state = store.getState();
  const { applyState, playbook } = state;
  const local = _localState;
  if (!local) return;

  if (!playbook) return;

  const tools = ALL_TOOLS.filter(
    (t) => state.toolStatuses[t] !== undefined || playbook.manifest.tools_enabled.includes(t),
  );
  const activeTools = tools.length > 0 ? tools : ALL_TOOLS;
  const selectedIdx = state.selectedToolId ? activeTools.indexOf(state.selectedToolId) : 0;
  const effectiveIdx = Math.max(0, Math.min(selectedIdx, activeTools.length - 1));
  const effectiveToolId = activeTools[effectiveIdx] ?? null;

  // ── Confirmation overlay — only y/n/Esc ──────────────────────────────────
  if (applyState?.phase === "confirming") {
    if (input === "y" || input === "Y") {
      void state.applyTool(applyState.toolId, true);
    }
    if (key.escape || input === "n" || input === "N") {
      state.cancelApply();
    }
    return;
  }

  // ── Detail focused: scroll drift items ───────────────────────────────────
  if (local.detailFocused) {
    if (key.escape || input === "q") {
      local.setDetailFocused(false);
      local.setDriftScrollIdx(0);
      return;
    }
    if (key.downArrow) {
      const max = Math.max(0, local.driftOps.length - DETAIL_PAGE_SIZE);
      local.setDriftScrollIdx(Math.min(local.driftScrollIdx + 1, max));
      return;
    }
    if (key.upArrow) {
      local.setDriftScrollIdx(Math.max(0, local.driftScrollIdx - 1));
      return;
    }
    // p = pull back highlighted item (disk → playbook)
    if (input === "p") {
      const highlighted = local.driftOps[local.driftScrollIdx];
      if (highlighted?.kind === "update") {
        void state.pullbackArtifact(highlighted);
        local.setDetailFocused(false);
        local.setDriftScrollIdx(0);
      }
      return;
    }
    // Enter on an update op opens the diff view
    if (key.return && setDiffOp) {
      const highlighted = local.driftOps[local.driftScrollIdx];
      if (highlighted?.kind === "update" && highlighted.sourcePath && highlighted.targetPath) {
        setDiffOp(highlighted);  // PlaybookApp resets scroll via closeDiff/setDiffScroll
      }
      return;
    }
    if (input === "a" && effectiveToolId && applyState === null) {
      void state.applyTool(effectiveToolId);
    }
    return;
  }

  // ── Tool list navigation ──────────────────────────────────────────────────
  if (key.downArrow) {
    const next = Math.min(activeTools.length - 1, effectiveIdx + 1);
    state.setSelectedToolId(activeTools[next] ?? null);
    local.setDriftScrollIdx(0);
    return;
  }
  if (key.upArrow) {
    const next = Math.max(0, effectiveIdx - 1);
    state.setSelectedToolId(activeTools[next] ?? null);
    local.setDriftScrollIdx(0);
    return;
  }
  if (key.return && local.driftOps.length > 0) {
    local.setDetailFocused(true);
    return;
  }
  if (input === "a" && effectiveToolId && applyState === null) {
    void state.applyTool(effectiveToolId);
  }
}

export function dashboardEffectiveToolId(store: typeof usePlaybookStore): ToolId {
  const state = store.getState();
  const tools = ALL_TOOLS.filter(
    (t) => state.toolStatuses[t] !== undefined || state.playbook?.manifest.tools_enabled.includes(t),
  );
  const activeTools = tools.length > 0 ? tools : ALL_TOOLS;
  const selectedIdx = state.selectedToolId ? activeTools.indexOf(state.selectedToolId) : 0;
  const effectiveIdx = Math.max(0, Math.min(selectedIdx, activeTools.length - 1));
  return activeTools[effectiveIdx] ?? activeTools[0];
}
