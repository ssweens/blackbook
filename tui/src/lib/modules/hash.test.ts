import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { hashFile, hashDirectory, hashString } from "./hash.js";

const TMP = join(tmpdir(), `bb-hash-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("hashFile", () => {
  it("returns consistent hash for same content", () => {
    const file = join(TMP, "a.txt");
    writeFileSync(file, "hello world");
    expect(hashFile(file)).toBe(hashFile(file));
  });

  it("returns different hash for different content", () => {
    const fileA = join(TMP, "a.txt");
    const fileB = join(TMP, "b.txt");
    writeFileSync(fileA, "hello");
    writeFileSync(fileB, "world");
    expect(hashFile(fileA)).not.toBe(hashFile(fileB));
  });
});

describe("hashDirectory", () => {
  it("returns consistent hash for same directory", () => {
    const dir = join(TMP, "dir");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.txt"), "content a");
    writeFileSync(join(dir, "b.txt"), "content b");

    expect(hashDirectory(dir)).toBe(hashDirectory(dir));
  });

  it("returns different hash when file content changes", () => {
    const dir = join(TMP, "dir2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.txt"), "original");
    const hash1 = hashDirectory(dir);

    writeFileSync(join(dir, "a.txt"), "modified");
    const hash2 = hashDirectory(dir);

    expect(hash1).not.toBe(hash2);
  });

  it("returns different hash when file is added", () => {
    const dir = join(TMP, "dir3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.txt"), "content");
    const hash1 = hashDirectory(dir);

    writeFileSync(join(dir, "b.txt"), "new file");
    const hash2 = hashDirectory(dir);

    expect(hash1).not.toBe(hash2);
  });
});

describe("hashString", () => {
  it("returns consistent hash for same string", () => {
    expect(hashString("test")).toBe(hashString("test"));
  });
});
