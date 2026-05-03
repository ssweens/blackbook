import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistryForTests } from "../adapters/index.js";
import { registerAllAdapters } from "../adapters/all.js";
import {
  loadPlaybook,
  scaffoldSkeleton,
  writeMcpServer,
  writePackagesManifest,
  writePlaybookManifest,
  writeToolConfig,
  type McpServer,
} from "../playbook/index.js";
import { engineApply, enginePreview } from "./engine.js";

let tmp: string;
beforeEach(() => {
  __resetRegistryForTests();
  registerAllAdapters();
  tmp = mkdtempSync(join(tmpdir(), "blackbook-engine-test-"));
});
afterEach(() => {
  __resetRegistryForTests();
  rmSync(tmp, { recursive: true, force: true });
});

// Build a minimal playbook with one tool + a single shared skill
function buildBasicPlaybook(opts: {
  tool: "claude" | "pi";
  liveDir: string;
  withMcp?: McpServer;
  includeMcp?: string[];
  piWithAdapter?: boolean;
}) {
  const pbRoot = join(tmp, `pb-${opts.tool}`);
  scaffoldSkeleton(pbRoot, [opts.tool]);
  writePlaybookManifest(pbRoot, {
    playbook_schema_version: 1,
    name: "test",
    tools_enabled: [opts.tool],
    marketplaces: {},
    required_env: opts.withMcp?.type === "remote" && opts.withMcp.bearerTokenEnv
      ? [{ name: opts.withMcp.bearerTokenEnv, used_by: [opts.withMcp.name], optional: false }]
      : [],
    defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
    settings: { package_manager: "pnpm", backup_retention: 3 },
  });
  // Shared skill
  const skillDir = join(pbRoot, "shared", "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "# demo");
  // Optional MCP
  if (opts.withMcp) writeMcpServer(pbRoot, opts.withMcp);

  writeToolConfig(pbRoot, opts.tool, {
    tool: opts.tool,
    instances: [
      { id: "default", name: opts.tool, config_dir: opts.liveDir, enabled: true },
    ],
    include_shared: {
      agents_md: false,
      skills: ["demo"],
      commands: [],
      agents: [],
      mcp: opts.includeMcp ?? [],
    },
    overrides: { agents_md: {} },
    config_files: [],
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
  });

  if (opts.tool === "pi") {
    writePackagesManifest(pbRoot, "pi", {
      schema: 1,
      packages: opts.piWithAdapter
        ? [
            {
              name: "pi-mcp-adapter",
              source: { type: "npm", package: "pi-mcp-adapter" },
              enabled: true,
              disabled_components: { skills: [], commands: [], agents: [] },
            },
          ]
        : [],
    });
  }
  return loadPlaybook(pbRoot);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("engine — preview", () => {
  it("dry-run does not write to disk", async () => {
    const liveDir = join(tmp, "live");
    const playbook = buildBasicPlaybook({ tool: "claude", liveDir });
    const result = await enginePreview(playbook);
    expect(result.perInstance).toHaveLength(1);
    expect(result.perInstance[0].apply.performed.length).toBeGreaterThan(0);
    // No disk effect
    expect(() => readFileSync(join(liveDir, "skills", "demo", "SKILL.md"))).toThrow();
  });
});

describe("engine — apply", () => {
  it("writes intended files and reports performed ops", async () => {
    const liveDir = join(tmp, "live");
    const playbook = buildBasicPlaybook({ tool: "claude", liveDir });
    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(result.perInstance[0].errors).toEqual([]);
    expect(readFileSync(join(liveDir, "skills", "demo", "SKILL.md"), "utf-8")).toBe("# demo");
  });

  it("idempotent — second apply yields no changes", async () => {
    const liveDir = join(tmp, "live");
    const playbook = buildBasicPlaybook({ tool: "claude", liveDir });
    await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    const r2 = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(r2.perInstance[0].apply.performed).toEqual([]);
    expect(r2.perInstance[0].apply.errors).toEqual([]);
  });
});

describe("engine — required_env", () => {
  it("reports missing env vars from required_env", async () => {
    const liveDir = join(tmp, "live");
    const playbook = buildBasicPlaybook({
      tool: "claude",
      liveDir,
      withMcp: {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      includeMcp: ["github"],
    });
    const result = await enginePreview(playbook, { confirmRemovals: false, env: {} as NodeJS.ProcessEnv });
    expect(result.envCheck.ok).toBe(false);
    expect(result.envCheck.missing).toContain("GITHUB_TOKEN");
  });

  it("envCheck ok when var is set", async () => {
    const liveDir = join(tmp, "live");
    const playbook = buildBasicPlaybook({
      tool: "claude",
      liveDir,
      withMcp: {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      includeMcp: ["github"],
    });
    const result = await enginePreview(playbook, {
      confirmRemovals: false,
      env: { GITHUB_TOKEN: "x" } as NodeJS.ProcessEnv,
    });
    expect(result.envCheck.ok).toBe(true);
  });
});

describe("engine — MCP emission gating", () => {
  it("emits MCP for Claude with native support", async () => {
    const liveDir = join(tmp, "live-claude");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildBasicPlaybook({
      tool: "claude",
      liveDir,
      withMcp: {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      includeMcp: ["github"],
    });
    const result = await engineApply(playbook, {
      confirmRemovals: false,
      dryRun: false,
      env: { GITHUB_TOKEN: "x" } as NodeJS.ProcessEnv,
    });
    expect(result.perInstance[0].mcpEmit?.written).toHaveLength(1);
    expect(readFileSync(join(liveDir, ".mcp.json"), "utf-8")).toContain("github");
  });

  it("warns and skips MCP for Pi when pi-mcp-adapter not in packages", async () => {
    const liveDir = join(tmp, "live-pi");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildBasicPlaybook({
      tool: "pi",
      liveDir,
      withMcp: {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      includeMcp: ["github"],
      piWithAdapter: false,
    });
    const result = await engineApply(playbook, {
      confirmRemovals: false,
      dryRun: false,
      env: { GITHUB_TOKEN: "x" } as NodeJS.ProcessEnv,
    });
    expect(
      result.perInstance[0].errors.some((e) =>
        e.message.includes("pi-mcp-adapter is not in packages.yaml"),
      ),
    ).toBe(true);
    expect(result.perInstance[0].mcpEmit).toBeUndefined();
  });

  it("emits MCP for Pi when pi-mcp-adapter is present", async () => {
    const liveDir = join(tmp, "live-pi");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildBasicPlaybook({
      tool: "pi",
      liveDir,
      withMcp: {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      includeMcp: ["github"],
      piWithAdapter: true,
    });
    const result = await engineApply(playbook, {
      confirmRemovals: false,
      dryRun: false,
      env: { GITHUB_TOKEN: "x" } as NodeJS.ProcessEnv,
    });
    expect(result.perInstance[0].mcpEmit?.written).toHaveLength(1);
    expect(readFileSync(join(liveDir, ".mcp.json"), "utf-8")).toContain("github");
  });
});

describe("engine — toolFilter", () => {
  it("only runs adapters listed in toolFilter", async () => {
    const liveClaude = join(tmp, "live-claude");
    const livePi = join(tmp, "live-pi");
    const pbRoot = join(tmp, "pb-multi");
    scaffoldSkeleton(pbRoot, ["claude", "pi"]);
    writePlaybookManifest(pbRoot, {
      playbook_schema_version: 1,
      name: "multi",
      tools_enabled: ["claude", "pi"],
      marketplaces: {},
      required_env: [],
      defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
      settings: { package_manager: "pnpm", backup_retention: 3 },
    });
    for (const tool of ["claude", "pi"] as const) {
      const liveDir = tool === "claude" ? liveClaude : livePi;
      writeToolConfig(pbRoot, tool, {
        tool,
        instances: [{ id: "default", name: tool, config_dir: liveDir, enabled: true }],
        include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
        overrides: { agents_md: {} },
        config_files: [],
        lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
      });
    }
    const playbook = loadPlaybook(pbRoot);
    const result = await engineApply(playbook, {
      confirmRemovals: false,
      dryRun: false,
      toolFilter: ["claude"],
    });
    expect(result.perInstance.map((p) => p.toolId)).toEqual(["claude"]);
  });
});

describe("engine — disabled instance", () => {
  it("skips disabled instances", async () => {
    const liveDir = join(tmp, "live");
    const pbRoot = join(tmp, "pb");
    scaffoldSkeleton(pbRoot, ["claude"]);
    writePlaybookManifest(pbRoot, {
      playbook_schema_version: 1,
      name: "x",
      tools_enabled: ["claude"],
      marketplaces: {},
      required_env: [],
      defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
      settings: { package_manager: "pnpm", backup_retention: 3 },
    });
    writeToolConfig(pbRoot, "claude", {
      tool: "claude",
      instances: [{ id: "default", name: "Claude", config_dir: liveDir, enabled: false }],
      include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
      overrides: { agents_md: {} },
      config_files: [],
      lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
    });
    const playbook = loadPlaybook(pbRoot);
    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(result.perInstance).toEqual([]);
  });
});
