/**
 * DriftDiffView — side-by-side diff.
 *
 * Left  = disk (current state, lines that will be REMOVED on apply)
 * Right = playbook (what it becomes after apply, lines being ADDED)
 *
 * Changed blocks pair up: modifications show old on left, new on right.
 * Removed-only lines show on left with blank right.
 * Added-only lines show on right with blank left.
 * Context lines show on both sides.
 */

import React from "react";
import { Box, Text } from "ink";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join as pathJoin } from "node:path";
import type { Key } from "ink";
import type { DiffOp } from "../lib/playbook/index.js";
import { diffLines } from "diff";

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Side-by-side line types
// ─────────────────────────────────────────────────────────────────────────────

type Side = { text: string; kind: "removed" | "added" | "context" | "empty" };
type Row  = { left: Side; right: Side };

function buildRows(diskContent: string, playbookContent: string): Row[] {
  // target = disk (old), source = playbook (new)
  const changes = diffLines(diskContent, playbookContent);
  const rows: Row[] = [];
  let i = 0;

  while (i < changes.length) {
    const cur = changes[i];
    if (!cur) { i++; continue; }

    if (cur.removed) {
      // Look ahead for a paired add (modification)
      const next = changes[i + 1];
      if (next?.added) {
        // Modification: pair left/right lines
        const leftLines  = cur.value.split("\n").filter((_, j, a) => j < a.length - 1 || a[a.length - 1] !== "");
        const rightLines = next.value.split("\n").filter((_, j, a) => j < a.length - 1 || a[a.length - 1] !== "");
        const len = Math.max(leftLines.length, rightLines.length);
        for (let k = 0; k < len; k++) {
          rows.push({
            left:  k < leftLines.length  ? { text: leftLines[k]!,  kind: "removed" } : { text: "", kind: "empty" },
            right: k < rightLines.length ? { text: rightLines[k]!, kind: "added"   } : { text: "", kind: "empty" },
          });
        }
        i += 2; // consumed both
        continue;
      } else {
        // Pure removal
        for (const line of splitLines(cur.value)) {
          rows.push({ left: { text: line, kind: "removed" }, right: { text: "", kind: "empty" } });
        }
      }
    } else if (cur.added) {
      // Pure addition
      for (const line of splitLines(cur.value)) {
        rows.push({ left: { text: "", kind: "empty" }, right: { text: line, kind: "added" } });
      }
    } else {
      // Context
      for (const line of splitLines(cur.value)) {
        rows.push({ left: { text: line, kind: "context" }, right: { text: line, kind: "context" } });
      }
    }
    i++;
  }

  return rows;
}

function splitLines(s: string): string[] {
  const lines = s.split("\n");
  // trailing empty string from final newline
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level scroll state
// ─────────────────────────────────────────────────────────────────────────────

type LocalState = {
  scrollOffset: number;
  setScrollOffset: (n: number) => void;
  totalRows: number;
};
let _local: LocalState | null = null;

export function handleDiffInput(key: Key, input: string, onBack: () => void) {
  const local = _local;
  if (!local) return;
  const { scrollOffset, setScrollOffset, totalRows } = local;
  const max = Math.max(0, totalRows - PAGE_SIZE);

  if (key.escape || input === "q") { onBack(); return; }
  if (key.upArrow)   { setScrollOffset(Math.max(0, scrollOffset - 1)); return; }
  if (key.downArrow) { setScrollOffset(Math.min(max, scrollOffset + 1)); return; }
  if (key.pageUp)    { setScrollOffset(Math.max(0, scrollOffset - PAGE_SIZE)); return; }
  if (key.pageDown)  { setScrollOffset(Math.min(max, scrollOffset + PAGE_SIZE)); return; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  op: DiffOp;
  scrollOffset: number;
  setScrollOffset: (n: number) => void;
  onBack: () => void;
}

export function DriftDiffView({ op, scrollOffset, setScrollOffset, onBack }: Props) {
  if (op.kind !== "update" || !op.sourcePath || !op.targetPath) {
    return (
      <Box paddingX={2}><Text color="yellow">No diff for {op.kind} op. Esc back.</Text></Box>
    );
  }

  const diskPath     = resolveFile(op.targetPath, op.artifactType); // disk = target = left
  const playbookPath = resolveFile(op.sourcePath, op.artifactType); // playbook = source = right

  if (!diskPath || !playbookPath) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color="yellow">Cannot read files for {op.name}.</Text>
        <Text dimColor>disk: {op.targetPath}  playbook: {op.sourcePath}</Text>
        <Text dimColor>Esc back</Text>
      </Box>
    );
  }

  const diskContent     = safeRead(diskPath);
  const playbookContent = safeRead(playbookPath);
  const rows = buildRows(diskContent, playbookContent);

  const max = Math.max(0, rows.length - PAGE_SIZE);
  const clamped = Math.min(scrollOffset, max);
  const visible = rows.slice(clamped, clamped + PAGE_SIZE);

  const adds    = rows.filter(r => r.right.kind === "added").length;
  const removes = rows.filter(r => r.left.kind  === "removed").length;

  // Column width: split terminal evenly with a separator
  const termWidth = process.stdout.columns || 120;
  const colWidth  = Math.floor((termWidth - 3) / 2); // 3 = "│" + 2 spaces

  _local = { scrollOffset: clamped, setScrollOffset, totalRows: rows.length };

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} gap={2}>
        <Text bold>{op.name}</Text>
        {removes > 0 && <Text color="red">-{removes} disk</Text>}
        {adds > 0    && <Text color="green">+{adds} playbook</Text>}
        {rows.length > PAGE_SIZE && (
          <Text dimColor>
            rows {clamped + 1}–{Math.min(clamped + PAGE_SIZE, rows.length)}/{rows.length}
          </Text>
        )}
      </Box>

      {/* Column labels */}
      <Box>
        <Box width={colWidth}><Text dimColor bold>{"  disk (current)".padEnd(colWidth)}</Text></Box>
        <Text dimColor>│</Text>
        <Box width={colWidth}><Text dimColor bold>  playbook (after apply)</Text></Box>
      </Box>

      {/* Divider */}
      <Text dimColor>{"─".repeat(colWidth)}┼{"─".repeat(colWidth)}</Text>

      {/* Rows */}
      <Box flexDirection="column" flexGrow={1}>
        {rows.length === 0 ? (
          <Text color="green">  ✓ Files are identical</Text>
        ) : (
          visible.map((row, i) => (
            <SideBySideRow key={clamped + i} row={row} colWidth={colWidth} />
          ))
        )}
        {clamped < max && (
          <Text dimColor>  ↓ {max - clamped} more rows</Text>
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1} borderStyle="single" borderTop>
        <Text dimColor>↑↓ scroll  PgUp/PgDn jump  Esc back</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row rendering
// ─────────────────────────────────────────────────────────────────────────────

function SideBySideRow({ row, colWidth }: { row: Row; colWidth: number }) {
  const leftText  = pad(row.left.text,  colWidth);
  const rightText = pad(row.right.text, colWidth);

  const leftColor  = row.left.kind  === "removed" ? "red"   : row.left.kind  === "empty" ? undefined : undefined;
  const rightColor = row.right.kind === "added"   ? "green" : row.right.kind === "empty" ? undefined : undefined;
  const leftDim    = row.left.kind  === "context";
  const rightDim   = row.right.kind === "context";

  const leftPrefix  = row.left.kind  === "removed" ? "-" : " ";
  const rightPrefix = row.right.kind === "added"   ? "+" : " ";

  return (
    <Box>
      <Text color={leftColor} dimColor={leftDim}>
        {leftPrefix}{leftText}
      </Text>
      <Text dimColor>│</Text>
      <Text color={rightColor} dimColor={rightDim}>
        {rightPrefix}{rightText}
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveFile(path: string, type: DiffOp["artifactType"]): string | null {
  if (type === "skill") {
    const f = pathJoin(path, "SKILL.md");
    return existsSync(f) ? f : null;
  }
  return existsSync(path) ? path : null;
}

function safeRead(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function pad(s: string, width: number): string {
  // Reserve 1 char for the prefix glyph
  const available = width - 1;
  if (s.length > available) return s.slice(0, available - 1) + "…";
  return s.padEnd(available);
}
