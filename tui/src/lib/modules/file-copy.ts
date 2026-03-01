import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createTwoFilesPatch } from "diff";
import { readFileSync } from "fs";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashFile, hashFileAsync } from "./hash.js";
import { createBackup, pruneBackups } from "./backup.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import { detectDrift, recordSync } from "../state.js";

export interface FileCopyParams {
  sourcePath: string;
  targetPath: string;
  owner: string;
  /** When set, enables three-way state tracking for drift detection. */
  stateKey?: string;
  /** Number of backups to retain per file. */
  backupRetention?: number;
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
    const { sourcePath, targetPath, stateKey } = params;

    if (!existsSync(sourcePath)) {
      // Source may legitimately be empty/missing while the tool still has a
      // working installed target. Show as drifted so the UI can offer pullback.
      if (existsSync(targetPath)) {
        return {
          status: "drifted",
          message: `Source not found: ${sourcePath}`,
          driftKind: "target-changed",
        };
      }

      return {
        status: "missing",
        message: `Source not found: ${sourcePath}`,
        driftKind: "never-synced",
      };
    }

    if (!existsSync(targetPath)) {
      return {
        status: "missing",
        message: `Target does not exist: ${targetPath}`,
        driftKind: "never-synced",
      };
    }

    const sourceHash = await hashFileAsync(sourcePath);
    const targetHash = await hashFileAsync(targetPath);

    if (sourceHash === targetHash) {
      return { status: "ok", message: "Files match", driftKind: "in-sync" };
    }

    // Three-way state detection when state key is available
    if (stateKey) {
      const driftKind = detectDrift(stateKey, sourceHash, targetHash);

      if (driftKind === "target-changed") {
        const oldText = readTextSafe(sourcePath);
        const newText = readTextSafe(targetPath);
        const diff = createTwoFilesPatch("source", "target (changed)", oldText, newText, "", "", { context: 3 });
        return { status: "drifted", message: "Target changed", diff, driftKind };
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

    // No state key — two-way comparison only
    const oldText = readTextSafe(targetPath);
    const newText = readTextSafe(sourcePath);
    const diff = createTwoFilesPatch("target", "source", oldText, newText, "", "", { context: 3 });

    return { status: "drifted", message: "Files differ", diff };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner, stateKey, backupRetention } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    // Create backup before overwriting
    const backup = createBackup(targetPath, owner);
    pruneBackups(owner, backupRetention);

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
  const { sourcePath, targetPath, owner, stateKey, backupRetention } = params;

  if (!existsSync(targetPath)) {
    return { changed: false, message: `Target not found: ${targetPath}`, error: `Target not found: ${targetPath}` };
  }

  // Backup source before overwriting
  const backup = createBackup(sourcePath, owner);
  pruneBackups(owner, backupRetention);

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
