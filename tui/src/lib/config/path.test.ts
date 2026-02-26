import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { expandPath, resolveSourcePath } from "./path.js";

describe("expandPath", () => {
  it("expands ~ to homedir", () => {
    expect(expandPath("~")).toBe(homedir());
  });

  it("expands ~/path to homedir/path", () => {
    expect(expandPath("~/src/config")).toBe(join(homedir(), "src/config"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandPath("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandPath("relative/path")).toBe("relative/path");
  });
});

describe("resolveSourcePath", () => {
  it("passes URLs through unchanged", () => {
    expect(resolveSourcePath("https://example.com/file.md", undefined)).toBe("https://example.com/file.md");
    expect(resolveSourcePath("http://example.com/file.md", "/repo")).toBe("http://example.com/file.md");
  });

  it("expands absolute paths", () => {
    expect(resolveSourcePath("/absolute/path.md", "/repo")).toBe("/absolute/path.md");
  });

  it("expands home-relative paths", () => {
    expect(resolveSourcePath("~/dotfiles/file.md", "/repo")).toBe(join(homedir(), "dotfiles/file.md"));
  });

  it("resolves relative paths against source_repo", () => {
    expect(resolveSourcePath("claude-code/settings.json", "~/src/config")).toBe(
      join(homedir(), "src/config", "claude-code/settings.json")
    );
  });

  it("handles relative paths without source_repo", () => {
    expect(resolveSourcePath("file.md", undefined)).toBe("file.md");
  });
});
