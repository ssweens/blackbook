import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashFileAsync } from "./hash.js";
import { createBackup, pruneBackups } from "./backup.js";
import { isSyncNoise, atomicWriteFileSync } from "../fs-utils.js";

/** True if `a` and `b` are the same directory or one is nested inside the other. */
function pathsOverlap(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  if (ra === rb) return true;
  return ra.startsWith(rb + sep) || rb.startsWith(ra + sep);
}

export interface DirectorySyncParams {
  sourcePath: string;
  targetPath: string;
  owner: string;
  /** Number of backups to retain per file. */
  backupRetention?: number;
}

/** Recursively list all file paths relative to `dir`. */
function listFilesRecursive(dir: string, prefix = ""): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isSyncNoise(entry.name, entry.isDirectory())) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    } else if (entry.isSymbolicLink()) {
      // readdir gives the link itself; lstat would never report isFile() for a
      // symlink. Use statSync (which follows the link) to classify the TARGET,
      // and skip broken links (statSync throws) so they don't crash the scan.
      try {
        if (statSync(fullPath).isFile()) {
          results.push(relPath);
        }
      } catch {
        // Broken symlink (dangling target) — exclude from the managed file set.
      }
    }
  }
  return results;
}

export const directorySyncModule: Module<DirectorySyncParams> = {
  name: "directory-sync",

  async check(params): Promise<CheckResult> {
    const { sourcePath, targetPath } = params;

    if (!existsSync(sourcePath)) {
      // Source deleted but the tool still has the synced directory. Mirror
      // file-copy's convention: surface it as drift (target-changed) so the
      // user can pull it back, rather than silently reporting ok.
      if (existsSync(targetPath)) {
        return {
          status: "drifted",
          message: `Source directory not found: ${sourcePath}`,
          driftKind: "target-changed",
        };
      }
      return { status: "missing", message: `Source directory not found: ${sourcePath}`, driftKind: "never-synced" };
    }

    if (!existsSync(targetPath)) {
      return { status: "missing", message: `Target directory does not exist: ${targetPath}` };
    }

    // Only compare files that Blackbook manages (exist in source).
    // The target directory may contain unmanaged files — hashing the entire
    // target would always differ from the source hash, giving false "drifted".
    const sourceFiles = listFilesRecursive(sourcePath);

    for (const relPath of sourceFiles) {
      const srcFile = join(sourcePath, relPath);
      const tgtFile = join(targetPath, relPath);

      if (!existsSync(tgtFile)) {
        return { status: "drifted", message: `Target file missing: ${relPath}` };
      }

      const [srcHash, tgtHash] = await Promise.all([
        hashFileAsync(srcFile),
        hashFileAsync(tgtFile),
      ]);

      if (srcHash !== tgtHash) {
        return { status: "drifted", message: `File differs: ${relPath}` };
      }
    }

    return { status: "ok", message: "All managed files match" };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source directory not found: ${sourcePath}`, error: `Source directory not found: ${sourcePath}` };
    }

    // Reject an overlapping/nested source↔target. Unlike the old cpSync, the
    // per-file copy below has no built-in self-copy guard, so a nested pair would
    // walk freshly-written files back into the copy and grow without bound.
    if (pathsOverlap(sourcePath, targetPath)) {
      const msg = `Source and target directories overlap: ${sourcePath} ↔ ${targetPath}`;
      return { changed: false, message: msg, error: msg };
    }

    // Back up the existing target before we touch it.
    const backup = createBackup(targetPath, owner);
    pruneBackups(owner, params.backupRetention);

    // Copy each managed (source) file with an atomic per-file write (temp
    // sibling + fsync + rename via atomicWriteFileSync), mirroring glob-copy.
    // No file is ever left half-written on a mid-sync crash, and merge semantics
    // are preserved — unmanaged target-only files stay in place, matching
    // check(), which only compares files that exist in source. listFilesRecursive
    // already skips regenerated noise, so it is neither hashed nor propagated.
    mkdirSync(targetPath, { recursive: true });
    for (const relPath of listFilesRecursive(sourcePath)) {
      const src = join(sourcePath, relPath);
      const dest = join(targetPath, relPath);
      mkdirSync(dirname(dest), { recursive: true });
      atomicWriteFileSync(dest, readFileSync(src));
    }

    return {
      changed: true,
      message: `Synced directory ${sourcePath} → ${targetPath}`,
      backup: backup ?? undefined,
    };
  },
};
