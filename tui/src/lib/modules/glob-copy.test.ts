import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { globCopyModule } from "./glob-copy.js";

const TMP = join(tmpdir(), `bb-glob-copy-test-${Date.now()}`);
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

describe("globCopyModule.apply", () => {
  it("copies matched text files to target", async () => {
    writeFileSync(join(SRC, "settings.json"), "hello world");
    const result = await globCopyModule.apply({
      sourcePath: join(SRC, "settings*"),
      targetPath: TGT,
      owner: "test",
    });
    expect(result.changed).toBe(true);
    expect(readFileSync(join(TGT, "settings.json"), "utf-8")).toBe("hello world");
  });

  it("copies binary/non-UTF-8 files matched by glob byte-for-byte without corruption", async () => {
    // Bytes that are not valid UTF-8 (lone continuation/start bytes, etc.)
    const binaryBytes = Buffer.from([
      0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0x82, 0xc0, 0xc1, 0xf5, 0xf6, 0xf7,
      0xfe, 0xff, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb, 0xcc, 0xdd,
    ]);
    writeFileSync(join(SRC, "settings.db"), binaryBytes);

    const result = await globCopyModule.apply({
      sourcePath: join(SRC, "settings*"),
      targetPath: TGT,
      owner: "test",
    });

    expect(result.changed).toBe(true);
    const copied = readFileSync(join(TGT, "settings.db"));
    expect(copied.equals(binaryBytes)).toBe(true);
    expect(Buffer.compare(copied, binaryBytes)).toBe(0);
  });

  it("returns error when no files match the glob", async () => {
    const result = await globCopyModule.apply({
      sourcePath: join(SRC, "settings*"),
      targetPath: TGT,
      owner: "test",
    });
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
  });
});
