import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ensureConfigExists } from "./config.js";
import { loadConfig as loadYamlConfig } from "./config/loader.js";

const TMP_ROOT = join(tmpdir(), `blackbook-bootstrap-${Date.now()}`);
const TMP_HOME = join(TMP_ROOT, "home");
const TMP_XDG = join(TMP_ROOT, "xdg");

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;

function resetEnv(): void {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }

  if (ORIGINAL_XDG_CONFIG_HOME === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
  }
}

afterEach(() => {
  resetEnv();
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("ensureConfigExists bootstrap", () => {
  it("creates config.yaml and prepopulates tools/files from detected installations", () => {
    process.env.HOME = TMP_HOME;
    process.env.XDG_CONFIG_HOME = TMP_XDG;

    const claudeDir = join(TMP_HOME, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), '{"theme":"dark"}');
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# Claude");

    const piAgentDir = join(TMP_HOME, ".pi", "agent");
    mkdirSync(piAgentDir, { recursive: true });
    writeFileSync(join(piAgentDir, "settings.json"), '{"theme":"dark"}');

    ensureConfigExists();

    const tomlPath = join(TMP_XDG, "blackbook", "config.toml");
    const yamlPath = join(TMP_XDG, "blackbook", "config.yaml");

    expect(existsSync(tomlPath)).toBe(true);
    expect(existsSync(yamlPath)).toBe(true);

    const { config, errors } = loadYamlConfig(yamlPath);
    expect(errors).toEqual([]);

    expect(config.marketplaces["claude-plugins-official"]).toContain("marketplace.json");
    expect(config.tools["claude-code"]?.[0]?.config_dir).toBe("~/.claude");
    expect(config.tools["pi"]?.[0]?.config_dir).toBe("~/.pi/agent");

    const claudeSettings = config.files.find((file) => file.target === "settings.json" && file.tools?.includes("claude-code"));
    expect(claudeSettings).toBeDefined();
    expect(claudeSettings?.source).toBe(join(TMP_HOME, ".claude", "settings.json"));

    const piConfig = config.files.find((file) => file.target === "settings.json" && file.tools?.includes("pi"));
    expect(piConfig).toBeDefined();
    expect(piConfig?.source).toBe(join(TMP_HOME, ".pi", "agent", "settings.json"));
  });

  it("does not overwrite an existing config.yaml", () => {
    process.env.HOME = TMP_HOME;
    process.env.XDG_CONFIG_HOME = TMP_XDG;

    const configDir = join(TMP_XDG, "blackbook");
    mkdirSync(configDir, { recursive: true });
    const yamlPath = join(configDir, "config.yaml");
    writeFileSync(yamlPath, "settings:\n  package_manager: bun\n");

    ensureConfigExists();

    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain("package_manager: bun");
  });
});
