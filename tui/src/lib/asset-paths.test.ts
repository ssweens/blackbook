import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "path";
import { homedir } from "os";
import { resolveAssetSourcePath } from "./config.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAssetSourcePath", () => {
  it("passes through http URLs unchanged", () => {
    const result = resolveAssetSourcePath("http://example.com/asset.md");
    expect(result).toBe("http://example.com/asset.md");
  });

  it("passes through https URLs unchanged", () => {
    const result = resolveAssetSourcePath("https://raw.githubusercontent.com/user/repo/main/AGENTS.md");
    expect(result).toBe("https://raw.githubusercontent.com/user/repo/main/AGENTS.md");
  });

  it("expands home-relative paths", () => {
    const result = resolveAssetSourcePath("~/dotfiles/AGENTS.md");
    expect(result).toBe(join(homedir(), "dotfiles/AGENTS.md"));
  });

  it("passes through absolute paths", () => {
    const result = resolveAssetSourcePath("/absolute/path/to/file.md");
    expect(result).toBe("/absolute/path/to/file.md");
  });
});
