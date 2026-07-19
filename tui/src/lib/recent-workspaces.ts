import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCacheDir } from "./config.js";

/**
 * Recently-opened transient workspaces (dirs opened via `openWorkspace` that
 * aren't registered in config.yaml). Persisted as a small JSON array of
 * absolute paths, most-recent first, so they reappear in the Projects tab
 * across sessions without being written into config.
 */

const MAX_RECENT_WORKSPACES = 10;

export function recentWorkspacesPath(): string {
  return join(getCacheDir(), "recent-workspaces.json");
}

/** Absolute workspace paths, most-recent first. Missing/corrupt file → []. */
export function loadRecentWorkspaces(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(recentWorkspacesPath(), "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

function saveRecentWorkspaces(paths: string[]): void {
  // Best-effort persistence: recents are a convenience cache, never worth
  // failing the calling action over.
  try {
    mkdirSync(getCacheDir(), { recursive: true });
    writeFileSync(recentWorkspacesPath(), `${JSON.stringify(paths, null, 2)}\n`);
  } catch {
    /* ignore */
  }
}

/** Move `path` to the front of the recents list (deduped, capped). */
export function recordRecentWorkspace(path: string): void {
  const next = [path, ...loadRecentWorkspaces().filter((p) => p !== path)];
  saveRecentWorkspaces(next.slice(0, MAX_RECENT_WORKSPACES));
}

/** Drop `path` from the recents list. */
export function removeRecentWorkspace(path: string): void {
  const current = loadRecentWorkspaces();
  const next = current.filter((p) => p !== path);
  if (next.length !== current.length) saveRecentWorkspaces(next);
}
