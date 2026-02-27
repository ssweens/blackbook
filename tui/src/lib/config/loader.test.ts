import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "./loader.js";

const TMP_DIR = join(tmpdir(), `blackbook-loader-test-${Date.now()}`);
const TMP_YAML = join(TMP_DIR, "config.yaml");

mkdirSync(TMP_DIR, { recursive: true });

afterEach(() => {
  try { rmSync(TMP_YAML, { force: true }); } catch { /* ignore */ }
  try { rmSync(join(TMP_DIR, "config.local.yaml"), { force: true }); } catch { /* ignore */ }
});

describe("loadConfig (YAML)", () => {
  it("returns defaults for missing file", () => {
    const result = loadConfig(join(TMP_DIR, "nonexistent.yaml"));
    expect(result.errors).toHaveLength(0);
    expect(result.config.settings.package_manager).toBe("npm");
    expect(result.config.files).toEqual([]);
  });

  it("parses a valid YAML config", () => {
    writeFileSync(TMP_YAML, `
settings:
  source_repo: ~/src/playbook/config
  package_manager: bun

marketplaces:
  playbook: https://example.com/marketplace.json

tools:
  claude-code:
    - id: default
      name: Claude
      config_dir: ~/.claude

files:
  - name: AGENTS.md
    source: AGENTS.md
    target: AGENTS.md
  - name: Settings
    source: settings.json
    target: settings.json
    tools: [claude-code]
    pullback: true
`.trim());

    const result = loadConfig(TMP_YAML);
    expect(result.errors).toHaveLength(0);
    expect(result.config.settings.source_repo).toBe("~/src/playbook/config");
    expect(result.config.settings.package_manager).toBe("bun");
    expect(result.config.marketplaces.playbook).toContain("example.com");
    expect(result.config.tools["claude-code"]).toHaveLength(1);
    expect(result.config.tools["claude-code"][0].enabled).toBe(true);
    expect(result.config.files).toHaveLength(2);
    expect(result.config.files[0].name).toBe("AGENTS.md");
    expect(result.config.files[1].pullback).toBe(true);
  });

  it("reports parse errors for invalid YAML", () => {
    writeFileSync(TMP_YAML, "settings:\n  source_repo: [invalid: yaml: content");
    const result = loadConfig(TMP_YAML);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reports validation errors for invalid schema", () => {
    writeFileSync(TMP_YAML, `
settings:
  package_manager: yarn
`.trim());
    const result = loadConfig(TMP_YAML);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Invalid");
  });

  it("handles empty YAML file", () => {
    writeFileSync(TMP_YAML, "");
    const result = loadConfig(TMP_YAML);
    expect(result.errors).toHaveLength(0);
    expect(result.config.settings.package_manager).toBe("npm");
  });

  it("handles YAML file with only comments", () => {
    writeFileSync(TMP_YAML, "# This is a comment\n# Another comment");
    const result = loadConfig(TMP_YAML);
    expect(result.errors).toHaveLength(0);
  });

  it("parses plugin component configs", () => {
    writeFileSync(TMP_YAML, `
plugins:
  marketplace-a:
    plugin-1:
      disabled_skills: [skill-a, skill-b]
      disabled_commands: [cmd-x]
`.trim());
    const result = loadConfig(TMP_YAML);
    expect(result.errors).toHaveLength(0);
    const plugin = result.config.plugins["marketplace-a"]["plugin-1"];
    expect(plugin.disabled_skills).toEqual(["skill-a", "skill-b"]);
    expect(plugin.disabled_commands).toEqual(["cmd-x"]);
    expect(plugin.disabled_agents).toEqual([]);
  });
});
