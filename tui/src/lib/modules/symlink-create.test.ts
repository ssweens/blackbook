import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, symlinkSync, readlinkSync, existsSync, readFileSync, lstatSync } from "fs";
import { join, relative, dirname } from "path";
import { tmpdir } from "os";
import { symlinkCreateModule } from "./symlink-create.js";

const TMP = join(tmpdir(), `bb-symlink-test-${Date.now()}`);
const SRC = join(TMP, "source");
const TGT = join(TMP, "target");
const CACHE = join(TMP, "cache");
const ORIG_XDG = process.env.XDG_CACHE_HOME;

beforeAll(() => {
  process.env.XDG_CACHE_HOME = CACHE;
});

afterAll(() => {
  if (ORIG_XDG !== undefined) {
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

describe("symlinkCreateModule.check", () => {
  it("returns 'missing' when symlink does not exist", async () => {
    writeFileSync(join(SRC, "a.txt"), "hello");
    const result = await symlinkCreateModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
    });
    expect(result.status).toBe("missing");
  });

  it("returns 'ok' when symlink is correct", async () => {
    const src = join(SRC, "a.txt");
    const tgt = join(TGT, "a.txt");
    writeFileSync(src, "hello");
    symlinkSync(src, tgt);
    const result = await symlinkCreateModule.check({
      sourcePath: src,
      targetPath: tgt,
    });
    expect(result.status).toBe("ok");
  });

  it("returns 'drifted' when symlink points to wrong target", async () => {
    const src = join(SRC, "a.txt");
    const wrong = join(SRC, "b.txt");
    const tgt = join(TGT, "a.txt");
    writeFileSync(src, "hello");
    writeFileSync(wrong, "wrong");
    symlinkSync(wrong, tgt);
    const result = await symlinkCreateModule.check({
      sourcePath: src,
      targetPath: tgt,
    });
    expect(result.status).toBe("drifted");
  });

  it("returns 'drifted' when target is a regular file", async () => {
    writeFileSync(join(SRC, "a.txt"), "hello");
    writeFileSync(join(TGT, "a.txt"), "not a symlink");
    const result = await symlinkCreateModule.check({
      sourcePath: join(SRC, "a.txt"),
      targetPath: join(TGT, "a.txt"),
    });
    expect(result.status).toBe("drifted");
  });

  it("returns 'failed' when source does not exist", async () => {
    const result = await symlinkCreateModule.check({
      sourcePath: join(SRC, "nonexistent"),
      targetPath: join(TGT, "link"),
    });
    expect(result.status).toBe("failed");
  });
});

describe("symlinkCreateModule.apply", () => {
  it("creates a new symlink", async () => {
    const src = join(SRC, "a.txt");
    writeFileSync(src, "hello");
    const tgt = join(TGT, "a.txt");

    const result = await symlinkCreateModule.apply({ sourcePath: src, targetPath: tgt });
    expect(result.changed).toBe(true);
    expect(readlinkSync(tgt)).toBe(src);
  });

  it("replaces existing wrong symlink", async () => {
    const src = join(SRC, "a.txt");
    const wrong = join(SRC, "b.txt");
    const tgt = join(TGT, "a.txt");
    writeFileSync(src, "correct");
    writeFileSync(wrong, "wrong");
    symlinkSync(wrong, tgt);

    const result = await symlinkCreateModule.apply({ sourcePath: src, targetPath: tgt });
    expect(result.changed).toBe(true);
    expect(readlinkSync(tgt)).toBe(src);
  });

  it("creates parent directories", async () => {
    const src = join(SRC, "a.txt");
    writeFileSync(src, "hello");
    const tgt = join(TGT, "deep", "nested", "a.txt");

    const result = await symlinkCreateModule.apply({ sourcePath: src, targetPath: tgt });
    expect(result.changed).toBe(true);
    expect(existsSync(tgt)).toBe(true);
  });

  it("backs up an existing real file before replacing it with a symlink", async () => {
    const src = join(SRC, "a.txt");
    const tgt = join(TGT, "a.txt");
    writeFileSync(src, "source content");
    writeFileSync(tgt, "original user content");

    const result = await symlinkCreateModule.apply({ sourcePath: src, targetPath: tgt, owner: "test" });

    expect(result.changed).toBe(true);
    expect(result.backup).toBeDefined();
    expect(existsSync(result.backup!)).toBe(true);
    expect(readFileSync(result.backup!, "utf-8")).toBe("original user content");
    // Target is now a symlink pointing to the source.
    expect(lstatSync(tgt).isSymbolicLink()).toBe(true);
    expect(readlinkSync(tgt)).toBe(src);
  });
});

describe("symlinkCreateModule.check — relative symlinks", () => {
  it("recognizes a relative-but-correct symlink as not drifted", async () => {
    const src = join(SRC, "a.txt");
    const tgt = join(TGT, "a.txt");
    writeFileSync(src, "hello");
    // Relative link that still resolves to the correct source file.
    const relLink = relative(dirname(tgt), src);
    symlinkSync(relLink, tgt);
    // Sanity: the raw link string is NOT the absolute source path.
    expect(readlinkSync(tgt)).not.toBe(src);

    const result = await symlinkCreateModule.check({ sourcePath: src, targetPath: tgt });
    expect(result.status).toBe("ok");
  });
});
