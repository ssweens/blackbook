/**
 * InventoryView — side-by-side comparison of playbook vs disk state.
 *
 * Left column  = what the playbook declares (source of truth / repo)
 * Right column = what's on disk (local / installed)
 *
 * State glyph (right edge):
 *   ✓  In sync — both sides match
 *   ~  Modified — exists on both, content differs
 *   +  Missing on disk — in playbook, not installed
 *   −  Extra on disk — on disk, not in playbook (apply would remove)
 *   ?  Untracked — installed, not declared in playbook
 *
 * Navigation: ↑↓ / PgUp/PgDn  (skips section headers)
 * Action:     Enter opens ItemActionMenu for the highlighted row
 */

import React from "react";
import { Box, Text } from "ink";
import type { DiffOp, ToolId } from "../lib/playbook/index.js";
import type { BundleState, PerInstanceResult } from "../lib/sync/index.js";
import type { ItemContext, ItemState } from "./ItemActionMenu.js";

// ─────────────────────────────────────────────────────────────────────────────
// Row model
// ─────────────────────────────────────────────────────────────────────────────

export type InvRow = {
  /** Left cell (playbook side) */
  left: string;
  /** Right cell (disk side) */
  right: string;
  /** State glyph */
  glyph: "✓" | "~" | "+" | "−" | "?";
  /** Color for the glyph + highlighting */
  color: string;
  /** Whether this row is navigable (false = section header) */
  isHeader: boolean;
  /** Action context for Enter */
  action?: ItemContext;
};

const SHOWN_TYPES = new Set(["skill", "agents_md", "mcp", "hook", "config_file"]);

export function buildInventoryRows(
  instanceResult: PerInstanceResult | undefined,
  toolId: ToolId,
  bundleLabel: string,   // "plugins" or "packages"
): InvRow[] {
  const rows: InvRow[] = [];

  if (!instanceResult) return rows;

  const ops = instanceResult.diff.ops.filter(
    (o) => SHOWN_TYPES.has(o.artifactType),
  );
  const bundles = instanceResult.bundleStates ?? [];

  // ── Section: Modified ────────────────────────────────────────────────────
  const modified = ops.filter((o) => o.kind === "update");
  if (modified.length > 0) {
    rows.push(header("Modified — exists on both sides, content differs", "yellow"));
    for (const op of modified) {
      rows.push({
        left:  label(op),
        right: label(op),
        glyph: "~",
        color: "yellow",
        isHeader: false,
        action: ctx(op, "modified", toolId),
      });
    }
  }

  // ── Section: Missing on disk ─────────────────────────────────────────────
  const addOps   = ops.filter((o) => o.kind === "add");
  const addBundles = bundles.filter((b) => b.declared === "enabled" && !b.installed);
  if (addOps.length + addBundles.length > 0) {
    rows.push(header("In playbook, not on disk — apply would install", "green"));
    for (const op of addOps) {
      rows.push({
        left:  label(op),
        right: "(not installed)",
        glyph: "+",
        color: "green",
        isHeader: false,
        action: ctx(op, "missing", toolId),
      });
    }
    for (const b of addBundles) {
      rows.push({
        left:  `${bundleLabel}/${b.name}${b.version ? "@" + b.version : ""}${b.sourceKind ? "  (" + b.sourceKind + ")" : ""}`,
        right: "(not installed)",
        glyph: "+",
        color: "green",
        isHeader: false,
        action: bundleCtx(b, "missing", toolId, bundleLabel),
      });
    }
  }

  // ── Section: Extra on disk ───────────────────────────────────────────────
  const removeOps   = ops.filter((o) => o.kind === "remove");
  const extraBundles = bundles.filter((b) => b.declared === "disabled" && b.installed);
  if (removeOps.length + extraBundles.length > 0) {
    rows.push(header("On disk, not in playbook — apply would remove", "red"));
    for (const op of removeOps) {
      rows.push({
        left:  "(not in playbook)",
        right: label(op),
        glyph: "−",
        color: "red",
        isHeader: false,
        action: ctx(op, "extra", toolId),
      });
    }
    for (const b of extraBundles) {
      rows.push({
        left:  `${bundleLabel}/${b.name}  (declared, disabled)`,
        right: `${bundleLabel}/${b.name}  (installed)`,
        glyph: "−",
        color: "red",
        isHeader: false,
        action: bundleCtx(b, "extra", toolId, bundleLabel),
      });
    }
  }

  // ── Section: Untracked bundles ───────────────────────────────────────────
  const untracked = bundles.filter((b) => b.declared === "undeclared");
  if (untracked.length > 0) {
    rows.push(header("Installed but not declared in playbook", "yellow"));
    for (const b of untracked) {
      rows.push({
        left:  "(not in playbook)",
        right: `${bundleLabel}/${b.name}`,
        glyph: "?",
        color: "yellow",
        isHeader: false,
        action: bundleCtx(b, "untracked", toolId, bundleLabel),
      });
    }
  }

  // ── Section: In sync ─────────────────────────────────────────────────────
  const syncOps     = ops.filter((o) => o.kind === "no-op");
  const syncBundles = bundles.filter((b) => b.declared === "enabled" && b.installed);
  if (syncOps.length + syncBundles.length > 0) {
    rows.push(header(`In sync — playbook and disk match (${syncOps.length + syncBundles.length})`, "gray"));
    for (const op of syncOps) {
      rows.push({
        left:  label(op),
        right: label(op),
        glyph: "✓",
        color: "gray",
        isHeader: false,
        action: ctx(op, "synced", toolId),
      });
    }
    for (const b of syncBundles) {
      const name = `${bundleLabel}/${b.name}${b.version ? "@" + b.version : ""}`;
      rows.push({
        left:  name,
        right: name,
        glyph: "✓",
        color: "gray",
        isHeader: false,
        action: bundleCtx(b, "synced", toolId, bundleLabel),
      });
    }
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 10;

interface Props {
  rows: InvRow[];
  scrollIdx: number;
  detailFocused: boolean;
  configDir: string;
  playbookName: string;
}

export function InventoryView({ rows, scrollIdx, detailFocused, configDir, playbookName }: Props) {
  if (rows.length === 0) return null;

  // Available = terminal minus left panel (22) + border/padding (~6)
  const available = (process.stdout.columns || 120) - 28;
  // Row layout: cursor(2) + left(colW) + " │ "(3) + right(colW) + " ~"(2) = 2*colW + 7
  const colW = Math.max(20, Math.floor((available - 7) / 2));

  const visible = rows.slice(scrollIdx, scrollIdx + PAGE);
  const canUp   = scrollIdx > 0;
  const canDown = scrollIdx + PAGE < rows.length;

  const cur = rows[scrollIdx];
  const hasCur = cur && !cur.isHeader;

  return (
    <Box flexDirection="column">
      {/* Column headers */}
      <Box>
        <Text dimColor>{"  "}</Text>
        <Box width={colW}>
          <Text bold dimColor>{" Playbook (repo)".padEnd(colW)}</Text>
        </Box>
        <Text dimColor> │ </Text>
        <Text bold dimColor> Disk ({configDir})</Text>
      </Box>
      <Text dimColor>{"  " + "─".repeat(colW) + "─┼─" + "─".repeat(colW)}</Text>

      {/* Rows */}
      <Box flexDirection="column">
        {canUp && (
          <Text dimColor>  ↑ {scrollIdx} more above</Text>
        )}
        {visible.map((row, i) => {
          const absIdx = scrollIdx + i;
          const isCursor = detailFocused && absIdx === scrollIdx && !row.isHeader;

          if (row.isHeader) {
            return (
              <Box key={i} marginTop={i > 0 ? 0 : 0}>
                <Text color={row.color} dimColor bold>{"  ▸ " + row.left}</Text>
              </Box>
            );
          }

          // Single Text node avoids ink multi-line layout artifacts from nested Boxes.
          const cursor  = isCursor ? "▶ " : "  ";
          const left    = truncate(row.left,  colW - 1).padEnd(colW - 1);
          const right   = truncate(row.right, colW - 4).padEnd(colW - 4);
          // One Text node = one terminal line, no ink block-layout artifacts.
          const glyphColor = isCursor ? "white"
            : row.glyph === "~" ? "yellow"
            : row.glyph === "+" ? "green"
            : row.glyph === "−" ? "red"
            : row.glyph === "?" ? "yellow"
            : undefined;
          const line = `${cursor}${left} │ ${right} ${row.glyph}`;
          return (
            <Text
              key={`row-${i}`}
              color={isCursor ? "white" : glyphColor ?? undefined}
              dimColor={!isCursor && row.glyph === "✓"}
              backgroundColor={isCursor ? "blue" : undefined}
              wrap="truncate"
            >
              {line}
            </Text>
          );
        })}
        {canDown && (
          <Text dimColor>  ↓ {rows.length - scrollIdx - PAGE} more below</Text>
        )}
      </Box>

      {/* Status line */}
      <Box marginTop={1}>
        <Text dimColor>
          ({scrollIdx + 1}/{rows.length}){"  "}
          {hasCur && detailFocused ? (
            <Text><Text bold>Enter</Text> for options{"  "}</Text>
          ) : null}
          {detailFocused ? <Text>PgUp/PgDn jump{"  "}Esc back</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary bar (shown above the inventory in normal mode)
// ─────────────────────────────────────────────────────────────────────────────

export function InventorySummary({ rows }: { rows: InvRow[] }) {
  const modified  = rows.filter((r) => !r.isHeader && r.glyph === "~").length;
  const missing   = rows.filter((r) => !r.isHeader && r.glyph === "+").length;
  const extra     = rows.filter((r) => !r.isHeader && r.glyph === "−").length;
  const untracked = rows.filter((r) => !r.isHeader && r.glyph === "?").length;
  const synced    = rows.filter((r) => !r.isHeader && r.glyph === "✓").length;
  const total     = rows.filter((r) => !r.isHeader).length;

  if (total === 0) return <Text dimColor>  press Enter to load</Text>;

  const allSynced = modified === 0 && missing === 0 && extra === 0 && untracked === 0;
  if (allSynced) return <Text color="green">  ✓ fully in sync ({synced} items)</Text>;

  return (
    <Box gap={2}>
      <Text dimColor>  </Text>
      {synced    > 0 && <Text dimColor>{synced} synced</Text>}
      {modified  > 0 && <Text color="yellow">~{modified} modified</Text>}
      {missing   > 0 && <Text color="green">+{missing} missing on disk</Text>}
      {extra     > 0 && <Text color="red">−{extra} extra on disk</Text>}
      {untracked > 0 && <Text color="yellow">?{untracked} untracked</Text>}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function header(text: string, color: string): InvRow {
  return { left: text, right: "", glyph: "✓", color, isHeader: true };
}

function label(op: DiffOp): string {
  if (op.artifactType === "agents_md") {
    // Show the actual target filename if known
    const name = op.name || "AGENTS.md";
    return `AGENTS.md${name !== "AGENTS.md" ? " → " + name : ""}`;
  }
  return `${op.artifactType}/${op.name}`;
}

function ctx(op: DiffOp, state: ItemState, toolId: ToolId): ItemContext {
  return {
    state,
    toolId,
    op,
    displayName: label(op),
    typeLabel: op.artifactType,
  };
}

function bundleCtx(b: BundleState, state: ItemState, toolId: ToolId, bundleLabel: string): ItemContext {
  return {
    state,
    toolId,
    bundleName: b.name,
    displayName: b.name,
    typeLabel: bundleLabel === "plugins" ? "plugin" : "package",
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function nextRow(rows: InvRow[], current: number, step: 1 | -1): number {
  let i = current + step;
  while (i >= 0 && i < rows.length) {
    if (!rows[i]!.isHeader) return i;
    i += step;
  }
  return current;
}

export function firstActionableRow(rows: InvRow[]): number {
  return rows.findIndex((r) => !r.isHeader);
}
