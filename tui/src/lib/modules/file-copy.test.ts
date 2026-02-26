import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileCopyModule, applyPullback } from "./file-copy.js";
import { recordSync, loadState } from "../state.js";

const TMP = join(tmpdir(), `bb-file-copy-test-${Date.now()}`);
const SRC = join(TMP, "source");
const TGT = join(TMP, "target");
const CACHE = join(TMP, "cache");
const ORIG_XDG = process.env.XDG_CACHE_HOME;

beforeAll(() => {
  process.env.XDG_CACHE_HOME = CACHE;
});

afterAll(() => {
  if (ORIG_XDG) {
    process.env.XDG_CACHE_HOME = ORIG_XDG;
  } else {
    delete process.env.XDG_CACHE_HOME;
  }
});

beforeEach(() => {
  mkdirSync(SRC, { recursive: true });
  mkdirSync(TGT, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("fileCopyModule.check", () => {
  it("returns 'missing' when target does not exist", async () => {
    writeFileSync(join(SRC, "a.txt"), "hello");
    const result = await fileCopyModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.status).toBe("missing");
  });

  it("returns 'ok' when files match", async () => {
    writeFileSync(join(SRC, "a.txt"), "hello");
    writeFileSync(join(TGT, "a.txt"), "hello");
    const result = await fileCopyModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.status).toBe("ok");
  });

  it("returns 'drifted' when files differ", async () => {
    writeFileSync(join(SRC, "a.txt"), "new content");
    writeFileSync(join(TGT, "a.txt"), "old content");
    const result = await fileCopyModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.status).toBe("drifted");
    expect(result.diff).toBeDefined();
  });

  it("returns 'failed' when source does not exist", async () => {
    const result = await fileCopyModule.check({
      sourcePath: join(SRC, "nonexistent.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
  });
});

describe("fileCopyModule.apply", () => {
  it("copies file to target", async () => {
    writeFileSync(join(SRC, "a.txt"), "hello world");
    const result = await fileCopyModule.apply({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(readFileSync(join(TGT, "a.txt"), "utf-8")).toBe("hello world");
  });

  it("creates backup before overwriting", async () => {
    writeFileSync(join(SRC, "a.txt"), "new");
    writeFileSync(join(TGT, "a.txt"), "old");
    const result = await fileCopyModule.apply({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(result.backup).toBeDefined();
    expect(existsSync(result.backup!)).toBe(true);
  });

  it("is idempotent (second run is a no-op for check)", async () => {
    writeFileSync(join(SRC, "a.txt"), "content");
    await fileCopyModule.apply({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    const check = await fileCopyModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(check.status).toBe("ok");
  });

  it("creates target directory if missing", async () => {
    writeFileSync(join(SRC, "a.txt"), "content");
    const deepTarget = join(TGT, "deep", "nested", "a.txt");
    const result = await fileCopyModule.apply({
      sourcePath: join(SRC, "a.txt"),
      targetPath: deepTarget,
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(existsSync(deepTarget)).toBe(true);
  });

  it("records sync state when stateKey is provided", async () => {
    writeFileSync(join(SRC, "a.txt"), "content");
    const stateKey = "test:claude-code:default:a.txt";
    await fileCopyModule.apply({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
      stateKey,
    });
    const state = loadState();
    expect(state.files[stateKey]).toBeDefined();
    expect(state.files[stateKey].sourcePath).toBe(join(SRC, "a.txt"));
  });
});

describe("fileCopyModule three-way state (pullback)", () => {
  const stateKey = "pullback:claude-code:default:settings.json";

  it("detects source-changed when source differs from last sync", async () => {
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");

    // Initial sync: both identical
    writeFileSync(srcFile, "original");
    writeFileSync(tgtFile, "original");
    await fileCopyModule.apply({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    // User changes source
    writeFileSync(srcFile, "updated source");

    const check = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
      pullback: true,
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("source-changed");
    expect(check.message).toContain("Source changed");
  });

  it("detects target-changed for pullback offer", async () => {
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");

    writeFileSync(srcFile, "original");
    writeFileSync(tgtFile, "original");
    await fileCopyModule.apply({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    // User edits target directly (e.g., via tool UI)
    writeFileSync(tgtFile, "edited in target");

    const check = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
      pullback: true,
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("target-changed");
    expect(check.message).toContain("pullback");
  });

  it("detects both-changed as conflict", async () => {
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");

    writeFileSync(srcFile, "original");
    writeFileSync(tgtFile, "original");
    await fileCopyModule.apply({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    // Both sides change independently
    writeFileSync(srcFile, "changed in source");
    writeFileSync(tgtFile, "changed in target");

    const check = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
      pullback: true,
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("both-changed");
    expect(check.message).toContain("conflict");
  });

  it("returns in-sync when nothing changed since last sync", async () => {
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");

    writeFileSync(srcFile, "same");
    writeFileSync(tgtFile, "same");
    await fileCopyModule.apply({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    const check = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
      pullback: true,
    });

    expect(check.status).toBe("ok");
    expect(check.driftKind).toBe("in-sync");
  });
});

describe("applyPullback", () => {
  it("copies target → source and updates state", async () => {
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");
    const stateKey = "pullback:claude-code:default:s.json";

    writeFileSync(srcFile, "original source");
    writeFileSync(tgtFile, "edited in target");

    const result = await applyPullback({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    expect(result.changed).toBe(true);
    expect(readFileSync(srcFile, "utf-8")).toBe("edited in target");

    // State should show in-sync after pullback
    const state = loadState();
    const entry = state.files[stateKey];
    expect(entry).toBeDefined();
    expect(entry.sourceHash).toBe(entry.targetHash);
  });

  it("returns error when target does not exist", async () => {
    const result = await applyPullback({
      sourcePath: join(SRC, "s.json"),
      targetPath: join(TGT, "nonexistent.json"),
      owner: "test",
      stateKey: "test:key",
    });
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
  });
});
