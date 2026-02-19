/**
 * Plugin helper functions - symlinks, source paths, backup paths
 */

import {
  existsSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  rmSync,
  mkdirSync,
  realpathSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import type { Plugin, ToolInstance } from "./types.js";
import { getCacheDir } from "./config.js";
import { safePath, validatePluginName, validateMarketplaceName, validateItemName, logError } from "./validation.js";

export function getPluginsCacheDir(): string {
  return join(getCacheDir(), "plugins");
}

export function instanceKey(instance: ToolInstance): string {
  return `${instance.toolId}:${instance.instanceId}`;
}

export function getPluginSourcePath(plugin: Plugin): string | null {
  try {
    validateMarketplaceName(plugin.marketplace);
    validatePluginName(plugin.name);
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    if (existsSync(pluginDir)) {
      return pluginDir;
    }
    return null;
  } catch (error) {
    logError(`Invalid plugin source path for ${plugin.name}`, error);
    return null;
  }
}

export function buildBackupPath(
  pluginName: string,
  itemKind: string,
  itemName: string
): string {
  validatePluginName(pluginName);
  validateItemName(itemKind, itemName);
  const backupRoot = join(getCacheDir(), "backups");
  const backupPath = safePath(backupRoot, itemKind, itemName);
  mkdirSync(dirname(backupPath), { recursive: true });
  return backupPath;
}

export function buildLooseBackupPath(target: string): string {
  let backupPath = `${target}.bak`;
  let attempt = 0;
  while (existsSync(backupPath) || isSymlink(backupPath)) {
    attempt += 1;
    backupPath = `${target}.bak.${attempt}`;
  }
  return backupPath;
}

// Symlink operations

type SymlinkErrorCode =
  | "SOURCE_NOT_FOUND"
  | "TARGET_MISSING"
  | "BACKUP_FAILED"
  | "SYMLINK_FAILED"
  | "UNLINK_FAILED";

export type SymlinkResult =
  | { success: true }
  | { success: false; code: SymlinkErrorCode; message: string };

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function createSymlink(
  source: string,
  target: string,
  pluginName?: string,
  itemKind?: string,
  itemName?: string
): SymlinkResult {
  if (!existsSync(source)) {
    return { success: false, code: "SOURCE_NOT_FOUND", message: `Source not found: ${source}` };
  }

  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target)) {
      try {
        const actual = realpathSync(target);
        const expected = realpathSync(source);
        if (actual === expected) return { success: true };
      } catch (error) {
        logError(`Broken symlink at ${target}`, error);
      }
    }

    let backupPath: string;
    if (pluginName && itemKind && itemName) {
      backupPath = buildBackupPath(pluginName, itemKind, itemName);
    } else {
      backupPath = buildLooseBackupPath(target);
    }

    try {
      const tempBackup = `${backupPath}.new.${Date.now()}`;
      renameSync(target, tempBackup);
      if (existsSync(backupPath) || isSymlink(backupPath)) {
        rmSync(backupPath, { recursive: true, force: true });
      }
      renameSync(tempBackup, backupPath);
    } catch (error) {
      logError(`Failed to backup ${target}`, error);
      return { success: false, code: "BACKUP_FAILED", message: `Failed to backup ${target}` };
    }
  }

  const tmpPath = join(tmpdir(), `.tmp_${Date.now()}`);
  try {
    symlinkSync(source, tmpPath);
    renameSync(tmpPath, target);
    return { success: true };
  } catch (error) {
    logError(`Failed to create symlink ${target}`, error);
    return { success: false, code: "SYMLINK_FAILED", message: `Failed to create symlink ${target}` };
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch (error) {
        logError(`Failed to remove temp symlink ${tmpPath}`, error);
      }
    }
  }
}

export function removeSymlink(target: string): SymlinkResult {
  if (!isSymlink(target)) {
    return { success: false, code: "TARGET_MISSING", message: `Target is not a symlink: ${target}` };
  }
  try {
    unlinkSync(target);
    return { success: true };
  } catch (error) {
    logError(`Failed to remove symlink ${target}`, error);
    return { success: false, code: "UNLINK_FAILED", message: `Failed to remove symlink ${target}` };
  }
}
