import { existsSync, unlinkSync } from "fs";
import { loadState, clearEntry, type SyncEntry } from "../state.js";
import { loadConfig } from "../config/loader.js";
import { createBackup, pruneBackups } from "./backup.js";

export interface OrphanedFile {
  stateKey: string;
  entry: SyncEntry;
  /** Parsed from key: "fileName:toolId:instanceId:targetRelPath" */
  fileName: string;
  toolId: string;
  instanceId: string;
}

export interface CleanupCheckResult {
  orphaned: OrphanedFile[];
}

/**
 * Detect orphaned files: entries in state.json that no longer have
 * a matching declaration in config.yaml.
 *
 * Only state-tracked files are candidates. Files never managed by
 * Blackbook (not in state) are invisible to cleanup.
 */
export function checkCleanup(): CleanupCheckResult {
  const state = loadState();
  const configResult = loadConfig();

  // Build a set of declared file names from config
  const declaredNames = new Set<string>();
  if (configResult.errors.length === 0) {
    for (const file of configResult.config.files) {
      declaredNames.add(file.name);
    }
  }

  const orphaned: OrphanedFile[] = [];

  for (const [key, entry] of Object.entries(state.files)) {
    // Key format: "fileName:toolId:instanceId:targetRelPath"
    const parts = key.split(":");
    if (parts.length < 3) continue;

    const fileName = parts[0];

    if (!declaredNames.has(fileName)) {
      orphaned.push({
        stateKey: key,
        entry,
        fileName,
        toolId: parts[1],
        instanceId: parts[2],
      });
    }
  }

  return { orphaned };
}

export interface CleanupApplyResult {
  removed: number;
  errors: string[];
}

/**
 * Remove orphaned files from target instances.
 * Creates backup before removal and clears state entries.
 */
export function applyCleanup(orphans: OrphanedFile[]): CleanupApplyResult {
  let removed = 0;
  const errors: string[] = [];

  for (const orphan of orphans) {
    const targetPath = orphan.entry.targetPath;

    try {
      if (existsSync(targetPath)) {
        // Backup before removal
        createBackup(targetPath, `cleanup:${orphan.fileName}`);
        pruneBackups(`cleanup:${orphan.fileName}`);
        unlinkSync(targetPath);
      }

      // Clear state entry regardless (file might already be gone)
      clearEntry(orphan.stateKey);
      removed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to clean up ${targetPath}: ${msg}`);
    }
  }

  return { removed, errors };
}
