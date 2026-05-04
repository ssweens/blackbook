/**
 * DriftDiffView — clean unified diff for a drifted artifact.
 *
 * Shows what `apply` would do:
 *   - lines (red)  = currently on disk, will be removed
 *   + lines (green) = in playbook, will be added
 *
 * Renders its own diff, bypassing DiffDetail's legacy labels and conflicting
 * useInput. Scrolling is handled by PlaybookApp's single useInput via the
 * exported handleDiffInput() function.
 */

import React from "react";
import { Box, Text } from "ink";
import { existsSync, statSync } from "node:fs";
import { join as pathJoin } from "node:path";
import type { Key } from "ink";
import type { DiffOp } from "../lib/playbook/index.js";
import { computeFileDetail } from "../lib/diff.js";
import type { DiffFileSummary } from "../lib/types.js";

const PAGE_SIZE = 22;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level scroll state (same pattern as Dashboard/Settings)
// ─────────────────────────────────────────────────────────────────────────────

type DiffLocalState = {
  scrollOffset: number;
  setScrollOffset: (n: number) => void;
  totalLines: number;
};
let _diffLocal: DiffLocalState | null = null;

export function handleDiffInput(key: Key, input: string, onBack: () => void) {
  const local = _diffLocal;
  if (!local) return;
  const { scrollOffset, setScrollOffset, totalLines } = local;
  const max = Math.max(0, totalLines - PAGE_SIZE);

  if (key.escape || (input === "q" && !key.ctrl)) {
    onBack();
    return;
  }
  if (key.upArrow)    { setScrollOffset(Math.max(0, scrollOffset - 1)); return; }
  if (key.downArrow)  { setScrollOffset(Math.min(max, scrollOffset + 1)); return; }
  if (key.pageUp)     { setScrollOffset(Math.max(0, scrollOffset - PAGE_SIZE)); return; }
  if (key.pageDown)   { setScrollOffset(Math.min(max, scrollOffset + PAGE_SIZE)); return; }
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
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">No diff available for {op.kind} ops.</Text>
        <Text dimColor>Esc to go back.</Text>
      </Box>
    );
  }

  const sourcePath = resolveFilePath(op.sourcePath, op.artifactType);
  const targetPath = resolveFilePath(op.targetPath, op.artifactType);

  if (!sourcePath || !targetPath) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">Cannot locate files for {op.name}.</Text>
        <Text dimColor>sourcePath: {op.sourcePath}  targetPath: {op.targetPath}</Text>
        <Text dimColor>Esc to go back.</Text>
      </Box>
    );
  }

  const summary: DiffFileSummary = {
    id: op.name,
    displayPath: op.name,
    sourcePath,
    targetPath,
    status: "modified",
    linesAdded: 0,
    linesRemoved: 0,
    sourceMtime: safeStatMs(sourcePath),
    targetMtime: safeStatMs(targetPath),
  };

  const detail = computeFileDetail(summary);

  // Flatten all lines
  type Line = { type: "header" | "add" | "remove" | "context"; content: string };
  const allLines: Line[] = [];
  let adds = 0, removes = 0;
  for (const hunk of detail.hunks) {
    allLines.push({ type: "header", content: hunk.header });
    for (const line of hunk.lines) {
      allLines.push(line);
      if (line.type === "add") adds++;
      if (line.type === "remove") removes++;
    }
  }

  // Expose scroll state to input handler
  _diffLocal = { scrollOffset, setScrollOffset, totalLines: allLines.length };

  const max = Math.max(0, allLines.length - PAGE_SIZE);
  const clampedOffset = Math.min(scrollOffset, max);
  const visible = allLines.slice(clampedOffset, clampedOffset + PAGE_SIZE);

  const diskMtime = summary.targetMtime ? formatDate(summary.targetMtime) : "";
  const pbMtime   = summary.sourceMtime ? formatDate(summary.sourceMtime) : "";

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} gap={2}>
        <Text bold>{op.name}</Text>
        {adds > 0 && <Text color="green">+{adds}</Text>}
        {removes > 0 && <Text color="red">-{removes}</Text>}
        {allLines.length > PAGE_SIZE && (
          <Text dimColor>
            ({clampedOffset + 1}–{Math.min(clampedOffset + PAGE_SIZE, allLines.length)}/{allLines.length} lines)
          </Text>
        )}
      </Box>

      {/* Legend */}
      <Box paddingX={1} flexDirection="column">
        <Text dimColor><Text color="red">-</Text> disk (current){diskMtime ? `  ${diskMtime}` : ""}</Text>
        <Text dimColor><Text color="green">+</Text> playbook (after apply){pbMtime ? `  ${pbMtime}` : ""}</Text>
      </Box>

      {/* Diff lines */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {allLines.length === 0 ? (
          <Text color="green">✓ Files are identical</Text>
        ) : (
          visible.map((line, i) => {
            if (line.type === "header") {
              return <Text key={i} color="cyan">{line.content}</Text>;
            }
            const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
            const color  = line.type === "add" ? "green" : line.type === "remove" ? "red" : undefined;
            return (
              <Text key={i} color={color} dimColor={line.type === "context"}>
                {prefix}{line.content}
              </Text>
            );
          })
        )}
        {clampedOffset < max && <Text dimColor>  ↓ {max - clampedOffset} more</Text>}
      </Box>

      {/* Footer */}
      <Box paddingX={1} borderStyle="single" borderTop>
        <Text dimColor>↑↓ scroll  PgUp/PgDn jump  Esc back</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveFilePath(path: string, artifactType: DiffOp["artifactType"]): string | null {
  if (artifactType === "skill") {
    const f = pathJoin(path, "SKILL.md");
    return existsSync(f) ? f : null;
  }
  return existsSync(path) ? path : null;
}

function safeStatMs(path: string): number | null {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
