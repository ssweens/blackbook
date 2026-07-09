import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashFileAsync } from "./hash.js";
import { createBackup, pruneBackups } from "./backup.js";

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

    // Create backup before overwriting
    const backup = createBackup(targetPath, owner);
    pruneBackups(owner, params.backupRetention);

    // Recursive copy (native node:fs)
    mkdirSync(targetPath, { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true, force: true });

    return {
      changed: true,
      message: `Synced directory ${sourcePath} → ${targetPath}`,
      backup: backup ?? undefined,
    };
  },
};
