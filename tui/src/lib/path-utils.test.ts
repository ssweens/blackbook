import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { expandTilde, resolveLocalPath, resolveLocalPathRaw } from "./path-utils.js";

describe("expandTilde", () => {
  it("expands a bare tilde to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/foo/bar without discarding the home directory", () => {
    // Regression: stripping only the tilde left an absolute "/foo/bar", which
    // resolve(home, "/foo/bar") collapsed back to "/foo/bar".
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo", "bar"));
  });

  it("expands ~/ to the home directory", () => {
    expect(expandTilde("~/")).toBe(homedir());
  });

  it("leaves an already-absolute path unchanged", () => {
    expect(expandTilde("/already/absolute")).toBe("/already/absolute");
  });

  it("leaves a relative path unchanged", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });
});

describe("resolveLocalPath", () => {
  let testDir: string;
  let marketplaceJsonPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "resolve-local-path-"));
    marketplaceJsonPath = join(testDir, ".claude-plugin", "marketplace.json");
    mkdirSync(join(testDir, ".claude-plugin"), { recursive: true });
    writeFileSync(marketplaceJsonPath, "{}");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns a bare absolute directory path unchanged", () => {
    expect(resolveLocalPath(testDir)).toBe(testDir);
  });

  it("resolves a bare absolute path pointing at a file to its directory", () => {
    expect(resolveLocalPath(marketplaceJsonPath)).toBe(join(testDir, ".claude-plugin"));
  });

  it("resolves a file:// URL pointing at a directory to that directory", () => {
    expect(resolveLocalPath(pathToFileURL(testDir).href)).toBe(testDir);
  });

  it("resolves a file:// URL pointing at a file to its directory", () => {
    // Regression: the file:// branch used to return fileURLToPath() directly,
    // skipping the "if it's a file, use its directory" step that the bare-path
    // branch applies — so a file:// marketplace URL pointing at
    // marketplace.json (the common case) resolved to the file itself instead
    // of its containing directory.
    expect(resolveLocalPath(pathToFileURL(marketplaceJsonPath).href)).toBe(
      join(testDir, ".claude-plugin"),
    );
  });

  it("returns null for a remote (non-local) URL", () => {
    expect(resolveLocalPath("https://github.com/owner/repo.git")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveLocalPath("")).toBeNull();
  });
});

describe("resolveLocalPathRaw", () => {
  let testDir: string;
  let marketplaceJsonPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "resolve-local-path-raw-"));
    marketplaceJsonPath = join(testDir, ".claude-plugin", "marketplace.json");
    mkdirSync(join(testDir, ".claude-plugin"), { recursive: true });
    writeFileSync(marketplaceJsonPath, "{}");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not collapse a bare absolute path pointing at a file to its directory", () => {
    // Unlike resolveLocalPath — callers that need to know the raw target is a
    // file (to try alternate filenames when it's a directory instead) use
    // this instead of resolveLocalPath specifically to avoid that collapse.
    expect(resolveLocalPathRaw(marketplaceJsonPath)).toBe(marketplaceJsonPath);
  });

  it("does not collapse a file:// URL pointing at a file to its directory", () => {
    expect(resolveLocalPathRaw(pathToFileURL(marketplaceJsonPath).href)).toBe(marketplaceJsonPath);
  });

  it("returns null for a remote (non-local) URL", () => {
    expect(resolveLocalPathRaw("https://github.com/owner/repo.git")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveLocalPathRaw("")).toBeNull();
  });
});
