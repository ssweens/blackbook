import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "./config.js";

const TMP_PATH = join(tmpdir(), `blackbook-config-test-${Date.now()}.toml`);

afterEach(() => {
  try {
    rmSync(TMP_PATH);
  } catch {
    // ignore
  }
});

describe("loadConfig assets", () => {
  it("parses assets with overrides", () => {
    const content = `
[[assets]]
name = "AGENTS.md"
source = "~/dotfiles/AGENTS.md"
default_target = "AGENTS.md"

[assets.overrides]
"claude-code:default" = "CLAUDE.md"
"opencode:secondary" = "AGENTS.md"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.assets).toHaveLength(1);
    const asset = config.assets![0];
    expect(asset.name).toBe("AGENTS.md");
    expect(asset.source).toBe("~/dotfiles/AGENTS.md");
    expect(asset.defaultTarget).toBe("AGENTS.md");
    expect(asset.overrides).toEqual({
      "claude-code:default": "CLAUDE.md",
      "opencode:secondary": "AGENTS.md",
    });
  });
});
