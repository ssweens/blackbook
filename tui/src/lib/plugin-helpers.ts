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
import type { Plugin, ToolInstance, InstalledItem } from "./types.js";
import type { Manifest } from "./manifest.js";
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

/**
 * Context needed to build a per-plugin, per-tool-instance backup path. Scoping
 * the backup by BOTH the owning plugin and the specific tool instance prevents
 * one plugin's (or one instance's) backup from clobbering another's when they
 * happen to share a same-named component.
 */
export interface BackupContext {
  /** `${toolId}:${instanceId}` — see instanceKey(). */
  instanceScope: string;
  pluginName: string;
  itemKind: string;
  itemName: string;
}

export function buildBackupPath(
  instanceScope: string,
  pluginName: string,
  itemKind: string,
  itemName: string
): string {
  validatePluginName(pluginName);
  validateItemName(itemKind, itemName);
  // instanceScope is derived from internal tool config (not untrusted input),
  // but safePath still guards against traversal via `..`, slashes, or NUL.
  const backupRoot = join(getCacheDir(), "backups");
  const backupPath = safePath(backupRoot, instanceScope, pluginName, itemKind, itemName);
  mkdirSync(dirname(backupPath), { recursive: true });
  return backupPath;
}

// ── Manifest item keys ────────────────────────────────────────────────────────
// Manifest items are keyed by owner so that same-named components shipped by two
// different plugins never collide. Older manifests used the un-owned
// `"<kind>:<name>"` form; migrateManifestKeys() rewrites those on load.

const UNOWNED_MANIFEST_OWNER = "__unowned__";

export function buildManifestItemKey(
  owner: string | undefined,
  kind: string,
  name: string
): string {
  const ownerKey = owner && owner.length > 0 ? owner : UNOWNED_MANIFEST_OWNER;
  return `${ownerKey}:${kind}:${name}`;
}

function appendChain(
  head: InstalledItem | null,
  tail: InstalledItem | null
): InstalledItem | null {
  if (!head) return tail;
  let node = head;
  while (node.previous) node = node.previous;
  node.previous = tail;
  return head;
}

/**
 * Insert `item` (which may carry a `previous` chain of mixed owners) into the
 * rebuilt owner-keyed map. Entries in the `previous` chain that belong to a
 * DIFFERENT owner are detached and promoted to their own top-level owner-keyed
 * entry, so uninstalling that other owner can still find them. Returns the
 * canonical key the (top-level) item was stored under.
 */
function insertMigratedItem(
  rebuilt: Record<string, InstalledItem>,
  item: InstalledItem
): string {
  const key = buildManifestItemKey(item.owner, item.kind, item.name);

  const kept: InstalledItem[] = [];
  const detached: InstalledItem[] = [];
  let cur: InstalledItem | null | undefined = item.previous;
  while (cur) {
    const next: InstalledItem | null | undefined = cur.previous;
    const node: InstalledItem = { ...cur, previous: null };
    if (buildManifestItemKey(cur.owner, cur.kind, cur.name) === key) {
      kept.push(node);
    } else {
      detached.push(node);
    }
    cur = next;
  }

  // Rebuild the same-owner nested chain, preserving original order.
  let nested: InstalledItem | null = null;
  for (let i = kept.length - 1; i >= 0; i--) {
    kept[i].previous = nested;
    nested = kept[i];
  }

  const normalized: InstalledItem = { ...item, previous: nested };
  if (rebuilt[key]) {
    // Two distinct chains resolve to the same owner key — chain rather than drop.
    normalized.previous = appendChain(normalized.previous ?? null, rebuilt[key]);
  }
  rebuilt[key] = normalized;

  for (const d of detached) insertMigratedItem(rebuilt, d);
  return key;
}

/**
 * Migrate a manifest's item keys from the legacy `"<kind>:<name>"` form to the
 * owner-scoped `"<owner>:<kind>:<name>"` form, in place. Entries with no
 * recorded owner are preserved under an `__unowned__` fallback (never dropped).
 * Returns true if any key changed. Idempotent.
 */
export function migrateManifestKeys(manifest: Manifest): boolean {
  let changed = false;
  for (const toolKey of Object.keys(manifest.tools)) {
    const toolEntry = manifest.tools[toolKey];
    if (!toolEntry || !toolEntry.items) continue;
    const rebuilt: Record<string, InstalledItem> = {};
    for (const [oldKey, item] of Object.entries(toolEntry.items)) {
      const canonicalKey = insertMigratedItem(rebuilt, item);
      if (canonicalKey !== oldKey) changed = true;
    }
    toolEntry.items = rebuilt;
  }
  return changed;
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
  backup?: BackupContext
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
    if (backup) {
      backupPath = buildBackupPath(backup.instanceScope, backup.pluginName, backup.itemKind, backup.itemName);
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
