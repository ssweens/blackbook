import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "./writer.js";
import { loadConfig } from "./loader.js";
import type { BlackbookConfig } from "./schema.js";

const TMP_DIR = join(tmpdir(), `blackbook-writer-test-${Date.now()}`);
const TMP_YAML = join(TMP_DIR, "config.yaml");

mkdirSync(TMP_DIR, { recursive: true });

afterEach(() => {
  try { rmSync(TMP_YAML, { force: true }); } catch { /* ignore */ }
});

function makeConfig(overrides: Partial<BlackbookConfig> = {}): BlackbookConfig {
  return {
    settings: { package_manager: "pnpm", backup_retention: 3, default_pullback: false, disabled_marketplaces: [], disabled_pi_marketplaces: [], ...overrides.settings },
    marketplaces: overrides.marketplaces ?? {},
    tools: overrides.tools ?? {},
    files: overrides.files ?? [],
    plugins: overrides.plugins ?? {},
  };
}

describe("saveConfig", () => {
  it("writes valid YAML that can be re-loaded", () => {
    const config = makeConfig({
      settings: { source_repo: "~/src/config", package_manager: "bun", backup_retention: 3, default_pullback: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
      marketplaces: { test: "https://example.com/marketplace.json" },
      tools: {
        "claude-code": [{ id: "default", name: "Claude", enabled: true, config_dir: "~/.claude" }],
      },
      files: [
        { name: "AGENTS.md", source: "AGENTS.md", target: "AGENTS.md", pullback: false },
      ],
    });

    saveConfig(config, TMP_YAML);
    const reloaded = loadConfig(TMP_YAML);
    expect(reloaded.errors).toHaveLength(0);
    expect(reloaded.config.settings.source_repo).toBe("~/src/config");
    expect(reloaded.config.settings.package_manager).toBe("bun");
    expect(reloaded.config.marketplaces.test).toContain("example.com");
    expect(reloaded.config.tools["claude-code"]).toHaveLength(1);
    expect(reloaded.config.files).toHaveLength(1);
    expect(reloaded.config.files[0].name).toBe("AGENTS.md");
  });

  it("preserves comments when round-tripping", () => {
    const initial = `# My config
settings:
  source_repo: ~/src/config
  # Use bun for speed
  package_manager: bun
`;
    writeFileSync(TMP_YAML, initial);

    const config = makeConfig({
      settings: { source_repo: "~/src/config", package_manager: "pnpm", backup_retention: 3, default_pullback: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
    });
    saveConfig(config, TMP_YAML);

    const content = readFileSync(TMP_YAML, "utf-8");
    expect(content).toContain("# My config");
  });

  it("writes plugin configs", () => {
    const config = makeConfig({
      plugins: {
        "mkt": {
          "plg": {
            disabled_skills: ["a", "b"],
            disabled_commands: [],
            disabled_agents: ["x"],
          },
        },
      },
    });

    saveConfig(config, TMP_YAML);
    const reloaded = loadConfig(TMP_YAML);
    expect(reloaded.errors).toHaveLength(0);
    const plugin = reloaded.config.plugins.mkt.plg;
    expect(plugin.disabled_skills).toEqual(["a", "b"]);
    expect(plugin.disabled_agents).toEqual(["x"]);
  });
});
