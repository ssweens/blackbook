/**
 * Dashboard tab — per-tool detection status + drift summary + quick actions.
 *
 * Layout:
 *   Left panel (1/3): tool list with install/drift indicators
 *   Right panel (2/3): selected tool detail — instances, drift ops, actions
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import type { ToolId } from "../lib/playbook/index.js";
import { usePlaybookStore, type ToolStatus } from "../lib/playbook-store.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard tab
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardTab({ isFocused }: { isFocused: boolean }) {
  const {
    toolStatuses,
    detectionLoading,
    enginePreview,
    enginePreviewLoading,
    selectedToolId,
    playbook,
    setSelectedToolId,
  } = usePlaybookStore();

  const tools = ALL_TOOLS.filter((t) => toolStatuses[t] !== undefined || playbook?.manifest.tools_enabled.includes(t));
  const activeTools = tools.length > 0 ? tools : ALL_TOOLS;

  const selectedIdx = selectedToolId
    ? activeTools.indexOf(selectedToolId)
    : 0;
  const effectiveIdx = Math.max(0, Math.min(selectedIdx, activeTools.length - 1));
  const effectiveToolId = activeTools[effectiveIdx] ?? null;

  useInput(
    (input, key) => {
      if (!isFocused) return;
      if (key.upArrow) {
        const next = Math.max(0, effectiveIdx - 1);
        setSelectedToolId(activeTools[next] ?? null);
      }
      if (key.downArrow) {
        const next = Math.min(activeTools.length - 1, effectiveIdx + 1);
        setSelectedToolId(activeTools[next] ?? null);
      }
    },
  );

  if (!playbook) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">No playbook loaded.</Text>
        <Text dimColor>Run `blackbook init` to create one, then restart.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      {/* Tool list */}
      <Box flexDirection="column" width={28} borderStyle="single" borderRight paddingX={1}>
        <Text bold dimColor>Tools</Text>
        {activeTools.map((toolId, i) => {
          const status = toolStatuses[toolId];
          const isSelected = i === effectiveIdx && isFocused;
          const enabled = playbook.manifest.tools_enabled.includes(toolId);
          return (
            <ToolListItem
              key={toolId}
              toolId={toolId}
              status={status}
              enabled={enabled}
              isSelected={isSelected}
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
          />
        )}
      </Box>
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
}: {
  toolId: ToolId;
  status: ToolStatus | undefined;
  enabled: boolean;
  isSelected: boolean;
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
        <Text color={installColor}>{installGlyph}</Text>
        {" "}
        {toolId.padEnd(10)}
        {enabled ? "" : <Text dimColor> (disabled)</Text>}
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
}: {
  toolId: ToolId;
  status: ToolStatus | undefined;
  enginePreview: import("../lib/sync/index.js").EngineSyncResult | null;
  previewLoading: boolean;
}) {
  const det = status?.detection;
  const playbook = usePlaybookStore((s) => s.playbook);
  const toolConfig = playbook?.tools[toolId];

  const instanceResults =
    enginePreview?.perInstance.filter((p) => p.toolId === toolId) ?? [];

  return (
    <Box flexDirection="column" gap={0}>
      {/* Header */}
      <Box>
        <Text bold>{toolId}</Text>
        {det?.version && <Text dimColor>  {det.version.split("\n")[0]}</Text>}
      </Box>
      <Text dimColor>
        {det?.installed ? `✓ installed at ${det.configDir ?? "~"}` : "· not detected on PATH"}
      </Text>

      {/* Instances */}
      {toolConfig && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Instances</Text>
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
          {previewLoading ? "computing drift…" : "Drift"}
        </Text>
        {!previewLoading && instanceResults.length === 0 && (
          <Text dimColor>  (not in playbook or no instances)</Text>
        )}
        {instanceResults.map((r) => {
          const adds = r.diff.ops.filter((o) => o.kind === "add").length;
          const updates = r.diff.ops.filter((o) => o.kind === "update").length;
          const removes = r.diff.ops.filter((o) => o.kind === "remove").length;
          const noop = r.diff.ops.filter((o) => o.kind === "no-op").length;
          const clean = adds === 0 && updates === 0 && removes === 0;
          return (
            <Box key={r.instanceId} flexDirection="column">
              <Text>
                {"  "}
                <Text dimColor>[{r.instanceId}]</Text>{" "}
                {clean ? (
                  <Text color="green">✓ in sync</Text>
                ) : (
                  <Text color="yellow">
                    {adds > 0 && `+${adds} `}
                    {updates > 0 && `~${updates} `}
                    {removes > 0 && `-${removes} `}
                    pending
                  </Text>
                )}
                {noop > 0 && <Text dimColor>  {noop} unchanged</Text>}
              </Text>
              {/* Show each pending op */}
              {!clean &&
                r.diff.ops
                  .filter((o) => o.kind !== "no-op")
                  .map((op, i) => (
                    <Text key={i} dimColor>
                      {"    "}
                      {op.kind === "add" ? "+" : op.kind === "remove" ? "-" : "~"}
                      {" "}
                      {op.artifactType}/{op.name}
                    </Text>
                  ))}
              {/* Bundle ops */}
              {r.bundleOps.filter((b) => b.op !== "skip").map((b, i) => (
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
            ⚠ unset env vars: {enginePreview.envCheck.missing.join(", ")}
          </Text>
        </Box>
      )}

      {/* Keybinds hint */}
      <Box marginTop={1}>
        <Text dimColor>↑↓ select tool  ·  press a to apply this tool</Text>
      </Box>
    </Box>
  );
}
