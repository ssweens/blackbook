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

// Read + parse the state file with no locking. Callers that already hold the
// state lock (e.g. read-modify-write mutations) use this to avoid re-locking.
function readStateFile(path: string): SyncState {
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

export function loadState(): SyncState {
  return readStateFile(getStatePath());
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
  const path = getStatePath();
  mkdirSync(dirname(path), { recursive: true });
  // Hold a single lock across the whole read-modify-write so concurrent writers
  // cannot interleave (load old → other writer saves → we overwrite their change).
  withFileLockSync(path, () => {
    const state = readStateFile(path);
    state.files[key] = {
      sourceHash,
      targetHash,
      syncedAt: new Date().toISOString(),
      sourcePath,
      targetPath,
    };
    atomicWriteFileSync(path, JSON.stringify(state, null, 2));
  });
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
  const path = getStatePath();
  mkdirSync(dirname(path), { recursive: true });
  // Single-lock read-modify-write; see recordSync for rationale.
  withFileLockSync(path, () => {
    const state = readStateFile(path);
    delete state.files[key];
    atomicWriteFileSync(path, JSON.stringify(state, null, 2));
  });
}

export function getEntry(key: string): SyncEntry | undefined {
  const state = loadState();
  return state.files[key];
}
