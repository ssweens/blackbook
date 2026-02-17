import { existsSync, mkdirSync, cpSync } from "fs";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { hashDirectory } from "./hash.js";
import { createBackup, pruneBackups } from "./backup.js";

export interface DirectorySyncParams {
  sourcePath: string;
  targetPath: string;
  owner: string;
}

export const directorySyncModule: Module<DirectorySyncParams> = {
  name: "directory-sync",

  async check(params): Promise<CheckResult> {
    const { sourcePath, targetPath } = params;

    if (!existsSync(sourcePath)) {
      return { status: "failed", message: `Source directory not found: ${sourcePath}`, error: `Source directory not found: ${sourcePath}` };
    }

    if (!existsSync(targetPath)) {
      return { status: "missing", message: `Target directory does not exist: ${targetPath}` };
    }

    const sourceHash = hashDirectory(sourcePath);
    const targetHash = hashDirectory(targetPath);

    if (sourceHash === targetHash) {
      return { status: "ok", message: "Directories match" };
    }

    return { status: "drifted", message: "Directory contents differ" };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source directory not found: ${sourcePath}`, error: `Source directory not found: ${sourcePath}` };
    }

    // Create backup before overwriting
    const backup = createBackup(targetPath, owner);
    pruneBackups(owner);

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
