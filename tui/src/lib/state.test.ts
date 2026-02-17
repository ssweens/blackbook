import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  loadState,
  saveState,
  recordSync,
  detectDrift,
  clearEntry,
  getEntry,
  buildStateKey,
} from "./state.js";

const TMP = join(import.meta.dirname, "__test_state__");
const ORIG_XDG = process.env.XDG_CACHE_HOME;

beforeAll(() => {
  process.env.XDG_CACHE_HOME = TMP;
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (ORIG_XDG) {
    process.env.XDG_CACHE_HOME = ORIG_XDG;
  } else {
    delete process.env.XDG_CACHE_HOME;
  }
});

afterEach(() => {
  // Clean state file between tests
  const statePath = join(TMP, "blackbook", "state.json");
  if (existsSync(statePath)) {
    rmSync(statePath);
  }
});

describe("buildStateKey", () => {
  it("builds a colon-separated key", () => {
    const key = buildStateKey("CLAUDE.md", "claude-code", "default", "CLAUDE.md");
    expect(key).toBe("CLAUDE.md:claude-code:default:CLAUDE.md");
  });
});

describe("loadState / saveState", () => {
  it("returns empty state when no file exists", () => {
    const state = loadState();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
  });

  it("round-trips state through save and load", () => {
    const state = {
      version: 1 as const,
      files: {
        "CLAUDE.md:claude-code:default:CLAUDE.md": {
          sourceHash: "abc123",
          targetHash: "abc123",
          syncedAt: "2026-02-17T00:00:00.000Z",
          sourcePath: "/home/user/dotfiles/CLAUDE.md",
          targetPath: "/home/user/.claude/CLAUDE.md",
        },
      },
    };
    saveState(state);
    const loaded = loadState();
    expect(loaded).toEqual(state);
  });

  it("returns empty state for corrupt JSON", () => {
    const statePath = join(TMP, "blackbook", "state.json");
    mkdirSync(join(TMP, "blackbook"), { recursive: true });
    const { writeFileSync } = require("fs");
    writeFileSync(statePath, "not json");
    const state = loadState();
    expect(state.version).toBe(1);
    expect(state.files).toEqual({});
  });
});

describe("recordSync", () => {
  it("records a sync entry with timestamp", () => {
    const key = "test:claude-code:default:test.md";
    recordSync(key, "src_hash", "tgt_hash", "/src/test.md", "/tgt/test.md");

    const entry = getEntry(key);
    expect(entry).toBeDefined();
    expect(entry!.sourceHash).toBe("src_hash");
    expect(entry!.targetHash).toBe("tgt_hash");
    expect(entry!.sourcePath).toBe("/src/test.md");
    expect(entry!.targetPath).toBe("/tgt/test.md");
    expect(entry!.syncedAt).toBeTruthy();
  });

  it("overwrites existing entry on re-sync", () => {
    const key = "test:claude-code:default:test.md";
    recordSync(key, "old_hash", "old_hash", "/src/test.md", "/tgt/test.md");
    recordSync(key, "new_hash", "new_hash", "/src/test.md", "/tgt/test.md");

    const entry = getEntry(key);
    expect(entry!.sourceHash).toBe("new_hash");
  });
});

describe("detectDrift", () => {
  const key = "drift:claude-code:default:file.md";

  it("returns never-synced when no state entry exists", () => {
    const kind = detectDrift(key, "any", "any");
    expect(kind).toBe("never-synced");
  });

  it("returns in-sync when hashes match state", () => {
    recordSync(key, "aaa", "aaa", "/s", "/t");
    const kind = detectDrift(key, "aaa", "aaa");
    expect(kind).toBe("in-sync");
  });

  it("returns source-changed when only source differs", () => {
    recordSync(key, "aaa", "aaa", "/s", "/t");
    const kind = detectDrift(key, "bbb", "aaa");
    expect(kind).toBe("source-changed");
  });

  it("returns target-changed when only target differs", () => {
    recordSync(key, "aaa", "aaa", "/s", "/t");
    const kind = detectDrift(key, "aaa", "bbb");
    expect(kind).toBe("target-changed");
  });

  it("returns both-changed when both differ", () => {
    recordSync(key, "aaa", "aaa", "/s", "/t");
    const kind = detectDrift(key, "bbb", "ccc");
    expect(kind).toBe("both-changed");
  });
});

describe("clearEntry", () => {
  it("removes an entry from state", () => {
    const key = "clear:claude-code:default:file.md";
    recordSync(key, "aaa", "aaa", "/s", "/t");
    expect(getEntry(key)).toBeDefined();

    clearEntry(key);
    expect(getEntry(key)).toBeUndefined();
  });

  it("is a no-op for non-existent keys", () => {
    clearEntry("nonexistent:key");
    const state = loadState();
    expect(state.version).toBe(1);
  });
});
