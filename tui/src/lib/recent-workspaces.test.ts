import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadRecentWorkspaces,
  recordRecentWorkspace,
  removeRecentWorkspace,
  recentWorkspacesPath,
} from "./recent-workspaces.js";

// Point the cache dir (XDG-aware, see getCacheDir) at a throwaway temp dir so
// these tests never touch the real ~/.cache/blackbook.
let tempDir: string;
let savedXdgCache: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "bb-recent-"));
  savedXdgCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = tempDir;
});

afterEach(() => {
  if (savedXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedXdgCache;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("recent-workspaces", () => {
  it("returns [] when the file does not exist", () => {
    expect(loadRecentWorkspaces()).toEqual([]);
  });

  it("returns [] for a corrupt or non-array file", () => {
    mkdirSync(join(tempDir, "blackbook"), { recursive: true });
    writeFileSync(recentWorkspacesPath(), "not json");
    expect(loadRecentWorkspaces()).toEqual([]);
    writeFileSync(recentWorkspacesPath(), JSON.stringify({ a: 1 }));
    expect(loadRecentWorkspaces()).toEqual([]);
  });

  it("records most-recent first and dedupes re-opened paths", () => {
    recordRecentWorkspace("/a");
    recordRecentWorkspace("/b");
    recordRecentWorkspace("/a");
    expect(loadRecentWorkspaces()).toEqual(["/a", "/b"]);
    // Persisted as JSON on disk.
    expect(JSON.parse(readFileSync(recentWorkspacesPath(), "utf-8"))).toEqual(["/a", "/b"]);
  });

  it("caps the list at 10 entries", () => {
    for (let i = 0; i < 12; i++) recordRecentWorkspace(`/dir${i}`);
    const recents = loadRecentWorkspaces();
    expect(recents).toHaveLength(10);
    expect(recents[0]).toBe("/dir11");
    expect(recents).not.toContain("/dir0");
    expect(recents).not.toContain("/dir1");
  });

  it("removeRecentWorkspace drops the entry and keeps the rest", () => {
    recordRecentWorkspace("/a");
    recordRecentWorkspace("/b");
    removeRecentWorkspace("/a");
    expect(loadRecentWorkspaces()).toEqual(["/b"]);
    // Removing an unknown path is a no-op.
    removeRecentWorkspace("/nope");
    expect(loadRecentWorkspaces()).toEqual(["/b"]);
  });
});
