import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { checkCleanup, applyCleanup } from "./cleanup.js";
import { recordSync, loadState } from "../state.js";

const TMP = join(import.meta.dirname, "__test_cleanup__");
const CACHE = join(TMP, "cache");
const TARGET_DIR = join(TMP, "target");
const ORIG_XDG = process.env.XDG_CACHE_HOME;
const ORIG_CONFIG = process.env.XDG_CONFIG_HOME;

beforeAll(() => {
  process.env.XDG_CACHE_HOME = CACHE;
  process.env.XDG_CONFIG_HOME = join(TMP, "config");
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(TARGET_DIR, { recursive: true });
  mkdirSync(join(TMP, "config", "blackbook"), { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (ORIG_XDG) process.env.XDG_CACHE_HOME = ORIG_XDG;
  else delete process.env.XDG_CACHE_HOME;
  if (ORIG_CONFIG) process.env.XDG_CONFIG_HOME = ORIG_CONFIG;
  else delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  // Clean state and target files between tests
  const statePath = join(CACHE, "blackbook", "state.json");
  if (existsSync(statePath)) rmSync(statePath);
  if (existsSync(TARGET_DIR)) {
    rmSync(TARGET_DIR, { recursive: true, force: true });
    mkdirSync(TARGET_DIR, { recursive: true });
  }
});

describe("checkCleanup", () => {
  it("returns empty when state is empty", () => {
    const result = checkCleanup();
    expect(result.orphaned).toEqual([]);
  });

  it("returns empty when all state entries match config declarations", () => {
    // Write a config with a "CLAUDE.md" file declared
    const configPath = join(TMP, "config", "blackbook", "config.yaml");
    writeFileSync(configPath, `
files:
  - name: CLAUDE.md
    source: CLAUDE.md
    target: CLAUDE.md
`);

    // Record a sync for that file
    recordSync(
      "CLAUDE.md:claude-code:default:CLAUDE.md",
      "hash1", "hash1",
      "/src/CLAUDE.md", "/tgt/CLAUDE.md"
    );

    const result = checkCleanup();
    expect(result.orphaned).toEqual([]);
  });

  it("detects orphaned entries (in state but not in config)", () => {
    // Write a config with no files
    const configPath = join(TMP, "config", "blackbook", "config.yaml");
    writeFileSync(configPath, `
files: []
`);

    // State has an entry for a file that's no longer declared
    recordSync(
      "old-file.md:claude-code:default:old-file.md",
      "hash1", "hash1",
      "/src/old-file.md", join(TARGET_DIR, "old-file.md")
    );

    const result = checkCleanup();
    expect(result.orphaned).toHaveLength(1);
    expect(result.orphaned[0].fileName).toBe("old-file.md");
    expect(result.orphaned[0].toolId).toBe("claude-code");
    expect(result.orphaned[0].instanceId).toBe("default");
  });

  it("ignores files that were never state-tracked", () => {
    // A file exists on disk but is NOT in state.json
    writeFileSync(join(TARGET_DIR, "unmanaged.md"), "user file");

    const configPath = join(TMP, "config", "blackbook", "config.yaml");
    writeFileSync(configPath, "files: []\n");

    const result = checkCleanup();
    expect(result.orphaned).toEqual([]);
    // Unmanaged file still exists
    expect(existsSync(join(TARGET_DIR, "unmanaged.md"))).toBe(true);
  });
});

describe("applyCleanup", () => {
  it("removes orphaned files and clears state entries", () => {
    const targetFile = join(TARGET_DIR, "orphan.md");
    writeFileSync(targetFile, "orphaned content");

    recordSync(
      "orphan.md:claude-code:default:orphan.md",
      "h1", "h1",
      "/src/orphan.md", targetFile
    );

    const orphans = [{
      stateKey: "orphan.md:claude-code:default:orphan.md",
      entry: loadState().files["orphan.md:claude-code:default:orphan.md"],
      fileName: "orphan.md",
      toolId: "claude-code",
      instanceId: "default",
    }];

    const result = applyCleanup(orphans);

    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);
    expect(existsSync(targetFile)).toBe(false);

    // State entry should be cleared
    const state = loadState();
    expect(state.files["orphan.md:claude-code:default:orphan.md"]).toBeUndefined();
  });

  it("clears state entry even if file is already gone", () => {
    recordSync(
      "gone.md:claude-code:default:gone.md",
      "h1", "h1",
      "/src/gone.md", join(TARGET_DIR, "gone.md") // file doesn't exist
    );

    const orphans = [{
      stateKey: "gone.md:claude-code:default:gone.md",
      entry: loadState().files["gone.md:claude-code:default:gone.md"],
      fileName: "gone.md",
      toolId: "claude-code",
      instanceId: "default",
    }];

    const result = applyCleanup(orphans);

    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);

    const state = loadState();
    expect(state.files["gone.md:claude-code:default:gone.md"]).toBeUndefined();
  });

  it("never touches unmanaged files", () => {
    const userFile = join(TARGET_DIR, "user-created.md");
    writeFileSync(userFile, "my personal notes");

    // Apply cleanup with empty orphan list
    const result = applyCleanup([]);

    expect(result.removed).toBe(0);
    expect(existsSync(userFile)).toBe(true);
  });
});
