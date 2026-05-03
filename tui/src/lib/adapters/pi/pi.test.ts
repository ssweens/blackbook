import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  scaffoldSkeleton,
  writeMcpServer,
  writePackagesManifest,
  writePlaybookManifest,
  writeToolConfig,
  type McpServer,
  type ToolInstance,
} from "../../playbook/index.js";
import { piAdapter, piMcpEnabled, buildPiOwnership } from "./index.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-pi-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeInstance(configDir: string): ToolInstance {
  return { id: "default", name: "Pi", config_dir: configDir, enabled: true };
}

describe("piAdapter — defaults", () => {
  it("exposes pi as toolId and code-package paradigm", () => {
    expect(piAdapter.defaults.toolId).toBe("pi");
    expect(piAdapter.defaults.capabilities.bundleParadigm).toBe("code-package");
    expect(piAdapter.defaults.capabilities.mcp).toBe(false);
    expect(piAdapter.defaults.capabilities.mcpViaPackage?.packageName).toBe("pi-mcp-adapter");
  });
});

describe("buildPiOwnership", () => {
  it("returns empty map when config dir doesn't exist", () => {
    expect(buildPiOwnership(join(tmp, "nope")).size).toBe(0);
  });

  it("classifies artifacts contributed by a git-installed pi-package", () => {
    // Simulate: <config_dir>/git/owner/repo/ with package.json + skills + prompts
    const pkgRoot = join(tmp, "git", "owner", "repo");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({
        name: "my-pi-pkg",
        keywords: ["pi-package"],
        pi: {
          skills: ["./skills"],
          prompts: ["./prompts"],
          agents: ["./agents"],
        },
      }),
    );
    // skills/foo
    mkdirSync(join(pkgRoot, "skills", "foo"), { recursive: true });
    writeFileSync(join(pkgRoot, "skills", "foo", "SKILL.md"), "# foo");
    // prompts/bar.md
    mkdirSync(join(pkgRoot, "prompts"), { recursive: true });
    writeFileSync(join(pkgRoot, "prompts", "bar.md"), "# bar");
    // agents/baz.md
    mkdirSync(join(pkgRoot, "agents"), { recursive: true });
    writeFileSync(join(pkgRoot, "agents", "baz.md"), "# baz");

    const ownership = buildPiOwnership(tmp);
    expect(ownership.get("skill:foo")).toBe("my-pi-pkg");
    expect(ownership.get("command:bar")).toBe("my-pi-pkg");
    expect(ownership.get("agent:baz")).toBe("my-pi-pkg");
  });

  it("ignores packages without a 'pi' key", () => {
    const pkgRoot = join(tmp, "git", "owner", "norepo");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(join(pkgRoot, "package.json"), JSON.stringify({ name: "x" }));
    expect(buildPiOwnership(tmp).size).toBe(0);
  });
});

describe("piAdapter.scan", () => {
  it("returns empty inventory for missing config dir", async () => {
    const inv = await piAdapter.scan(makeInstance(join(tmp, "nope")));
    expect(inv.artifacts).toEqual([]);
  });

  it("tags standalone skills correctly", async () => {
    const skillDir = join(tmp, "skills", "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# my-skill");

    const inv = await piAdapter.scan(makeInstance(tmp));
    const skill = inv.artifacts.find((a) => a.type === "skill");
    expect(skill?.name).toBe("my-skill");
    expect(skill?.provenance.kind).toBe("standalone");
  });

  it("tags bundled skills with package name", async () => {
    // Install a fake pi-package
    const pkgRoot = join(tmp, "git", "me", "tools");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "tools", pi: { skills: ["./skills"] } }),
    );
    mkdirSync(join(pkgRoot, "skills", "ce-compound"), { recursive: true });
    writeFileSync(join(pkgRoot, "skills", "ce-compound", "SKILL.md"), "# ce-compound");

    // Materialize the same skill in the live skills dir (as if pi materialized it)
    const liveDir = join(tmp, "skills", "ce-compound");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, "SKILL.md"), "# ce-compound");

    const inv = await piAdapter.scan(makeInstance(tmp));
    const skill = inv.artifacts.find((a) => a.type === "skill" && a.name === "ce-compound");
    expect(skill?.provenance.kind).toBe("bundle");
    if (skill?.provenance.kind === "bundle") {
      expect(skill.provenance.bundleName).toBe("tools");
    }
  });
});

describe("piAdapter — preview + apply round-trip", () => {
  it("syncs a shared skill to the pi config dir", async () => {
    // Build a playbook
    const pbRoot = join(tmp, "playbook");
    scaffoldSkeleton(pbRoot, ["pi"]);
    writePlaybookManifest(pbRoot, {
      playbook_schema_version: 1,
      name: "test",
      tools_enabled: ["pi"],
      marketplaces: {},
      required_env: [],
      defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
      settings: { package_manager: "pnpm", backup_retention: 3 },
    });
    writeToolConfig(pbRoot, "pi", {
      tool: "pi",
      instances: [
        { id: "default", name: "Pi", config_dir: join(tmp, "live"), enabled: true },
      ],
      include_shared: { agents_md: true, skills: ["foo"], commands: [], agents: [], mcp: [] },
      overrides: { agents_md: {} },
      config_files: [],
      lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
    });
    // shared skill
    const skillDir = join(pbRoot, "shared", "skills", "foo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# foo");
    // shared AGENTS.md
    writeFileSync(join(pbRoot, "shared", "AGENTS.md"), "# agents");

    const playbook = loadPlaybook(pbRoot);
    const instance = playbook.tools.pi!.config.instances[0];

    const diff = await piAdapter.preview(playbook, instance);
    const addOps = diff.ops.filter((o) => o.kind === "add");
    expect(addOps.map((o) => o.name).sort()).toEqual(["AGENTS.md", "foo"]);

    const result = await piAdapter.apply(diff, instance, {
      confirmRemovals: false,
      dryRun: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.performed.length).toBe(2);

    // Verify on disk
    const liveSkill = join(tmp, "live", "skills", "foo", "SKILL.md");
    expect(readFileSync(liveSkill, "utf-8")).toBe("# foo");
    const liveAgents = join(tmp, "live", "AGENTS.md");
    expect(readFileSync(liveAgents, "utf-8")).toBe("# agents");

    // Re-running should be a no-op
    const diff2 = await piAdapter.preview(playbook, instance);
    expect(diff2.ops.filter((o) => o.kind === "no-op").length).toBe(2);
    expect(diff2.ops.filter((o) => o.kind !== "no-op").length).toBe(0);
  });
});

describe("piAdapter — MCP gating", () => {
  it("piMcpEnabled is false when pi-mcp-adapter is absent", () => {
    const fakeToolConfig = {
      packagesManifest: { schema: 1 as const, packages: [] },
      // other fields don't matter for the gate
    } as never;
    expect(piMcpEnabled(fakeToolConfig)).toBe(false);
  });

  it("piMcpEnabled is true when pi-mcp-adapter is present and enabled", () => {
    const fakeToolConfig = {
      packagesManifest: {
        schema: 1 as const,
        packages: [
          {
            name: "pi-mcp-adapter",
            source: { type: "npm" as const, package: "pi-mcp-adapter" },
            enabled: true,
            disabled_components: { skills: [], commands: [], agents: [] },
          },
        ],
      },
    } as never;
    expect(piMcpEnabled(fakeToolConfig)).toBe(true);
  });

  it("piMcpEnabled is false when adapter present but disabled", () => {
    const fakeToolConfig = {
      packagesManifest: {
        schema: 1 as const,
        packages: [
          {
            name: "pi-mcp-adapter",
            source: { type: "npm" as const, package: "pi-mcp-adapter" },
            enabled: false,
            disabled_components: { skills: [], commands: [], agents: [] },
          },
        ],
      },
    } as never;
    expect(piMcpEnabled(fakeToolConfig)).toBe(false);
  });

  it("emits MCP servers in standard format", async () => {
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
        command: ["npx", "-y", "@x/server"],
        env: { TOKEN: "$env:THE_TOKEN" },
        enabled: true,
        compat: {},
      },
    ];
    const result = await piAdapter.emitMcp!(servers, makeInstance(liveDir));
    expect(result.written).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(liveDir, ".mcp.json"), "utf-8"));
    expect(written.mcpServers.github.bearerTokenEnv).toBe("GITHUB_TOKEN");
    expect(written.mcpServers["local-srv"].env.TOKEN).toBe("$env:THE_TOKEN");
  });

  it("MCP emission is idempotent — second call reports unchanged", async () => {
    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const servers: McpServer[] = [
      { name: "x", type: "remote", url: "https://x", bearerTokenEnv: "T", headers: {}, enabled: true, compat: {} },
    ];
    const a = await piAdapter.emitMcp!(servers, makeInstance(liveDir));
    expect(a.written).toHaveLength(1);
    const b = await piAdapter.emitMcp!(servers, makeInstance(liveDir));
    expect(b.unchanged).toHaveLength(1);
    expect(b.written).toHaveLength(0);
  });
});

describe("piAdapter — registry", () => {
  it("registers idempotently", async () => {
    const { __resetRegistryForTests, getAdapter } = await import("../registry.js");
    const { registerPiAdapter } = await import("./index.js");
    __resetRegistryForTests();
    registerPiAdapter();
    registerPiAdapter(); // second call is a no-op
    expect(getAdapter("pi")).toBe(piAdapter);
  });
});
