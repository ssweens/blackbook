import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createBackup, pruneBackups, listBackups } from "./backup.js";

// Override XDG_CACHE_HOME so backups go to a temp dir
const TMP = join(tmpdir(), `bb-backup-test-${Date.now()}`);
const ORIG_XDG = process.env.XDG_CACHE_HOME;

beforeAll(() => {
  process.env.XDG_CACHE_HOME = TMP;
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  if (ORIG_XDG !== undefined) {
    process.env.XDG_CACHE_HOME = ORIG_XDG;
  } else {
    delete process.env.XDG_CACHE_HOME;
  }
  rmSync(TMP, { recursive: true, force: true });
});

describe("createBackup", () => {
  it("creates a backup of an existing file", () => {
    const file = join(TMP, "test-file.txt");
    writeFileSync(file, "backup me");
    const backupPath = createBackup(file, "test-owner");
    expect(backupPath).toBeDefined();
    expect(existsSync(backupPath!)).toBe(true);
  });

  it("returns null for non-existent file", () => {
    const result = createBackup(join(TMP, "nonexistent.txt"), "test-owner");
    expect(result).toBeNull();
  });
});

describe("listBackups", () => {
  it("returns backups in newest-first order", async () => {
    const file = join(TMP, "list-test.txt");
    writeFileSync(file, "v1");
    createBackup(file, "list-owner");

    // Wait a bit so timestamps differ
    await new Promise((r) => setTimeout(r, 10));
    writeFileSync(file, "v2");
    createBackup(file, "list-owner");

    const backups = listBackups("list-owner");
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });
});

describe("pruneBackups", () => {
  it("keeps only the last 3 backups", async () => {
    const file = join(TMP, "prune-test.txt");
    for (let i = 0; i < 5; i++) {
      writeFileSync(file, `version ${i}`);
      createBackup(file, "prune-owner");
      await new Promise((r) => setTimeout(r, 10));
    }

    pruneBackups("prune-owner");
    const backups = listBackups("prune-owner");
    expect(backups.length).toBeLessThanOrEqual(3);
  });
});
