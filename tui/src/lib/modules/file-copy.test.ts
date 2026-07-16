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

  it("returns 'missing' when source does not exist", async () => {
    const result = await fileCopyModule.check({
      sourcePath: join(SRC, "nonexistent.txt"),
      targetPath: join(TGT, "a.txt"),
      owner: "test",
    });
    expect(result.status).toBe("missing");
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

  it("copies binary/non-UTF-8 files byte-for-byte without corruption", async () => {
    // Bytes that are not valid UTF-8 (lone continuation/start bytes, etc.)
    const binaryBytes = Buffer.from([
      0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0x82, 0xc0, 0xc1, 0xf5, 0xf6, 0xf7,
      0xfe, 0xff, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb, 0xcc, 0xdd,
    ]);
    const srcFile = join(SRC, "binary.dat");
    const tgtFile = join(TGT, "binary.dat");
    writeFileSync(srcFile, binaryBytes);

    const result = await fileCopyModule.apply({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
    });

    expect(result.changed).toBe(true);
    const copied = readFileSync(tgtFile);
    expect(copied.equals(binaryBytes)).toBe(true);
    expect(Buffer.compare(copied, binaryBytes)).toBe(0);
  });
});

describe("fileCopyModule three-way state detection", () => {
  const stateKey = "test:claude-code:default:settings.json";

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
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("source-changed");
    expect(check.message).toContain("Source changed");
  });

  it("detects target-changed when target is edited", async () => {
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
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("target-changed");
    expect(check.message).toContain("Target changed");
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
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("both-changed");
    expect(check.message).toContain("conflict");
  });

  it("labels a never-synced target that already exists as untracked", async () => {
    // No prior apply() → no state entry. Target exists on disk and differs from
    // source: this is adopting a pre-existing (or state-lost) target, which the
    // bulk sync gates behind an explicit push.
    const srcFile = join(SRC, "s.json");
    const tgtFile = join(TGT, "s.json");
    writeFileSync(srcFile, "source version");
    writeFileSync(tgtFile, "pre-existing tool version");

    const check = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey,
    });

    expect(check.status).toBe("drifted");
    expect(check.driftKind).toBe("never-synced");
    expect(check.message).toContain("Untracked");
    // A brand-new target (missing on disk) is a safe install, not "drifted".
    const freshCheck = await fileCopyModule.check({
      sourcePath: srcFile,
      targetPath: join(TGT, "does-not-exist.json"),
      owner: "test",
      stateKey,
    });
    expect(freshCheck.status).toBe("missing");
    expect(freshCheck.driftKind).toBe("never-synced");
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

  it("via fileCopyModule.apply with pullback:true records canonical orientation (source=repo, target=tool)", async () => {
    // Regression: pullback used to reach the module via swapped source/target
    // params, which recorded the TOOL file as entry.sourcePath and the REPO
    // file as entry.targetPath — the reverse of every forward sync. Cleanup
    // then deletes entry.targetPath, so a swapped entry would delete the repo.
    const repoFile = join(SRC, "canonical.json");
    const toolFile = join(TGT, "canonical.json");
    const stateKey = "canonical:claude-code:default:canonical.json";

    writeFileSync(repoFile, "stale repo copy");
    writeFileSync(toolFile, "edited in tool");

    const result = await fileCopyModule.apply({
      sourcePath: repoFile, // repo — passed in canonical (non-swapped) order
      targetPath: toolFile, // tool
      owner: "test",
      stateKey,
      pullback: true,
    });

    expect(result.changed).toBe(true);
    // Bytes were pulled back: repo now matches the tool's edited copy.
    expect(readFileSync(repoFile, "utf-8")).toBe("edited in tool");

    const entry = loadState().files[stateKey];
    expect(entry).toBeDefined();
    expect(entry.sourcePath).toBe(repoFile);
    expect(entry.targetPath).toBe(toolFile);
  });

  it("copies binary/non-UTF-8 files byte-for-byte without corruption", async () => {
    const binaryBytes = Buffer.from([
      0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0x82, 0xc0, 0xc1, 0xf5, 0xf6, 0xf7,
      0xfe, 0xff, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb, 0xcc, 0xdd,
    ]);
    const srcFile = join(SRC, "binary-pullback.dat");
    const tgtFile = join(TGT, "binary-pullback.dat");
    writeFileSync(srcFile, "placeholder");
    writeFileSync(tgtFile, binaryBytes);

    const result = await applyPullback({
      sourcePath: srcFile,
      targetPath: tgtFile,
      owner: "test",
      stateKey: "pullback:binary:default:binary-pullback.dat",
    });

    expect(result.changed).toBe(true);
    const copied = readFileSync(srcFile);
    expect(copied.equals(binaryBytes)).toBe(true);
  });
});
