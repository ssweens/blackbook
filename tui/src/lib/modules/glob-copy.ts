import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, basename, join, relative } from "node:path";
import fg from "fast-glob";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashFileAsync } from "./hash.js";
import { createBackup, pruneBackups, newBackupRun } from "./backup.js";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface GlobCopyParams {
  /** Absolute (or home/relative resolved) glob pattern for the source files. */
  sourcePath: string;
  /** Target path. Must be a directory when sourcePath matches multiple files. */
  targetPath: string;
  owner: string;
  /** When true, copy from targetPath back into the directory containing sourcePath. */
  pullback?: boolean;
  /** Number of backups to retain per file. */
  backupRetention?: number;
}

function isGlobPath(pathValue: string): boolean {
  return /[*?\[{]/.test(pathValue);
}

function globBaseDir(pattern: string): string {
  const idx = pattern.search(/[*?\[{]/);
  if (idx === -1) return dirname(pattern);
  return dirname(pattern.slice(0, idx));
}

function listSourceMatches(pattern: string): string[] {
  return fg.sync(pattern, {
    onlyFiles: true,
    dot: true,
    unique: true,
    followSymbolicLinks: true,
  });
}

function listTargetMatches(targetDir: string, fileNamePattern: string): string[] {
  // fileNamePattern is like "settings*"; match within a directory.
  const pattern = join(targetDir, fileNamePattern);
  return listSourceMatches(pattern);
}

export const globCopyModule: Module<GlobCopyParams> = {
  name: "glob-copy",

  async check(params): Promise<CheckResult> {
    const { sourcePath, targetPath, pullback } = params;

    if (!isGlobPath(sourcePath)) {
      return {
        status: "failed",
        message: `glob-copy requires a glob sourcePath, got: ${sourcePath}`,
        error: `glob-copy requires a glob sourcePath, got: ${sourcePath}`,
      };
    }

    // For pullback checks, we treat the *target* as the authoritative source.
    // But for UI status purposes we still want to report missing/drift.
    const baseDir = globBaseDir(sourcePath);
    const filePattern = basename(sourcePath);

    const sources = pullback
      ? listTargetMatches(targetPath, filePattern)
      : listSourceMatches(sourcePath);

    if (sources.length === 0) {
      // A glob may legitimately match 0 files in the repo while the tool has an
      // installed target (so we can pull back). Don't treat this as fatal.
      if (existsSync(targetPath)) {
        // Forward direction: the source pattern matched nothing, but the tool
        // side may still hold files that were previously synced. Mirror
        // file-copy's convention and surface this as drift (target-changed) so
        // the user can pull them back, instead of silently reporting ok.
        if (!pullback) {
          const orphans = listTargetMatches(targetPath, filePattern);
          if (orphans.length > 0) {
            return {
              status: "drifted",
              message: `Source matched 0 files but ${orphans.length} target file(s) exist for ${filePattern}`,
              driftKind: "target-changed",
            };
          }
        }

        const msg = pullback
          ? `No target files match ${filePattern} in ${targetPath}`
          : `Source pattern matched 0 files: ${sourcePath}`;
        return { status: "ok", message: msg };
      }

      const msg = pullback
        ? `No target files match ${filePattern} in ${targetPath}`
        : `Source pattern matched 0 files: ${sourcePath}`;
      return { status: "missing", message: msg, driftKind: "never-synced" as any };
    }

    // Map each match to its counterpart using the path RELATIVE to the glob
    // base directory so nested subdirectories are preserved (not flattened to a
    // shared directory where same-basename files would collide).
    let anyMissing = false;
    let anyDrifted = false;

    for (const match of sources) {
      const srcFile = pullback ? join(baseDir, relative(targetPath, match)) : match;
      const tgtFile = pullback ? match : join(targetPath, relative(baseDir, match));

      if (!existsSync(tgtFile)) {
        anyMissing = true;
        continue;
      }
      if (!existsSync(srcFile)) {
        // In pullback mode, srcFile may not exist yet; treat as drifted/missing-to-source.
        anyMissing = true;
        continue;
      }

      const srcHash = await hashFileAsync(srcFile);
      const tgtHash = await hashFileAsync(tgtFile);
      if (srcHash !== tgtHash) {
        anyDrifted = true;
      }
    }

    if (anyMissing) {
      return { status: "missing", message: "One or more target files are missing" };
    }
    if (anyDrifted) {
      return { status: "drifted", message: "One or more files differ" };
    }
    return { status: "ok", message: "Files match" };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner, pullback, backupRetention } = params;

    if (!isGlobPath(sourcePath)) {
      return {
        changed: false,
        message: `glob-copy requires a glob sourcePath, got: ${sourcePath}`,
        error: `glob-copy requires a glob sourcePath, got: ${sourcePath}`,
      };
    }

    const baseDir = globBaseDir(sourcePath);
    const filePattern = basename(sourcePath);

    const sources = pullback
      ? listTargetMatches(targetPath, filePattern)
      : listSourceMatches(sourcePath);

    if (sources.length === 0) {
      const msg = pullback
        ? `No target files match ${filePattern} in ${targetPath}`
        : `Source pattern matched 0 files: ${sourcePath}`;
      return { changed: false, message: msg, error: msg };
    }

    let changed = false;

    // Share ONE run identifier across every file in this glob operation so all
    // backups land in a single timestamp directory and are pruned as a unit.
    // Pruning per-file with a shared owner would otherwise delete backups made
    // moments earlier in this same run (retention counts timestamp dirs).
    const runId = newBackupRun();

    for (const match of sources) {
      // Map source→target (or target→source in pullback) using the path
      // RELATIVE to the glob base directory so subdirectory structure is
      // preserved and same-basename files in different subdirs don't collide.
      const from = match;
      const to = pullback
        ? join(baseDir, relative(targetPath, match))
        : join(targetPath, relative(baseDir, match));

      if (!existsSync(from)) {
        continue;
      }

      // Backup before overwriting. Preserve the relative path within the run
      // directory so nested files with the same basename don't overwrite each
      // other's backup. Prune once, after the whole run (below).
      const relName = pullback ? relative(baseDir, to) : relative(targetPath, to);
      createBackup(to, owner, { timestamp: runId, relName });

      // Ensure destination directory exists.
      mkdirSync(dirname(to), { recursive: true });

      // Copy content atomically (byte-safe: read as Buffer to avoid corrupting binary files).
      const content = readFileSync(from);
      atomicWriteFileSync(to, content);
      changed = true;
    }

    // Prune once, after all files in this run are backed up.
    pruneBackups(owner, backupRetention);

    return {
      changed,
      message: pullback
        ? `Pulled back ${sources.length} file(s) from ${targetPath} → ${baseDir}`
        : `Copied ${sources.length} file(s) ${sourcePath} → ${targetPath}`,
    };
  },
};
