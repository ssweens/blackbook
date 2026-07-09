import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { directorySyncModule } from "./directory-sync.js";

const TMP = join(tmpdir(), `bb-dir-sync-test-${Date.now()}`);
const SRC = join(TMP, "source");
const TGT = join(TMP, "target");

beforeEach(() => {
  mkdirSync(SRC, { recursive: true });
  mkdirSync(TGT, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("directorySyncModule.check", () => {
  it("returns 'missing' when target dir does not exist", async () => {
    mkdirSync(join(SRC, "subdir"), { recursive: true });
    writeFileSync(join(SRC, "subdir", "a.txt"), "hello");
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "subdir"),
      targetPath: join(TGT, "subdir"),
      owner: "test",
    });
    expect(result.status).toBe("missing");
  });

  it("returns 'ok' when directories match", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "a.txt"), "content");
    writeFileSync(join(TGT, "dir", "a.txt"), "content");
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).toBe("ok");
  });

  it("returns 'drifted' when files differ", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "a.txt"), "new");
    writeFileSync(join(TGT, "dir", "a.txt"), "old");
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).toBe("drifted");
  });

  it("returns 'drifted' when extra files in source", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "a.txt"), "content");
    writeFileSync(join(SRC, "dir", "b.txt"), "extra");
    writeFileSync(join(TGT, "dir", "a.txt"), "content");
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).toBe("drifted");
  });

  it("returns 'missing' when source does not exist", async () => {
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "nonexistent"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).toBe("missing");
  });

  it("reports drift (not ok) when source is deleted but target still exists", async () => {
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(TGT, "dir", "a.txt"), "installed");
    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "nonexistent"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("drifted");
    expect(result.driftKind).toBe("target-changed");
  });

  it("detects a working symlinked file within a synced directory", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "real.txt"), "data");
    // Relative symlink to a sibling file (resolves to content "data").
    symlinkSync("real.txt", join(SRC, "dir", "link.txt"));
    writeFileSync(join(TGT, "dir", "real.txt"), "data");
    writeFileSync(join(TGT, "dir", "link.txt"), "data");

    const inSync = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(inSync.status).toBe("ok");

    // Change the target's copy of the symlinked file — must now show as drift
    // (previously the symlinked entry was excluded from comparison entirely).
    writeFileSync(join(TGT, "dir", "link.txt"), "changed");
    const drifted = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(drifted.status).toBe("drifted");
  });

  it("does not crash on a broken symlink within a synced directory", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    mkdirSync(join(TGT, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "good.txt"), "x");
    writeFileSync(join(TGT, "dir", "good.txt"), "x");
    // Dangling symlink → statSync would throw; it must be skipped gracefully.
    symlinkSync(join(SRC, "dir", "does-not-exist.txt"), join(SRC, "dir", "broken.txt"));

    const result = await directorySyncModule.check({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.status).toBe("ok");
  });
});

describe("directorySyncModule.apply", () => {
  it("copies directory to target", async () => {
    mkdirSync(join(SRC, "dir"), { recursive: true });
    writeFileSync(join(SRC, "dir", "a.txt"), "hello");
    writeFileSync(join(SRC, "dir", "b.txt"), "world");

    const result = await directorySyncModule.apply({
      sourcePath: join(SRC, "dir"),
      targetPath: join(TGT, "dir"),
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(readFileSync(join(TGT, "dir", "a.txt"), "utf-8")).toBe("hello");
    expect(readFileSync(join(TGT, "dir", "b.txt"), "utf-8")).toBe("world");
  });

  it("handles empty source directory", async () => {
    mkdirSync(join(SRC, "empty"), { recursive: true });
    const result = await directorySyncModule.apply({
      sourcePath: join(SRC, "empty"),
      targetPath: join(TGT, "empty"),
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(existsSync(join(TGT, "empty"))).toBe(true);
  });
});
