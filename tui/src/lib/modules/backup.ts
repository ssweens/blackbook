import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, statSync } from "fs";
import { join, basename } from "path";
import { getCacheDir } from "../config/path.js";

const DEFAULT_BACKUP_RETENTION = 3;

function getBackupBaseDir(): string {
  return join(getCacheDir(), "backups");
}

export function buildBackupPath(targetPath: string, owner: string): string {
  const baseDir = getBackupBaseDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(baseDir, owner, timestamp, basename(targetPath));
}

export function createBackup(targetPath: string, owner: string): string | null {
  if (!existsSync(targetPath)) return null;

  const backupPath = buildBackupPath(targetPath, owner);
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
