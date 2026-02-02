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

describe("loadConfig configs", () => {
  it("parses multi-file config mappings", () => {
    const content = `
[[configs]]
name = "Pi Config"
tool_id = "pi"

[[configs.files]]
source = "pi/config.toml"
target = "config.toml"

[[configs.files]]
source = "pi/themes/"
target = "themes/"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.configs).toHaveLength(1);
    const cfg = config.configs![0];
    expect(cfg.name).toBe("Pi Config");
    expect(cfg.toolId).toBe("pi");
    expect(cfg.mappings).toEqual([
      { source: "pi/config.toml", target: "config.toml" },
      { source: "pi/themes/", target: "themes/" },
    ]);
  });

  it("parses legacy config format", () => {
    const content = `
[[configs]]
name = "Claude Settings"
tool_id = "claude-code"
source_path = "claude-code/settings.json"
target_path = "settings.json"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.configs).toHaveLength(1);
    const cfg = config.configs![0];
    expect(cfg.name).toBe("Claude Settings");
    expect(cfg.toolId).toBe("claude-code");
    expect(cfg.sourcePath).toBe("claude-code/settings.json");
    expect(cfg.targetPath).toBe("settings.json");
  });
});
