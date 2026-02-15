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
  Asset,
  ConfigFile,
  DiffTarget,
  DiffFileSummary,
  DiffFileDetail,
  DiffHunk,
  DiffLine,
  DiffInstanceRef,
  DiffFileStatus,
  MissingSummary,
  ConfigSourceFile,
} from "./types.js";
import { getAssetToolStatus, getConfigToolStatus, getAssetSourceInfo, resolveAssetTarget } from "./install.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Build DiffTarget for an Asset
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffInstanceSummary extends DiffInstanceRef {
  totalAdded: number;
  totalRemoved: number;
}

export function getDriftedAssetInstances(asset: Asset): DiffInstanceRef[] {
  const sourceInfo = getAssetSourceInfo(asset);
  const statuses = getAssetToolStatus(asset, sourceInfo);
  return statuses
    .filter((s) => s.enabled && s.drifted)
    .map((s) => ({
      toolId: s.toolId,
      instanceId: s.instanceId,
      instanceName: s.name,
      configDir: s.configDir,
    }));
}

export function getDriftedAssetInstancesWithCounts(asset: Asset): DiffInstanceSummary[] {
  const sourceInfo = getAssetSourceInfo(asset);
  const statuses = getAssetToolStatus(asset, sourceInfo);
  return statuses
    .filter((s) => s.enabled && s.drifted)
    .map((s) => {
      const instance: DiffInstanceRef = {
        toolId: s.toolId,
        instanceId: s.instanceId,
        instanceName: s.name,
        configDir: s.configDir,
      };
      const diffTarget = buildAssetDiffTarget(asset, instance);
      const totalAdded = diffTarget.files.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalRemoved = diffTarget.files.reduce((sum, f) => sum + f.linesRemoved, 0);
      return { ...instance, totalAdded, totalRemoved };
    });
}

export function getMissingAssetInstances(asset: Asset): DiffInstanceRef[] {
  const sourceInfo = getAssetSourceInfo(asset);
  const statuses = getAssetToolStatus(asset, sourceInfo);
  return statuses
    .filter((s) => s.enabled && !s.installed && !s.drifted)
    .map((s) => ({
      toolId: s.toolId,
      instanceId: s.instanceId,
      instanceName: s.name,
      configDir: s.configDir,
    }));
}

export function buildAssetDiffTarget(
  asset: Asset,
  instance: DiffInstanceRef
): DiffTarget {
  const sourceInfo = getAssetSourceInfo(asset);
  const sourcePath = sourceInfo.sourcePath;
  
  // Find the full ToolInstance to resolve the correct target path (respecting overrides)
  const toolInstances = getToolInstances();
  const toolInstance = toolInstances.find(
    (t) => t.toolId === instance.toolId && t.instanceId === instance.instanceId
  );
  
  let targetPath: string;
  if (toolInstance) {
    const targetRel = resolveAssetTarget(asset, toolInstance);
    targetPath = join(instance.configDir, targetRel);
  } else {
    // Fallback if instance not found
    targetPath = join(instance.configDir, asset.defaultTarget || asset.name);
  }

  const files: DiffFileSummary[] = [];

  if (!existsSync(sourcePath)) {
    // Source doesn't exist - can't diff
    return {
      kind: "asset",
      title: asset.name,
      instance,
      files: [],
    };
  }

  const sourceStat = statSync(sourcePath);

  if (sourceStat.isFile()) {
    // Single file asset
    const summary = buildFileSummary(asset.name, asset.name, sourcePath, targetPath);
    if (summary.linesAdded > 0 || summary.linesRemoved > 0 || summary.status !== "modified") {
      files.push(summary);
    }
  } else if (sourceStat.isDirectory()) {
    // Directory asset
    const sourceFiles = listFilesRecursive(sourcePath);
    const targetFiles = existsSync(targetPath) ? listFilesRecursive(targetPath) : [];
    const allFiles = new Set([...sourceFiles, ...targetFiles]);

    for (const relPath of allFiles) {
      const srcFile = join(sourcePath, relPath);
      const tgtFile = join(targetPath, relPath);
      const summary = buildFileSummary(
        relPath,
        relPath,
        existsSync(srcFile) ? srcFile : null,
        existsSync(tgtFile) ? tgtFile : null
      );
      // Only include files that actually differ
      if (
        summary.status !== "modified" ||
        summary.linesAdded > 0 ||
        summary.linesRemoved > 0
      ) {
        files.push(summary);
      }
    }
  }

  return {
    kind: "asset",
    title: asset.name,
    instance,
    files,
  };
}

export function buildAssetMissingSummary(
  asset: Asset,
  instance: DiffInstanceRef
): MissingSummary {
  const sourceInfo = getAssetSourceInfo(asset);
  const sourcePath = sourceInfo.sourcePath;
  const targetDir = instance.configDir;
  const targetPath = join(targetDir, asset.defaultTarget || asset.name);

  const missingFiles: string[] = [];
  const extraFiles: string[] = [];

  if (!existsSync(sourcePath)) {
    return {
      kind: "asset",
      title: asset.name,
      instance,
      missingFiles: [],
      extraFiles: [],
    };
  }

  const sourceStat = statSync(sourcePath);

  if (sourceStat.isFile()) {
    if (!existsSync(targetPath)) {
      missingFiles.push(asset.name);
    }
  } else if (sourceStat.isDirectory()) {
    const sourceFiles = listFilesRecursive(sourcePath);
    const targetFiles = existsSync(targetPath) ? listFilesRecursive(targetPath) : [];

    const sourceSet = new Set(sourceFiles);
    const targetSet = new Set(targetFiles);

    for (const f of sourceFiles) {
      if (!targetSet.has(f)) {
        missingFiles.push(f);
      }
    }
    for (const f of targetFiles) {
      if (!sourceSet.has(f)) {
        extraFiles.push(f);
      }
    }
  }

  return {
    kind: "asset",
    title: asset.name,
    instance,
    missingFiles,
    extraFiles,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build DiffTarget for a Config
// ─────────────────────────────────────────────────────────────────────────────

export function getDriftedConfigInstances(config: ConfigFile): DiffInstanceRef[] {
  const statuses = getConfigToolStatus(config, config.sourceFiles);
  return statuses
    .filter((s) => s.enabled && s.drifted)
    .map((s) => ({
      toolId: s.toolId,
      instanceId: s.instanceId,
      instanceName: s.name,
      configDir: s.configDir,
    }));
}

export function getDriftedConfigInstancesWithCounts(config: ConfigFile): DiffInstanceSummary[] {
  const statuses = getConfigToolStatus(config, config.sourceFiles);
  return statuses
    .filter((s) => s.enabled && s.drifted)
    .map((s) => {
      const instance: DiffInstanceRef = {
        toolId: s.toolId,
        instanceId: s.instanceId,
        instanceName: s.name,
        configDir: s.configDir,
      };
      const diffTarget = buildConfigDiffTarget(config, instance);
      const totalAdded = diffTarget.files.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalRemoved = diffTarget.files.reduce((sum, f) => sum + f.linesRemoved, 0);
      return { ...instance, totalAdded, totalRemoved };
    });
}

export function getMissingConfigInstances(config: ConfigFile): DiffInstanceRef[] {
  const statuses = getConfigToolStatus(config, config.sourceFiles);
  return statuses
    .filter((s) => s.enabled && !s.installed && !s.drifted)
    .map((s) => ({
      toolId: s.toolId,
      instanceId: s.instanceId,
      instanceName: s.name,
      configDir: s.configDir,
    }));
}

export function buildConfigDiffTarget(
  config: ConfigFile,
  instance: DiffInstanceRef
): DiffTarget {
  const files: DiffFileSummary[] = [];
  const sourceFiles = config.sourceFiles || [];

  for (const sf of sourceFiles) {
    const targetPath = join(instance.configDir, sf.targetPath);

    if (!existsSync(sf.sourcePath)) {
      continue; // Source doesn't exist, skip
    }

    if (!existsSync(targetPath)) {
      // Missing target - include as missing
      const summary = buildFileSummary(sf.targetPath, sf.targetPath, sf.sourcePath, null);
      files.push(summary);
      continue;
    }

    // Check if content differs by computing diff
    const summary = buildFileSummary(sf.targetPath, sf.targetPath, sf.sourcePath, targetPath);
    if (
      summary.status !== "modified" ||
      summary.linesAdded > 0 ||
      summary.linesRemoved > 0
    ) {
      files.push(summary);
    }
  }

  return {
    kind: "config",
    title: config.name,
    instance,
    files,
  };
}

export function buildConfigMissingSummary(
  config: ConfigFile,
  instance: DiffInstanceRef
): MissingSummary {
  const missingFiles: string[] = [];
  const sourceFiles = config.sourceFiles || [];

  for (const sf of sourceFiles) {
    const targetPath = join(instance.configDir, sf.targetPath);
    if (existsSync(sf.sourcePath) && !existsSync(targetPath)) {
      missingFiles.push(sf.targetPath);
    }
  }

  return {
    kind: "config",
    title: config.name,
    instance,
    missingFiles,
    extraFiles: [], // Configs don't track extras
  };
}
