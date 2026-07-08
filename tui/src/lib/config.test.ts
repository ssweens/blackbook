import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parse as parseYaml } from "yaml";
import {
  addPiMarketplace,
  removePiMarketplace,
  getPiMarketplaces,
  addMarketplace,
  setPluginComponentEnabled,
  getPluginComponentConfig,
} from "./config.js";

// The config layer resolves its file path via getConfigDir(), which honors
// XDG_CONFIG_HOME. Point that at a throwaway dir so the real mutator functions
// read/write a temp config.yaml instead of the user's real config.
let tmpRoot: string;
let configPath: string;
let prevXdg: string | undefined;

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  tmpRoot = join(tmpdir(), `blackbook-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const configDir = join(tmpRoot, "blackbook");
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = tmpRoot;
  configPath = join(configDir, "config.yaml");
});

afterEach(() => {
  if (prevXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = prevXdg;
  }
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const REALISTIC_CONFIG = `settings:
  package_manager: bun
  backup_retention: 3
  config_management: false
  disabled_marketplaces: []
  disabled_pi_marketplaces: []
marketplaces:
  official: "https://example.com/marketplace.json"
pi_marketplaces:
  playbook: "/Users/test/src/playbook"
tools:
  claude-code:
    - id: default
      name: Claude
      enabled: true
      config_dir: ~/.claude
files:
  - name: AGENTS.md
    source: ~/dotfiles/AGENTS.md
    target: AGENTS.md
`;

// ─────────────────────────────────────────────────────────────────────────────
// P0.1: Pi marketplace mutations must NOT wipe the rest of the YAML config.
// (Regression: they used to go through a TOML parser/writer that could not read
//  YAML, so saving replaced the whole file with a near-empty skeleton.)
// ─────────────────────────────────────────────────────────────────────────────

describe("addPiMarketplace / removePiMarketplace (P0.1 data-loss regression)", () => {
  it("preserves all other config when adding a pi marketplace", () => {
    writeFileSync(configPath, REALISTIC_CONFIG);

    addPiMarketplace("custom", "/tmp/custom-packages");

    const reloaded = parseYaml(readFileSync(configPath, "utf-8"));

    // The new entry is present...
    expect(reloaded.pi_marketplaces).toEqual({
      playbook: "/Users/test/src/playbook",
      custom: "/tmp/custom-packages",
    });
    // ...and every pre-existing section survived.
    expect(reloaded.marketplaces).toEqual({
      official: "https://example.com/marketplace.json",
    });
    expect(reloaded.tools["claude-code"]).toHaveLength(1);
    expect(reloaded.tools["claude-code"][0].name).toBe("Claude");
    expect(reloaded.files).toHaveLength(1);
    expect(reloaded.files[0].name).toBe("AGENTS.md");
    expect(reloaded.settings.package_manager).toBe("bun");
  });

  it("preserves all other config when removing a pi marketplace", () => {
    writeFileSync(configPath, REALISTIC_CONFIG);

    removePiMarketplace("playbook");

    const reloaded = parseYaml(readFileSync(configPath, "utf-8"));
    expect(reloaded.pi_marketplaces).toEqual({});
    expect(reloaded.marketplaces).toEqual({
      official: "https://example.com/marketplace.json",
    });
    expect(reloaded.tools["claude-code"]).toHaveLength(1);
    expect(reloaded.files).toHaveLength(1);
  });

  it("getPiMarketplaces reads the YAML pi_marketplaces section", () => {
    writeFileSync(configPath, REALISTIC_CONFIG);
    expect(getPiMarketplaces()).toEqual({ playbook: "/Users/test/src/playbook" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0.4: mutators must refuse to overwrite a config.yaml that failed to
// parse/validate (which would replace real data with schema defaults).
// ─────────────────────────────────────────────────────────────────────────────

describe("mutators refuse to overwrite a broken config (P0.4 data-loss regression)", () => {
  const BROKEN_CONFIG = `settings:
  package_manager: cargo
  backup_retention: 3
marketplaces:
  official: "https://example.com/marketplace.json"
tools:
  claude-code:
    - id: default
      name: Claude
      enabled: true
      config_dir: ~/.claude
`;

  it("throws instead of clobbering a schema-invalid config", () => {
    writeFileSync(configPath, BROKEN_CONFIG);
    const before = readFileSync(configPath, "utf-8");

    expect(() => addMarketplace("new", "https://example.com/new.json")).toThrow(
      /Cannot save config/,
    );

    // File must be byte-for-byte untouched (not replaced with defaults).
    expect(readFileSync(configPath, "utf-8")).toBe(before);
  });

  it("throws for pi marketplace mutations on a broken config too", () => {
    writeFileSync(configPath, BROKEN_CONFIG);
    const before = readFileSync(configPath, "utf-8");

    expect(() => addPiMarketplace("custom", "/tmp/x")).toThrow(/Cannot save config/);
    expect(readFileSync(configPath, "utf-8")).toBe(before);
  });

  it("still saves normally on a valid config, preserving untouched fields", () => {
    writeFileSync(configPath, REALISTIC_CONFIG);

    addMarketplace("added", "https://example.com/added.json");

    const reloaded = parseYaml(readFileSync(configPath, "utf-8"));
    expect(reloaded.marketplaces).toEqual({
      official: "https://example.com/marketplace.json",
      added: "https://example.com/added.json",
    });
    // Untouched sections remain intact.
    expect(reloaded.pi_marketplaces).toEqual({ playbook: "/Users/test/src/playbook" });
    expect(reloaded.tools["claude-code"]).toHaveLength(1);
    expect(reloaded.files).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin component enable/disable round-trips through the YAML layer.
// ─────────────────────────────────────────────────────────────────────────────

describe("plugin component config (YAML)", () => {
  it("round-trips disabled components and cleans up empty entries", () => {
    writeFileSync(configPath, REALISTIC_CONFIG);

    setPluginComponentEnabled("mkt", "plg", "skill", "skill-a", false);
    setPluginComponentEnabled("mkt", "plg", "agent", "agent-x", false);

    expect(getPluginComponentConfig("mkt", "plg")).toEqual({
      disabledSkills: ["skill-a"],
      disabledCommands: [],
      disabledAgents: ["agent-x"],
    });

    // Re-enabling the last disabled components should prune the plugin entry.
    setPluginComponentEnabled("mkt", "plg", "skill", "skill-a", true);
    setPluginComponentEnabled("mkt", "plg", "agent", "agent-x", true);

    const reloaded = parseYaml(readFileSync(configPath, "utf-8"));
    expect(reloaded.plugins?.mkt).toBeUndefined();
    // Unrelated sections are still intact after all those mutations.
    expect(reloaded.marketplaces.official).toBe("https://example.com/marketplace.json");
  });
});
