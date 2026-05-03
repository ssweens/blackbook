import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  scaffoldSkeleton,
  writeMcpServer,
  writePlaybookManifest,
  writeToolConfig,
  type McpServer,
  type ToolInstance,
} from "../../playbook/index.js";
import { buildClaudeOwnership, claudeAdapter } from "./index.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-claude-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeInstance(configDir: string): ToolInstance {
  return { id: "default", name: "Claude", config_dir: configDir, enabled: true };
}

describe("claudeAdapter — defaults", () => {
  it("exposes claude as toolId and artifact-bundle paradigm", () => {
    expect(claudeAdapter.defaults.toolId).toBe("claude");
    expect(claudeAdapter.defaults.capabilities.bundleParadigm).toBe("artifact");
    expect(claudeAdapter.defaults.capabilities.mcp).toBe(true);
    expect(claudeAdapter.defaults.capabilities.hooks).toBe(true);
  });
});

describe("buildClaudeOwnership", () => {
  it("returns empty when plugins dir absent", () => {
    expect(buildClaudeOwnership(tmp).size).toBe(0);
  });

  it("attributes plugin-contributed artifacts to the plugin", () => {
    const plug = join(tmp, "plugins", "ce-compound");
    mkdirSync(join(plug, "skills", "planner"), { recursive: true });
    writeFileSync(join(plug, "skills", "planner", "SKILL.md"), "# planner");
    mkdirSync(join(plug, "commands"), { recursive: true });
    writeFileSync(join(plug, "commands", "review.md"), "# review");
    mkdirSync(join(plug, "agents"), { recursive: true });
    writeFileSync(join(plug, "agents", "reviewer.md"), "# reviewer");
    writeFileSync(
      join(tmp, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "ce-compound": { enabled: true } } }),
    );

    const ownership = buildClaudeOwnership(tmp);
    expect(ownership.get("skill:planner")).toBe("ce-compound");
    expect(ownership.get("command:review")).toBe("ce-compound");
    expect(ownership.get("agent:reviewer")).toBe("ce-compound");
  });
});

describe("claudeAdapter — scan with AGENTS.md variants", () => {
  it("detects CLAUDE.md as agents_md variant", async () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# legacy");
    const inv = await claudeAdapter.scan(makeInstance(tmp));
    const agentsMd = inv.artifacts.find((a) => a.type === "agents_md");
    expect(agentsMd?.name).toBe("CLAUDE.md");
  });

  it("detects both AGENTS.md and CLAUDE.md when both exist", async () => {
    writeFileSync(join(tmp, "AGENTS.md"), "# new");
    writeFileSync(join(tmp, "CLAUDE.md"), "# legacy");
    const inv = await claudeAdapter.scan(makeInstance(tmp));
    const names = inv.artifacts
      .filter((a) => a.type === "agents_md")
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });
});

describe("claudeAdapter — preview/apply with overrides", () => {
  it("applies AGENTS.md as CLAUDE.md per overrides.agents_md", async () => {
    const pbRoot = join(tmp, "playbook");
    scaffoldSkeleton(pbRoot, ["claude"]);
    writePlaybookManifest(pbRoot, {
      playbook_schema_version: 1,
      name: "test",
      tools_enabled: ["claude"],
      marketplaces: {},
      required_env: [],
      defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
      settings: { package_manager: "pnpm", backup_retention: 3 },
    });
    const liveDir = join(tmp, "live-claude");
    writeToolConfig(pbRoot, "claude", {
      tool: "claude",
      instances: [{ id: "default", name: "Claude", config_dir: liveDir, enabled: true }],
      include_shared: { agents_md: true, skills: [], commands: [], agents: [], mcp: [] },
      overrides: { agents_md: { default: "CLAUDE.md" } },
      config_files: [],
      lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
    });
    writeFileSync(join(pbRoot, "shared", "AGENTS.md"), "# agents");

    const playbook = loadPlaybook(pbRoot);
    const instance = playbook.tools.claude!.config.instances[0];
    const diff = await claudeAdapter.preview(playbook, instance);
    expect(diff.ops.find((o) => o.kind === "add" && o.name === "CLAUDE.md")).toBeDefined();

    const result = await claudeAdapter.apply(diff, instance, {
      confirmRemovals: false,
      dryRun: false,
    });
    expect(result.errors).toEqual([]);
    expect(readFileSync(join(liveDir, "CLAUDE.md"), "utf-8")).toBe("# agents");
  });
});

describe("claudeAdapter — MCP emission", () => {
  it("emits stdio for local + http for remote with bearer header placeholder", async () => {
    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const servers: McpServer[] = [
      {
        name: "github",
        type: "remote",
        url: "https://github.example/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      {
        name: "local-srv",
        type: "local",
        command: ["npx", "-y", "@x/server", "--flag"],
        env: { TOKEN: "$env:T" },
        enabled: true,
        compat: {},
      },
    ];
    const result = await claudeAdapter.emitMcp!(servers, makeInstance(liveDir));
    expect(result.written).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(liveDir, ".mcp.json"), "utf-8"));
    expect(written.mcpServers.github.type).toBe("http");
    expect(written.mcpServers.github.headers.Authorization).toBe("$env:GITHUB_TOKEN");
    expect(written.mcpServers["local-srv"].type).toBe("stdio");
    expect(written.mcpServers["local-srv"].command).toBe("npx");
    expect(written.mcpServers["local-srv"].args).toEqual(["-y", "@x/server", "--flag"]);
  });
});

describe("claudeAdapter — pull", () => {
  it("produces a fragment with bundles + standalone classified", async () => {
    // Plugin install setup
    const plug = join(tmp, "plugins", "ce-compound");
    mkdirSync(join(plug, "skills", "planner"), { recursive: true });
    writeFileSync(join(plug, "skills", "planner", "SKILL.md"), "# planner");
    writeFileSync(
      join(tmp, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "ce-compound": { enabled: true } } }),
    );
    // Bundle-owned skill materialized in skills/
    mkdirSync(join(tmp, "skills", "planner"), { recursive: true });
    writeFileSync(join(tmp, "skills", "planner", "SKILL.md"), "# planner");
    // User-authored standalone
    mkdirSync(join(tmp, "skills", "my-thing"), { recursive: true });
    writeFileSync(join(tmp, "skills", "my-thing", "SKILL.md"), "# my-thing");

    const fragment = await claudeAdapter.pull(makeInstance(tmp), {
      defaultUnknownToStandalone: false,
    });
    expect(fragment.bundles.map((b) => b.name)).toContain("ce-compound");
    expect(fragment.standaloneArtifacts.some((a) => a.name === "my-thing")).toBe(true);
  });
});
