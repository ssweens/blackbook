import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, statSync } from "fs";
import { join, basename } from "path";
import { getCacheDir } from "../config/path.js";

const DEFAULT_BACKUP_RETENTION = 3;

function getBackupBaseDir(): string {
  return join(getCacheDir(), "backups");
}

export interface BackupOptions {
  /**
   * Shared run identifier so a batch of backups (e.g. every file matched by one
   * glob operation) lands in ONE timestamp directory and is pruned as a single
   * unit. Defaults to a fresh per-call timestamp. Use `newBackupRun()`.
   */
  timestamp?: string;
  /**
   * Path (relative to the timestamp directory) at which to store the backup,
   * preserving subdirectory structure so files that share a basename in
   * different subdirectories don't collide. Defaults to `basename(targetPath)`.
   */
  relName?: string;
}

/** Create a run identifier for backing up a batch of files into one directory. */
export function newBackupRun(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildBackupPath(targetPath: string, owner: string, options?: BackupOptions): string {
  const baseDir = getBackupBaseDir();
  const timestamp = options?.timestamp ?? newBackupRun();
  const relName = options?.relName ?? basename(targetPath);
  return join(baseDir, owner, timestamp, relName);
}

export function createBackup(targetPath: string, owner: string, options?: BackupOptions): string | null {
  if (!existsSync(targetPath)) return null;

  const backupPath = buildBackupPath(targetPath, owner, options);
  const backupDir = join(backupPath, "..");
  mkdirSync(backupDir, { recursive: true });

  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    cpSync(targetPath, backupPath, { recursive: true });
  } else {
    cpSync(targetPath, backupPath);
  }

  return backupPath;
}

export function pruneBackups(owner: string, retention?: number): void {
  const limit = retention ?? DEFAULT_BACKUP_RETENTION;
  const ownerDir = join(getBackupBaseDir(), owner);
  if (!existsSync(ownerDir)) return;

  const entries = readdirSync(ownerDir)
    .filter((name) => {
      const fullPath = join(ownerDir, name);
      return statSync(fullPath).isDirectory();
    })
    .sort()
    .reverse(); // Newest first (ISO timestamps sort lexicographically)

  // Remove entries beyond retention limit
  for (const entry of entries.slice(limit)) {
    rmSync(join(ownerDir, entry), { recursive: true, force: true });
  }
}

export function listBackups(owner: string): string[] {
  const ownerDir = join(getBackupBaseDir(), owner);
  if (!existsSync(ownerDir)) return [];

  return readdirSync(ownerDir)
    .filter((name) => statSync(join(ownerDir, name)).isDirectory())
    .sort()
    .reverse()
    .map((name) => join(ownerDir, name));
}
