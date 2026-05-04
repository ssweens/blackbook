/**
 * Dashboard tab — per-tool detection status + drift summary + apply.
 *
 * Layout:
 *   Left panel (1/3): tool list with install/drift indicators
 *   Right panel (2/3): selected tool detail — instances, drift ops, actions
 *
 * Keybinds:
 *   ↑↓        navigate tool list
 *   a         apply selected tool (skips removals unless confirmed)
 *   y         confirm pending removals and apply
 *   Escape    cancel confirmation
 *   r         reload playbook + refresh preview (global, handled in PlaybookApp)
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import type { ToolId } from "../lib/playbook/index.js";
import { usePlaybookStore, type ToolStatus } from "../lib/playbook-store.js";
import type { EngineSyncResult } from "../lib/sync/index.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];

export function DashboardTab({ isFocused }: { isFocused: boolean }) {
  const {
    toolStatuses,
    detectionLoading,
    enginePreview,
    enginePreviewLoading,
    selectedToolId,
    playbook,
    playbookLoading,
    playbookError,
    applyState,
    setSelectedToolId,
    applyTool,
    cancelApply,
  } = usePlaybookStore();

  const tools = ALL_TOOLS.filter(
    (t) =>
      toolStatuses[t] !== undefined ||
      playbook?.manifest.tools_enabled.includes(t),
  );
  const activeTools = tools.length > 0 ? tools : ALL_TOOLS;

  const selectedIdx = selectedToolId
    ? activeTools.indexOf(selectedToolId)
    : 0;
  const effectiveIdx = Math.max(
    0,
    Math.min(selectedIdx, activeTools.length - 1),
  );
  const effectiveToolId = activeTools[effectiveIdx] ?? null;

  useInput((_input, key) => {
    if (!isFocused) return;

    // Confirmation overlay active — only y / Escape handled
    if (applyState?.phase === "confirming") {
      if (_input === "y" || _input === "Y") {
        void applyTool(applyState.toolId, true);
      }
      if (key.escape || _input === "n" || _input === "N") {
        cancelApply();
      }
      return;
    }

    if (key.upArrow) {
      const next = Math.max(0, effectiveIdx - 1);
      setSelectedToolId(activeTools[next] ?? null);
    }
    if (key.downArrow) {
      const next = Math.min(activeTools.length - 1, effectiveIdx + 1);
      setSelectedToolId(activeTools[next] ?? null);
    }
    if (_input === "a" && effectiveToolId && applyState === null) {
      void applyTool(effectiveToolId);
    }
  });

  if (!playbook) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {playbookLoading ? (
          <Text dimColor>Loading playbook…</Text>
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
      {/* Confirmation overlay */}
      {applyState?.phase === "confirming" && (
        <ConfirmRemovalsBar
          toolId={applyState.toolId}
          count={applyState.pendingRemovals}
        />
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Tool list */}
        <Box
          flexDirection="column"
          width={28}
          borderStyle="single"
          borderRight
          paddingX={1}
        >
          <Text bold dimColor>
            Tools
          </Text>
          {activeTools.map((toolId, i) => {
            const status = toolStatuses[toolId];
            const isSelected = i === effectiveIdx && isFocused;
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

function ConfirmRemovalsBar({
  toolId,
  count,
}: {
  toolId: ToolId;
  count: number;
}) {
  return (
    <Box
      paddingX={2}
      paddingY={0}
      borderStyle="single"
      borderColor="yellow"
    >
      <Text color="yellow">
        ⚠ {count} file{count !== 1 ? "s" : ""} will be removed from{" "}
        <Text bold>{toolId}</Text>.{"  "}
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
  toolId,
  status,
  enabled,
  isSelected,
  applying,
}: {
  toolId: ToolId;
  status: ToolStatus | undefined;
  enabled: boolean;
  isSelected: boolean;
  applying: boolean;
}) {
  const installed = status?.detection.installed;
  const installGlyph =
    installed === undefined ? "?" : installed ? "✓" : "·";
  const installColor =
    installed === undefined ? "gray" : installed ? "green" : "gray";

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
  toolId,
  status,
  enginePreview,
  previewLoading,
  applying,
}: {
  toolId: ToolId;
  status: ToolStatus | undefined;
  enginePreview: EngineSyncResult | null;
  previewLoading: boolean;
  applying: boolean;
}) {
  const det = status?.detection;
  const playbook = usePlaybookStore((s) => s.playbook);
  const toolConfig = playbook?.tools[toolId];

  const instanceResults =
    enginePreview?.perInstance.filter((p) => p.toolId === toolId) ?? [];

  const totalAdds = instanceResults.flatMap((r) =>
    r.diff.ops.filter((o) => o.kind === "add"),
  ).length;
  const totalUpdates = instanceResults.flatMap((r) =>
    r.diff.ops.filter((o) => o.kind === "update"),
  ).length;
  const totalRemoves = instanceResults.flatMap((r) =>
    r.diff.ops.filter((o) => o.kind === "remove"),
  ).length;
  const clean = totalAdds === 0 && totalUpdates === 0 && totalRemoves === 0;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Header */}
      <Box gap={1}>
        <Text bold>{toolId}</Text>
        {det?.version && (
          <Text dimColor>{det.version.split("\n")[0]}</Text>
        )}
        {applying && <Text color="cyan">  applying…</Text>}
      </Box>
      <Text dimColor>
        {det?.installed
          ? `✓ installed  →  ${det.configDir ?? "~"}`
          : "· not detected on PATH"}
      </Text>

      {/* Instances */}
      {toolConfig && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Instances
          </Text>
          {toolConfig.config.instances.map((inst) => (
            <Text key={inst.id}>
              {"  "}
              {inst.enabled ? "✓" : "·"} {inst.name}{" "}
              <Text dimColor>({inst.config_dir})</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Drift */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>
          {previewLoading ? "computing…" : "Drift"}
        </Text>
        {!previewLoading && instanceResults.length === 0 && (
          <Text dimColor>  not in playbook or no instances</Text>
        )}
        {!previewLoading && instanceResults.length > 0 && clean && (
          <Text color="green">  ✓ in sync</Text>
        )}
        {instanceResults.map((r) => {
          const adds = r.diff.ops.filter((o) => o.kind === "add");
          const updates = r.diff.ops.filter((o) => o.kind === "update");
          const removes = r.diff.ops.filter((o) => o.kind === "remove");
          if (adds.length === 0 && updates.length === 0 && removes.length === 0)
            return null;
          return (
            <Box key={r.instanceId} flexDirection="column">
              <Text>
                {"  "}
                <Text dimColor>[{r.instanceId}]</Text>
                {adds.length > 0 && (
                  <Text color="green">  +{adds.length} add</Text>
                )}
                {updates.length > 0 && (
                  <Text color="yellow">  ~{updates.length} update</Text>
                )}
                {removes.length > 0 && (
                  <Text color="red">  -{removes.length} remove</Text>
                )}
              </Text>
              {/* List each pending op (up to 8, then summarise) */}
              {[...adds, ...updates, ...removes]
                .slice(0, 8)
                .map((op, i) => (
                  <Text key={i} dimColor>
                    {"    "}
                    {op.kind === "add"
                      ? "+"
                      : op.kind === "remove"
                      ? "-"
                      : "~"}{" "}
                    {op.artifactType}/{op.name}
                  </Text>
                ))}
              {adds.length + updates.length + removes.length > 8 && (
                <Text dimColor>
                  {"    "}…and{" "}
                  {adds.length + updates.length + removes.length - 8} more
                </Text>
              )}
              {/* Bundle ops */}
              {r.bundleOps
                .filter((b) => b.op !== "skip")
                .map((b, i) => (
                  <Text key={i} dimColor>
                    {"    "}
                    {b.op === "install" ? "+" : "-"} bundle:{b.name}
                  </Text>
                ))}
            </Box>
          );
        })}
      </Box>

      {/* Env check warning */}
      {enginePreview && !enginePreview.envCheck.ok && (
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ unset env: {enginePreview.envCheck.missing.join(", ")}
          </Text>
        </Box>
      )}

      {/* Keybinds */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select{" "}
          {!clean && !applying && (
            <>
              ·{" "}
              <Text bold dimColor>
                a
              </Text>{" "}
              apply
              {totalRemoves > 0 && (
                <Text color="yellow"> (will confirm {totalRemoves} removal{totalRemoves !== 1 ? "s" : ""})</Text>
              )}
            </>
          )}
          {clean && !applying && <Text color="green">  ✓ nothing to do</Text>}
        </Text>
      </Box>
    </Box>
  );
}
