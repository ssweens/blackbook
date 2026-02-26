import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getCacheDir } from "./config/path.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";

export interface SyncEntry {
  sourceHash: string;
  targetHash: string;
  syncedAt: string;
  sourcePath: string;
  targetPath: string;
}

export interface SyncState {
  version: 1;
  files: Record<string, SyncEntry>;
}

export type DriftKind =
  | "in-sync"
  | "source-changed"
  | "target-changed"
  | "both-changed"
  | "never-synced";

function getStatePath(): string {
  return join(getCacheDir(), "state.json");
}

export function loadState(): SyncState {
  const path = getStatePath();
  if (!existsSync(path)) {
    return { version: 1, files: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (data.version !== 1 || typeof data.files !== "object") {
      return { version: 1, files: {} };
    }
    return data as SyncState;
  } catch {
    return { version: 1, files: {} };
  }
}

export function saveState(state: SyncState): void {
  const path = getStatePath();
  mkdirSync(dirname(path), { recursive: true });
  withFileLockSync(path, () => {
    atomicWriteFileSync(path, JSON.stringify(state, null, 2));
  });
}

export function buildStateKey(
  fileName: string,
  toolId: string,
  instanceId: string,
  targetRelPath: string,
): string {
  return `${fileName}:${toolId}:${instanceId}:${targetRelPath}`;
}

export function recordSync(
  key: string,
  sourceHash: string,
  targetHash: string,
  sourcePath: string,
  targetPath: string,
): void {
  const state = loadState();
  state.files[key] = {
    sourceHash,
    targetHash,
    syncedAt: new Date().toISOString(),
    sourcePath,
    targetPath,
  };
  saveState(state);
}

export function detectDrift(
  key: string,
  currentSourceHash: string,
  currentTargetHash: string,
): DriftKind {
  const state = loadState();
  const entry = state.files[key];

  if (!entry) {
    return "never-synced";
  }

  const sourceChanged = currentSourceHash !== entry.sourceHash;
  const targetChanged = currentTargetHash !== entry.targetHash;

  if (!sourceChanged && !targetChanged) return "in-sync";
  if (sourceChanged && !targetChanged) return "source-changed";
  if (!sourceChanged && targetChanged) return "target-changed";
  return "both-changed";
}

export function clearEntry(key: string): void {
  const state = loadState();
  delete state.files[key];
  saveState(state);
}

export function getEntry(key: string): SyncEntry | undefined {
  const state = loadState();
  return state.files[key];
}
