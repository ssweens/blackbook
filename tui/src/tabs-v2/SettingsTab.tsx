/**
 * Settings tab — navigable tool lifecycle + playbook config.
 *
 * Layout: left panel (item list) + right panel (detail + actions)
 *
 * Keys:
 *   ↑↓     navigate items
 *   i       install selected tool
 *   u       update selected tool
 *   x       uninstall selected tool (requires confirmation)
 *   y/n     confirm/cancel destructive action
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import type { ToolId } from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore } from "../lib/playbook-store.js";
import { installTool, updateTool, uninstallTool } from "../lib/tool-lifecycle.js";

// New adapter IDs → legacy registry IDs used by tool-lifecycle/tool-registry
const REGISTRY_ID: Partial<Record<ToolId, string>> = {
  claude: "claude-code",
  codex: "openai-codex",
  opencode: "opencode",
  amp: "amp-code",
  pi: "pi",
};
function registryId(toolId: ToolId): string {
  return REGISTRY_ID[toolId] ?? toolId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Item =
  | { kind: "tool"; toolId: ToolId }
  | { kind: "general" };

type ActionState =
  | null
  | { phase: "confirming"; action: "uninstall"; toolId: ToolId }
  | { phase: "running"; action: "install" | "update" | "uninstall"; toolId: ToolId }
  | { phase: "result"; ok: boolean; message: string };

// Module-level state exposed to the input handler (same pattern as DashboardTab)
type LocalState = {
  selectedIdx: number;
  setSelectedIdx: (n: number) => void;
  items: Item[];
  actionState: ActionState;
  setActionState: (s: ActionState) => void;
};
let _local: LocalState | null = null;

export function SettingsTab({ isFocused: _f }: { isFocused: boolean }) {
  const playbook = usePlaybookStore((s) => s.playbook);
  const playbookPath = usePlaybookStore((s) => s.playbookPath);
  const playbookValidation = usePlaybookStore((s) => s.playbookValidation);
  const playbookLoading = usePlaybookStore((s) => s.playbookLoading);
  const playbookError = usePlaybookStore((s) => s.playbookError);
  const toolStatuses = usePlaybookStore((s) => s.toolStatuses);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [actionState, setActionState] = useState<ActionState>(null);

  const items: Item[] = [
    ...(playbook?.manifest.tools_enabled.map(
      (toolId) => ({ kind: "tool" as const, toolId }),
    ) ?? []),
    { kind: "general" as const },
  ];

  _local = { selectedIdx, setSelectedIdx, items, actionState, setActionState };

  const selected = items[selectedIdx] ?? items[0];

  if (!playbook) {
    return (
      <Box paddingX={2} paddingY={1}>
        {playbookLoading ? <Text dimColor>Loading…</Text>
        : playbookError ? <Text color="red">✗ {playbookError}</Text>
        : <Text color="yellow">No playbook loaded.</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Action confirmation bar */}
      {actionState?.phase === "confirming" && (
        <Box paddingX={2} borderStyle="single" borderColor="yellow">
          <Text color="yellow">
            Uninstall <Text bold>{actionState.toolId}</Text>?{"  "}
            <Text bold>y</Text> confirm  <Text bold>n</Text> cancel
          </Text>
        </Box>
      )}
      {actionState?.phase === "running" && (
        <Box paddingX={2}>
          <Text color="cyan">⟳ {actionState.action} {actionState.toolId}…</Text>
        </Box>
      )}
      {actionState?.phase === "result" && (
        <Box paddingX={2}>
          <Text color={actionState.ok ? "green" : "red"}>
            {actionState.ok ? "✓" : "✗"} {actionState.message}
          </Text>
          <Text dimColor>  (any key to dismiss)</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Item list */}
        <Box flexDirection="column" width={20} borderStyle="single" borderRight paddingX={1}>
          <Text bold dimColor>Settings</Text>
          {items.map((item, i) => {
            const sel = i === selectedIdx;
            const bg = sel ? "blue" : undefined;
            const fg = sel ? "white" : undefined;
            const label = item.kind === "tool" ? item.toolId : "general";
            const status = item.kind === "tool" ? toolStatuses[item.toolId] : undefined;
            const installed = status?.detection.installed;
            const glyph = item.kind === "tool"
              ? (installed === undefined ? "?" : installed ? "✓" : "·")
              : " ";
            const glyphColor = installed ? "green" : "gray";
            return (
              <Text key={i} backgroundColor={bg} color={fg}>
                {sel ? "▶ " : "  "}
                {item.kind === "tool" && <Text color={glyphColor}>{glyph}</Text>}
                {item.kind === "tool" && " "}
                {label}
              </Text>
            );
          })}
        </Box>

        {/* Detail panel */}
        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          {selected?.kind === "tool" && (
            <ToolDetail
              toolId={selected.toolId}
              playbook={playbook}
              toolStatuses={toolStatuses}
              actionState={actionState}
            />
          )}
          {selected?.kind === "general" && (
            <GeneralDetail
              playbook={playbook}
              playbookPath={playbookPath}
              validation={playbookValidation}
            />
          )}
        </Box>
      </Box>


    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool detail
// ─────────────────────────────────────────────────────────────────────────────

function ToolDetail({ toolId, playbook, toolStatuses, actionState }: {
  toolId: ToolId;
  playbook: NonNullable<PlaybookStore["playbook"]>;
  toolStatuses: PlaybookStore["toolStatuses"];
  actionState: ActionState;
}) {
  const status = toolStatuses[toolId];
  const det = status?.detection;
  const tc = playbook.tools[toolId];
  const pm = playbook.manifest.settings.package_manager;

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1}>
        <Text bold>{toolId}</Text>
        {det?.version && <Text dimColor>{det.version.split("\n")[0]}</Text>}
      </Box>
      <Text dimColor>
        {det?.installed
          ? `✓ installed  →  ${det.configDir ?? "~"}`
          : "· not installed"}
      </Text>

      {/* Instances */}
      {tc && (
        <Box flexDirection="column" marginTop={1}>
          {tc.config.instances.map((inst: import("../lib/playbook/index.js").ToolInstance) => (
            <Text key={inst.id} dimColor>
              {inst.enabled ? "✓" : "·"} {inst.name}  <Text>{inst.config_dir}</Text>
            </Text>
          ))}
        </Box>
      )}

      {/* Actions */}
      <Box flexDirection="column" marginTop={1}>
        {!det?.installed && (
          <Text dimColor>i  install via {pm}</Text>
        )}
        {det?.installed && (
          <>
            <Text dimColor>u  update via {pm}</Text>
            <Text dimColor>x  uninstall</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// General settings detail
// ─────────────────────────────────────────────────────────────────────────────

function GeneralDetail({ playbook, playbookPath, validation }: {
  playbook: NonNullable<PlaybookStore["playbook"]>;
  playbookPath: string | null;
  validation: PlaybookStore["playbookValidation"];
}) {
  const { settings, defaults } = playbook.manifest;
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold dimColor>Playbook</Text>
      <Text dimColor>{playbookPath ?? "(unknown)"}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {!validation || validation.issues.length === 0
            ? "✓ valid"
            : `${validation.issues.filter(i => i.severity === "error").length} error(s)`}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>pkg: {settings.package_manager}  strategy: {defaults.default_strategy}  drift: {defaults.drift_action}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Edit playbook.yaml to change · r to reload</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input handler
// ─────────────────────────────────────────────────────────────────────────────

export function handleSettingsInput(
  input: string,
  key: Key,
) {
  const local = _local;
  if (!local) return;

  const { selectedIdx, setSelectedIdx, items, actionState, setActionState } = local;

  // Dismiss result
  if (actionState?.phase === "result") {
    setActionState(null);
    return;
  }

  // Confirmation
  if (actionState?.phase === "confirming") {
    if (input === "y" || input === "Y") {
      const { toolId } = actionState;
      setActionState({ phase: "running", action: "uninstall", toolId });
      const store = usePlaybookStore.getState();
      const pm = store.playbook?.manifest.settings.package_manager ?? "pnpm";
      uninstallTool(registryId(toolId), pm, () => {}).then((ok) => {
        setActionState({ phase: "result", ok, message: ok ? `${toolId} uninstalled` : `uninstall failed` });
        store.detectAllTools().catch(() => {});
      });
    }
    if (input === "n" || input === "N" || key.escape) {
      setActionState(null);
    }
    return;
  }

  // Navigation
  if (key.upArrow) {
    setSelectedIdx(Math.max(0, selectedIdx - 1));
    return;
  }
  if (key.downArrow) {
    setSelectedIdx(Math.min(items.length - 1, selectedIdx + 1));
    return;
  }

  const item = items[selectedIdx];
  if (item?.kind !== "tool") return;
  const { toolId } = item;
  const store = usePlaybookStore.getState();
  const pm = store.playbook?.manifest.settings.package_manager ?? "pnpm";
  const installed = store.toolStatuses[toolId]?.detection.installed;

  if (input === "i" && !installed) {
    setActionState({ phase: "running", action: "install", toolId });
    installTool(registryId(toolId), pm, () => {}).then((ok) => {
      setActionState({ phase: "result", ok, message: ok ? `${toolId} installed` : `install failed` });
      store.detectAllTools().catch(() => {});
    });
  }

  if (input === "u" && installed) {
    setActionState({ phase: "running", action: "update", toolId });
    updateTool(registryId(toolId), pm, () => {}).then((ok) => {
      setActionState({ phase: "result", ok, message: ok ? `${toolId} updated` : `update failed` });
      store.detectAllTools().catch(() => {});
    });
  }

  if (input === "x" && installed) {
    setActionState({ phase: "confirming", action: "uninstall", toolId });
  }
}
