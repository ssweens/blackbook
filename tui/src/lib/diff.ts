/**
 * Diff computation utilities for drift detection and display.
 *
 * Orientation: We treat target as "old" and source as "new".
 * This means + lines = what needs to be added to target to match source.
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { diffLines, createTwoFilesPatch, parsePatch } from "diff";
import type {
  DiffTarget,
  DiffFileSummary,
  DiffFileDetail,
  DiffHunk,
  DiffLine,
  DiffInstanceRef,
  DiffFileStatus,
  MissingSummary,
} from "./types.js";
import { getToolInstances } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Binary detection
// ─────────────────────────────────────────────────────────────────────────────

export function isBinaryFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const buffer = readFileSync(filePath);
    // Check for null bytes in first 8KB
    const limit = Math.min(buffer.length, 8192);
    for (let i = 0; i < limit; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Line count computation (fast path for file list)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffCounts {
  linesAdded: number;
  linesRemoved: number;
}

export function computeDiffCounts(oldText: string, newText: string): DiffCounts {
  const changes = diffLines(oldText, newText);
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const change of changes) {
    const lineCount = change.count ?? 0;
    if (change.added) {
      linesAdded += lineCount;
    } else if (change.removed) {
      linesRemoved += lineCount;
    }
  }

  return { linesAdded, linesRemoved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full unified diff computation (slow path for detail view)
// ─────────────────────────────────────────────────────────────────────────────

export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string
): DiffHunk[] {
  const patch = createTwoFilesPatch(oldLabel, newLabel, oldText, newText, "", "", {
    context: 3,
  });

  const parsed = parsePatch(patch);
  if (parsed.length === 0) return [];

  const hunks: DiffHunk[] = [];
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      const lines: DiffLine[] = [];
      for (const line of hunk.lines) {
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === "+") {
          lines.push({ type: "add", content });
        } else if (prefix === "-") {
          lines.push({ type: "remove", content });
        } else {
          lines.push({ type: "context", content });
        }
      }
      hunks.push({
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        lines,
      });
    }
  }

  return hunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// File-level diff summary
// ─────────────────────────────────────────────────────────────────────────────

function buildFileSummary(
  id: string,
  displayPath: string,
  sourcePath: string | null,
  targetPath: string | null
): DiffFileSummary {
  const sourceExists = sourcePath !== null && existsSync(sourcePath);
  const targetExists = targetPath !== null && existsSync(targetPath);

  // Determine status
  let status: DiffFileStatus;
  if (!targetExists && sourceExists) {
    status = "missing";
  } else if (targetExists && !sourceExists) {
    status = "extra";
  } else if (sourceExists && targetExists) {
    if (isBinaryFile(sourcePath!) || isBinaryFile(targetPath!)) {
      status = "binary";
    } else {
      status = "modified";
    }
  } else {
    // Neither exists - shouldn't happen but handle gracefully
    status = "missing";
  }

  // Collect modification timestamps
  let sourceMtime: number | null = null;
  let targetMtime: number | null = null;
  if (sourceExists) {
    try { sourceMtime = statSync(sourcePath!).mtimeMs; } catch { /* ignore */ }
  }
  if (targetExists) {
    try { targetMtime = statSync(targetPath!).mtimeMs; } catch { /* ignore */ }
  }

  // Compute line counts
  let linesAdded = 0;
  let linesRemoved = 0;

  if (status === "modified") {
    const oldText = readFileSync(targetPath!, "utf-8");
    const newText = readFileSync(sourcePath!, "utf-8");
    const counts = computeDiffCounts(oldText, newText);
    linesAdded = counts.linesAdded;
    linesRemoved = counts.linesRemoved;
  } else if (status === "missing" && sourceExists) {
    // All lines are additions (target is empty)
    const newText = readFileSync(sourcePath!, "utf-8");
    linesAdded = newText.split("\n").length;
  } else if (status === "extra" && targetExists) {
    // All lines are removals (source is empty)
    const oldText = readFileSync(targetPath!, "utf-8");
    linesRemoved = oldText.split("\n").length;
  }

  return {
    id,
    displayPath,
    sourcePath,
    targetPath,
    status,
    linesAdded,
    linesRemoved,
    sourceMtime,
    targetMtime,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate sync direction recommendation
// ─────────────────────────────────────────────────────────────────────────────

export type SyncDirection = "forward" | "pullback" | "both" | "unknown";

/**
 * Determines the recommended sync direction for a set of diff files based on
 * modification timestamps. "forward" = source is newer (sync to tool),
 * "pullback" = target/instance is newer (pull to source), "both" = mixed,
 * "unknown" = no timestamp data available.
 */
export function getConfigSyncDirection(files: DiffFileSummary[]): SyncDirection {
  let sourceNewer = 0;
  let targetNewer = 0;

  for (const f of files) {
    if (f.sourceMtime != null && f.targetMtime != null) {
      if (f.sourceMtime > f.targetMtime) {
        sourceNewer++;
      } else if (f.targetMtime > f.sourceMtime) {
        targetNewer++;
      }
      // Equal timestamps: neither count
    }
  }

  if (sourceNewer === 0 && targetNewer === 0) return "unknown";
  if (sourceNewer > 0 && targetNewer === 0) return "forward";
  if (targetNewer > 0 && sourceNewer === 0) return "pullback";
  return "both";
}

// ─────────────────────────────────────────────────────────────────────────────
// State-based sync direction (for pullback-enabled files)
// ─────────────────────────────────────────────────────────────────────────────

import type { DriftKind } from "./modules/types.js";

/**
 * Determines sync direction from three-way state drift kind.
 * Unlike getConfigSyncDirection which uses timestamps, this uses
 * deterministic hash comparison against last-synced state.
 */
export function getSyncDirectionFromDrift(driftKind: DriftKind): SyncDirection {
  switch (driftKind) {
    case "in-sync": return "forward";
    case "source-changed": return "forward";
    case "target-changed": return "pullback";
    case "both-changed": return "both";
    case "never-synced": return "unknown";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File-level diff detail (with hunks)
// ─────────────────────────────────────────────────────────────────────────────

export function computeFileDetail(summary: DiffFileSummary): DiffFileDetail {
  if (summary.status === "binary") {
    return { ...summary, hunks: [] };
  }

  const oldText =
    summary.targetPath && existsSync(summary.targetPath)
      ? readFileSync(summary.targetPath, "utf-8")
      : "";
  const newText =
    summary.sourcePath && existsSync(summary.sourcePath)
      ? readFileSync(summary.sourcePath, "utf-8")
      : "";

  const hunks = computeUnifiedDiff(oldText, newText, "target", "source");

  return { ...summary, hunks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursively list files in a directory
// ─────────────────────────────────────────────────────────────────────────────

function listFilesRecursive(dir: string, base: string = ""): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relPath = base ? join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

