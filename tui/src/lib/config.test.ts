import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, saveConfig, getPluginComponentConfig, setPluginComponentEnabled, isPluginComponentEnabled } from "./config.js";

const TMP_PATH = join(tmpdir(), `blackbook-config-test-${Date.now()}.yaml`);

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

describe("loadConfig sync", () => {
  it("parses package_manager from sync section", () => {
    const content = `
[sync]
package_manager = "pnpm"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.sync?.packageManager).toBe("pnpm");
  });

  it("writes package_manager when saving config", () => {
    saveConfig(
      {
        marketplaces: {},
        tools: {},
        assets: [],
        configs: [],
        sync: {
          packageManager: "bun",
        },
      },
      TMP_PATH
    );

    const content = readFileSync(TMP_PATH, "utf-8");
    expect(content).toContain("[sync]");
    expect(content).toContain('package_manager = "bun"');
  });
});

describe("loadConfig configs", () => {
  it("parses multi-file config mappings", () => {
    const content = `
[[configs]]
name = "Pi Config"
tool_id = "pi"

[[configs.files]]
source = "pi/config.yaml"
target = "config.yaml"

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
      { source: "pi/config.yaml", target: "config.yaml" },
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

describe("plugin component config", () => {
  it("parses disabled_skills and disabled_commands from [plugins.*.*]", () => {
    const content = `
[marketplaces]

[plugins.my-marketplace.my-plugin]
disabled_skills = "skill-a,skill-b"
disabled_commands = "cmd-x"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.plugins).toBeDefined();
    expect(config.plugins!["my-marketplace"]["my-plugin"]).toEqual({
      disabled_skills: "skill-a,skill-b",
      disabled_commands: "cmd-x",
    });
  });

  it("round-trips plugin component config through save/load", () => {
    const config = {
      marketplaces: {},
      tools: {},
      assets: [] as never[],
      configs: [] as never[],
      plugins: {
        "test-market": {
          "test-plugin": {
            disabled_skills: "foo,bar",
            disabled_commands: "baz",
          },
        },
      },
    };

    saveConfig(config, TMP_PATH);
    const reloaded = loadConfig(TMP_PATH);
    expect(reloaded.plugins!["test-market"]["test-plugin"]).toEqual({
      disabled_skills: "foo,bar",
      disabled_commands: "baz",
    });
  });

  it("getPluginComponentConfig returns parsed arrays", () => {
    const content = `
[plugins.mkt.plg]
disabled_skills = "a,b,c"
disabled_agents = "x"
`;

    writeFileSync(TMP_PATH, content.trim());
    // getPluginComponentConfig reads from default path, so test via loadConfig
    const config = loadConfig(TMP_PATH);
    const pluginEntry = config.plugins!["mkt"]["plg"];
    const disabledSkills = (pluginEntry.disabled_skills || "").split(",").map(s => s.trim()).filter(Boolean);
    const disabledAgents = (pluginEntry.disabled_agents || "").split(",").map(s => s.trim()).filter(Boolean);
    expect(disabledSkills).toEqual(["a", "b", "c"]);
    expect(disabledAgents).toEqual(["x"]);
  });

  it("cleans up empty plugin entries on save", () => {
    const config = {
      marketplaces: {},
      plugins: {
        "mkt": {
          "plg": {
            disabled_skills: undefined,
            disabled_commands: undefined,
            disabled_agents: undefined,
          },
        },
      },
    };

    saveConfig(config as never, TMP_PATH);
    const content = readFileSync(TMP_PATH, "utf-8");
    // Empty plugin config should not be written
    expect(content).not.toContain("[plugins.");
  });
});

describe("pi-marketplaces round-trip", () => {
  it("preserves pi-marketplaces through save/load cycle", () => {
    const content = `
[marketplaces]

[pi-marketplaces]
playbook = "/Users/test/src/playbook"
custom = "/tmp/custom-packages"

[sync]
config_repo = "~/src/config"
`;

    writeFileSync(TMP_PATH, content.trim());
    const config = loadConfig(TMP_PATH);
    expect(config.piMarketplaces).toEqual({
      playbook: "/Users/test/src/playbook",
      custom: "/tmp/custom-packages",
    });

    saveConfig(config, TMP_PATH);
    const reloaded = loadConfig(TMP_PATH);
    expect(reloaded.piMarketplaces).toEqual({
      playbook: "/Users/test/src/playbook",
      custom: "/tmp/custom-packages",
    });
  });
});
