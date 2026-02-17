import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Module, CheckResult, ApplyResult } from "./types.js";

export interface SymlinkCreateParams {
  sourcePath: string;
  targetPath: string;
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

    const currentTarget = readlinkSync(targetPath);
    if (currentTarget !== sourcePath) {
      return { status: "drifted", message: `Symlink points to ${currentTarget}, expected ${sourcePath}` };
    }

    return { status: "ok", message: "Symlink is correct" };
  },

  async apply(params): Promise<ApplyResult> {
    const { sourcePath, targetPath } = params;

    if (!existsSync(sourcePath)) {
      return { changed: false, message: `Source not found: ${sourcePath}`, error: `Source not found: ${sourcePath}` };
    }

    mkdirSync(dirname(targetPath), { recursive: true });

    // Remove existing file/symlink if present
    if (existsSync(targetPath) || isSymlink(targetPath)) {
      unlinkSync(targetPath);
    }

    symlinkSync(sourcePath, targetPath);
    return { changed: true, message: `Created symlink ${targetPath} → ${sourcePath}` };
  },
};

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
