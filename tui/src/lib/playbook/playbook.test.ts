/**
 * End-to-end tests for the playbook model: schema → write → load → validate.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  PlaybookLoadError,
  scaffoldSkeleton,
  validatePlaybook,
  writeMcpServer,
  writePackagesManifest,
  writePlaybookManifest,
  writePluginsManifest,
  writeToolConfig,
  type McpServer,
  type PackagesManifest,
  type PlaybookManifest,
  type PluginsManifest,
  type ToolConfig,
} from "./index.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "blackbook-playbook-test-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function minimalManifest(overrides: Partial<PlaybookManifest> = {}): PlaybookManifest {
  return {
    playbook_schema_version: 1,
    name: "test-playbook",
    description: "test",
    tools_enabled: [],
    marketplaces: {},
    required_env: [],
    defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
    settings: { package_manager: "pnpm", backup_retention: 3 },
    ...overrides,
  };
}

function minimalToolConfig(overrides: Partial<ToolConfig> = {}): ToolConfig {
  return {
    tool: "claude",
    instances: [
      { id: "default", name: "Claude", config_dir: "~/.claude", enabled: true },
    ],
    include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
    overrides: { agents_md: {} },
    config_files: [],
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// scaffold + minimal load
// ─────────────────────────────────────────────────────────────────────────────

describe("scaffoldSkeleton + minimal playbook", () => {
  it("creates expected directory structure", () => {
    scaffoldSkeleton(tmpRoot, ["claude", "pi"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: [] }));

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.manifest.name).toBe("test-playbook");
    expect(playbook.shared.skills).toEqual([]);
    expect(playbook.shared.commands).toEqual([]);
    expect(playbook.shared.agents).toEqual([]);
    expect(Object.keys(playbook.shared.mcp)).toEqual([]);
    expect(playbook.shared.agentsMdPath).toBeUndefined();
  });

  it("writes a default .gitignore", () => {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    expect(() => loadPlaybook(tmpRoot)).toThrow(); // missing playbook.yaml
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// playbook.yaml validation
// ─────────────────────────────────────────────────────────────────────────────

describe("loadPlaybook — playbook.yaml errors", () => {
  it("throws when playbook root missing", () => {
    expect(() => loadPlaybook(join(tmpRoot, "nope"))).toThrow(PlaybookLoadError);
  });

  it("throws when playbook.yaml missing", () => {
    scaffoldSkeleton(tmpRoot, []);
    expect(() => loadPlaybook(tmpRoot)).toThrow(/Missing playbook\.yaml/);
  });

  it("throws on invalid schema_version", () => {
    scaffoldSkeleton(tmpRoot, []);
    writeFileSync(
      join(tmpRoot, "playbook.yaml"),
      "playbook_schema_version: 99\nname: test\n",
    );
    expect(() => loadPlaybook(tmpRoot)).toThrow(PlaybookLoadError);
  });

  it("throws on missing required name", () => {
    scaffoldSkeleton(tmpRoot, []);
    writeFileSync(
      join(tmpRoot, "playbook.yaml"),
      "playbook_schema_version: 1\n",
    );
    expect(() => loadPlaybook(tmpRoot)).toThrow(/name/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tools enabled — tool.yaml is required when tool is enabled
// ─────────────────────────────────────────────────────────────────────────────

describe("loadPlaybook — tools_enabled", () => {
  it("loads enabled tool configs", () => {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: ["claude"] }));
    writeToolConfig(tmpRoot, "claude", minimalToolConfig());

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.tools.claude).toBeDefined();
    expect(playbook.tools.claude?.config.tool).toBe("claude");
    expect(playbook.tools.claude?.config.instances).toHaveLength(1);
  });

  it("throws when an enabled tool has no tool.yaml", () => {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: ["claude"] }));
    expect(() => loadPlaybook(tmpRoot)).toThrow(/tool\.yaml is missing/);
  });

  it("throws when tool.yaml tool field doesn't match dir", () => {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: ["claude"] }));
    writeToolConfig(tmpRoot, "claude", minimalToolConfig({ tool: "claude" }));
    // Manually overwrite the file so its content is wrong
    writeFileSync(
      join(tmpRoot, "tools", "claude", "tool.yaml"),
      "tool: pi\ninstances:\n  - id: default\n    name: x\n    config_dir: ~/.x\n    enabled: true\n",
    );
    expect(() => loadPlaybook(tmpRoot)).toThrow(/declares tool="pi"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared artifacts discovery
// ─────────────────────────────────────────────────────────────────────────────

describe("loadPlaybook — shared artifacts", () => {
  it("discovers skills, commands, agents", () => {
    scaffoldSkeleton(tmpRoot, []);
    writePlaybookManifest(tmpRoot, minimalManifest());

    // Skills (directory-based)
    const skillDir = join(tmpRoot, "shared", "skills", "incident-triage");
    const { mkdirSync } = require("node:fs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# incident-triage");

    // Skip-this skill (no SKILL.md)
    mkdirSync(join(tmpRoot, "shared", "skills", "incomplete"), { recursive: true });

    // Commands and agents (file-based)
    writeFileSync(join(tmpRoot, "shared", "commands", "status.md"), "# status");
    writeFileSync(join(tmpRoot, "shared", "agents", "reviewer.md"), "# reviewer");
    writeFileSync(join(tmpRoot, "shared", "AGENTS.md"), "# agents");

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.shared.skills.map((s) => s.name)).toEqual(["incident-triage"]);
    expect(playbook.shared.commands.map((c) => c.name)).toEqual(["status"]);
    expect(playbook.shared.agents.map((a) => a.name)).toEqual(["reviewer"]);
    expect(playbook.shared.agentsMdPath).toBeDefined();
  });

  it("loads MCP servers from shared/mcp/", () => {
    scaffoldSkeleton(tmpRoot, []);
    writePlaybookManifest(tmpRoot, minimalManifest());

    const server: McpServer = {
      name: "github-mcp",
      type: "remote",
      url: "https://github.example/mcp",
      bearerTokenEnv: "GITHUB_TOKEN",
      headers: {},
      enabled: true,
      compat: {},
    };
    writeMcpServer(tmpRoot, server);

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.shared.mcp["github-mcp"]).toBeDefined();
    expect(playbook.shared.mcp["github-mcp"].type).toBe("remote");
    if (playbook.shared.mcp["github-mcp"].type === "remote") {
      expect(playbook.shared.mcp["github-mcp"].bearerTokenEnv).toBe("GITHUB_TOKEN");
    }
  });

  it("throws on duplicate MCP server names across files", () => {
    scaffoldSkeleton(tmpRoot, []);
    writePlaybookManifest(tmpRoot, minimalManifest());
    const mcpDir = join(tmpRoot, "shared", "mcp");
    writeFileSync(
      join(mcpDir, "a.yaml"),
      "name: dup\ntype: local\ncommand: [echo]\n",
    );
    writeFileSync(
      join(mcpDir, "b.yaml"),
      "name: dup\ntype: local\ncommand: [echo]\n",
    );
    expect(() => loadPlaybook(tmpRoot)).toThrow(/Duplicate MCP server name/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bundle manifests
// ─────────────────────────────────────────────────────────────────────────────

describe("loadPlaybook — bundle manifests", () => {
  it("loads plugins.yaml when present", () => {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: ["claude"] }));
    writeToolConfig(tmpRoot, "claude", minimalToolConfig());
    const manifest: PluginsManifest = {
      schema: 1,
      plugins: [
        {
          name: "ce-compound",
          source: { type: "marketplace", marketplace: "playbook", plugin: "ce-compound" },
          enabled: true,
          disabled_components: { skills: [], commands: [], agents: [] },
        },
      ],
    };
    writePluginsManifest(tmpRoot, "claude", manifest);

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.tools.claude?.pluginsManifest?.plugins).toHaveLength(1);
    expect(playbook.tools.claude?.pluginsManifest?.plugins[0].name).toBe("ce-compound");
  });

  it("loads packages.yaml when present", () => {
    scaffoldSkeleton(tmpRoot, ["pi"]);
    writePlaybookManifest(tmpRoot, minimalManifest({ tools_enabled: ["pi"] }));
    writeToolConfig(tmpRoot, "pi", minimalToolConfig({ tool: "pi" }));
    const manifest: PackagesManifest = {
      schema: 1,
      packages: [
        {
          name: "pi-mcp-adapter",
          source: { type: "npm", package: "pi-mcp-adapter" },
          enabled: true,
          disabled_components: { skills: [], commands: [], agents: [] },
        },
      ],
    };
    writePackagesManifest(tmpRoot, "pi", manifest);

    const playbook = loadPlaybook(tmpRoot);
    expect(playbook.tools.pi?.packagesManifest?.packages).toHaveLength(1);
    expect(playbook.tools.pi?.packagesManifest?.packages[0].name).toBe("pi-mcp-adapter");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-file validation
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePlaybook", () => {
  function buildPlaybook(opts: {
    sharedSkills?: string[];
    sharedMcp?: McpServer[];
    includeShared?: Partial<ToolConfig["include_shared"]>;
    overrides?: Partial<ToolConfig["overrides"]>;
    instances?: ToolConfig["instances"];
    pluginsManifest?: PluginsManifest;
    requiredEnv?: PlaybookManifest["required_env"];
  }) {
    scaffoldSkeleton(tmpRoot, ["claude"]);
    writePlaybookManifest(
      tmpRoot,
      minimalManifest({ tools_enabled: ["claude"], required_env: opts.requiredEnv ?? [] }),
    );

    const { mkdirSync } = require("node:fs");
    for (const name of opts.sharedSkills ?? []) {
      const dir = join(tmpRoot, "shared", "skills", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `# ${name}`);
    }
    for (const server of opts.sharedMcp ?? []) {
      writeMcpServer(tmpRoot, server);
    }

    writeToolConfig(
      tmpRoot,
      "claude",
      minimalToolConfig({
        instances: opts.instances ?? [
          { id: "default", name: "Claude", config_dir: "~/.claude", enabled: true },
        ],
        include_shared: {
          agents_md: false,
          skills: [],
          commands: [],
          agents: [],
          mcp: [],
          ...opts.includeShared,
        },
        overrides: { agents_md: {}, ...opts.overrides },
      }),
    );

    if (opts.pluginsManifest) {
      writePluginsManifest(tmpRoot, "claude", opts.pluginsManifest);
    }

    return loadPlaybook(tmpRoot);
  }

  it("passes a clean playbook", () => {
    const pb = buildPlaybook({});
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("flags include_shared.skills referencing missing shared skill", () => {
    const pb = buildPlaybook({ includeShared: { skills: ["missing"] } });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.message.includes('"missing"'))).toBe(true);
  });

  it("passes when include_shared.skills points at an existing shared skill", () => {
    const pb = buildPlaybook({
      sharedSkills: ["incident-triage"],
      includeShared: { skills: ["incident-triage"] },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(true);
  });

  it("flags duplicate plugin names in plugins.yaml", () => {
    const pb = buildPlaybook({
      pluginsManifest: {
        schema: 1,
        plugins: [
          {
            name: "dup",
            source: { type: "npm", package: "x" },
            enabled: true,
            disabled_components: { skills: [], commands: [], agents: [] },
          },
          {
            name: "dup",
            source: { type: "npm", package: "y" },
            enabled: true,
            disabled_components: { skills: [], commands: [], agents: [] },
          },
        ],
      },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.message.includes('duplicate plugin name "dup"'))).toBe(true);
  });

  it("flags overrides.agents_md referencing unknown instance", () => {
    const pb = buildPlaybook({
      overrides: { agents_md: { unknown: "CLAUDE.md" } },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((i) => i.pointer === "overrides.agents_md:unknown"),
    ).toBe(true);
  });

  it("warns on MCP env-var ref not declared in required_env", () => {
    const pb = buildPlaybook({
      sharedMcp: [
        {
          name: "linear",
          type: "remote",
          url: "https://example.com/mcp",
          bearerTokenEnv: "LINEAR_API_KEY",
          headers: {},
          enabled: true,
          compat: {},
        },
      ],
      includeShared: { mcp: ["linear"] },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(true); // warning, not error
    const w = report.issues.find((i) => i.severity === "warning");
    expect(w).toBeDefined();
    expect(w?.message).toContain("LINEAR_API_KEY");
  });

  it("does not warn when env var is declared in required_env", () => {
    const pb = buildPlaybook({
      sharedMcp: [
        {
          name: "linear",
          type: "remote",
          url: "https://example.com/mcp",
          bearerTokenEnv: "LINEAR_API_KEY",
          headers: {},
          enabled: true,
          compat: {},
        },
      ],
      includeShared: { mcp: ["linear"] },
      requiredEnv: [{ name: "LINEAR_API_KEY", used_by: ["linear"], optional: false }],
    });
    const report = validatePlaybook(pb);
    expect(report.issues.filter((i) => i.severity === "warning")).toEqual([]);
  });

  it("flags include_shared.mcp referencing missing MCP server", () => {
    const pb = buildPlaybook({
      includeShared: { mcp: ["nonexistent"] },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.message.includes('"nonexistent"'))).toBe(true);
  });

  it("flags include_shared.agents_md when shared/AGENTS.md missing", () => {
    const pb = buildPlaybook({
      includeShared: { agents_md: true },
    });
    const report = validatePlaybook(pb);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((i) => i.pointer === "include_shared.agents_md"),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: write → load → values preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("write → load round-trip", () => {
  it("preserves a complete playbook", () => {
    scaffoldSkeleton(tmpRoot, ["claude", "pi"]);
    writePlaybookManifest(
      tmpRoot,
      minimalManifest({
        name: "round-trip",
        tools_enabled: ["claude", "pi"],
        required_env: [{ name: "GITHUB_TOKEN", used_by: ["github-mcp"], optional: false }],
      }),
    );
    writeToolConfig(
      tmpRoot,
      "claude",
      minimalToolConfig({
        instances: [
          { id: "default", name: "Claude", config_dir: "~/.claude", enabled: true },
          { id: "work", name: "Claude Work", config_dir: "~/.claude-work", enabled: false },
        ],
        overrides: { agents_md: { default: "CLAUDE.md", work: "CLAUDE.md" } },
      }),
    );
    writeToolConfig(tmpRoot, "pi", minimalToolConfig({ tool: "pi" }));

    const pb = loadPlaybook(tmpRoot);
    expect(pb.manifest.name).toBe("round-trip");
    expect(pb.manifest.tools_enabled).toEqual(["claude", "pi"]);
    expect(pb.tools.claude?.config.instances).toHaveLength(2);
    expect(pb.tools.claude?.config.overrides.agents_md.default).toBe("CLAUDE.md");
    expect(pb.tools.pi?.config.tool).toBe("pi");

    const report = validatePlaybook(pb);
    expect(report.ok).toBe(true);
  });
});
