import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createTwoFilesPatch } from "diff";
import { readFileSync } from "fs";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashFile } from "./hash.js";
import { createBackup, pruneBackups } from "./backup.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import { detectDrift, recordSync } from "../state.js";

export interface FileCopyParams {
  sourcePath: string;
  targetPath: string;
  owner: string;
  /** When set, enables three-way state tracking for pullback detection. */
  stateKey?: string;
  /** When true, this file supports pullback (target → source). */
  pullback?: boolean;
}

function readTextSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export const fileCopyModule: Module<FileCopyParams> = {
  name: "file-copy",

  async check(params): Promise<CheckResult> {
    const { sourcePath, targetPath, stateKey, pullback } = params;

    if (!existsSync(sourcePath)) {
      return { status: "failed", message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    if (!existsSync(targetPath)) {
      return {
        status: "missing",
        message: `Target does not exist: ${targetPath}`,
        driftKind: "never-synced",
      };
    }

    const sourceHash = hashFile(sourcePath);
    const targetHash = hashFile(targetPath);

    if (sourceHash === targetHash) {
      return { status: "ok", message: "Files match", driftKind: "in-sync" };
    }

    // Three-way state detection for pullback-enabled files
    if (stateKey && pullback) {
      const driftKind = detectDrift(stateKey, sourceHash, targetHash);

      if (driftKind === "target-changed") {
        const oldText = readTextSafe(sourcePath);
        const newText = readTextSafe(targetPath);
        const diff = createTwoFilesPatch("source", "target (changed)", oldText, newText, "", "", { context: 3 });
        return { status: "drifted", message: "Target changed (pullback available)", diff, driftKind };
      }

      if (driftKind === "both-changed") {
        const oldText = readTextSafe(targetPath);
        const newText = readTextSafe(sourcePath);
        const diff = createTwoFilesPatch("target", "source", oldText, newText, "", "", { context: 3 });
        return { status: "drifted", message: "Both source and target changed (conflict)", diff, driftKind };
      }

      // source-changed or never-synced: standard forward sync
      const oldText = readTextSafe(targetPath);
      const newText = readTextSafe(sourcePath);
      const diff = createTwoFilesPatch("target", "source", oldText, newText, "", "", { context: 3 });
      return { status: "drifted", message: "Source changed", diff, driftKind };
    }

    // Standard two-way comparison (no pullback)
    const oldText = readTextSafe(targetPath);
    const newText = readTextSafe(sourcePath);
    const diff = createTwoFilesPatch("target", "source", oldText, newText, "", "", { context: 3 });

    return { status: "drifted", message: "Files differ", diff };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner, stateKey } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    // Create backup before overwriting
    const backup = createBackup(targetPath, owner);
    pruneBackups(owner);

    // Ensure target directory exists
    mkdirSync(dirname(targetPath), { recursive: true });

    // Atomic write
    const content = readFileSync(sourcePath, "utf-8");
    atomicWriteFileSync(targetPath, content);

    // Record sync state for three-way tracking
    if (stateKey) {
      const sourceHash = hashFile(sourcePath);
      const targetHash = hashFile(targetPath);
      recordSync(stateKey, sourceHash, targetHash, sourcePath, targetPath);
    }

    return {
      changed: true,
      message: `Copied ${sourcePath} → ${targetPath}`,
      backup: backup ?? undefined,
    };
  },
};

/**
 * Apply pullback: copy target → source and update state.
 * This is separate from the standard apply() which copies source → target.
 */
export async function applyPullback(params: FileCopyParams): Promise<ApplyResult> {
  const { sourcePath, targetPath, owner, stateKey } = params;

  if (!existsSync(targetPath)) {
    return { changed: false, message: `Target not found: ${targetPath}`, error: `Target not found: ${targetPath}` };
  }

  // Backup source before overwriting
  const backup = createBackup(sourcePath, owner);
  pruneBackups(owner);

  // Ensure source directory exists
  mkdirSync(dirname(sourcePath), { recursive: true });

  // Copy target → source
  const content = readFileSync(targetPath, "utf-8");
  atomicWriteFileSync(sourcePath, content);

  // Record new state (after pullback, source and target are identical)
  if (stateKey) {
    const hash = hashFile(sourcePath);
    recordSync(stateKey, hash, hash, sourcePath, targetPath);
  }

  return {
    changed: true,
    message: `Pulled back ${targetPath} → ${sourcePath}`,
    backup: backup ?? undefined,
  };
}
