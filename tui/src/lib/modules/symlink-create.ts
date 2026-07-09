import { existsSync, lstatSync, readlinkSync, realpathSync, symlinkSync, unlinkSync, mkdirSync } from "fs";
import { dirname, basename } from "path";
import type { Module, CheckResult, ApplyResult } from "./types.js";
import { createBackup } from "./backup.js";

export interface SymlinkCreateParams {
  sourcePath: string;
  targetPath: string;
  /** Namespace for backups taken before replacing an existing target. */
  owner?: string;
}

export const symlinkCreateModule: Module<SymlinkCreateParams> = {
  name: "symlink-create",

  async check(params): Promise<CheckResult> {
    const { sourcePath, targetPath } = params;

    if (!existsSync(sourcePath)) {
      return { status: "failed", message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    if (!existsSync(targetPath) && !isSymlink(targetPath)) {
      return { status: "missing", message: `Symlink does not exist: ${targetPath}` };
    }

    if (!isSymlink(targetPath)) {
      return { status: "drifted", message: `Target exists but is not a symlink: ${targetPath}` };
    }

    // Compare by resolved real path, not by the raw link string. A relative
    // symlink (or one that reaches the source through other symlinks) points to
    // the right file even though readlink() != sourcePath; string comparison
    // would report it as perpetually drifted.
    try {
      if (realpathSync(targetPath) !== realpathSync(sourcePath)) {
        const currentTarget = readlinkSync(targetPath);
        return { status: "drifted", message: `Symlink points to ${currentTarget}, expected ${sourcePath}` };
      }
    } catch {
      // realpathSync throws when the link is broken (dangling target).
      return { status: "drifted", message: `Symlink target could not be resolved: ${targetPath}` };
    }

    return { status: "ok", message: "Symlink is correct" };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath, owner } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    mkdirSync(dirname(targetPath), { recursive: true });

    // Remove existing file/symlink if present. Back up real content first so a
    // user's existing file isn't destroyed with no recovery path (every other
    // sync module backs up the target before overwriting it).
    let backup: string | null = null;
    if (existsSync(targetPath) || isSymlink(targetPath)) {
      backup = createBackup(targetPath, owner ?? `symlink:${basename(targetPath)}`);
      unlinkSync(targetPath);
    }

    symlinkSync(sourcePath, targetPath);
    return {
      changed: true,
      message: `Created symlink ${targetPath} → ${sourcePath}`,
      backup: backup ?? undefined,
    };
  },
};

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
