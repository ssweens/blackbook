import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { codexAdapter, buildCodexOwnership } from "./index.js";
import type { McpServer, ToolInstance } from "../../playbook/index.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-codex-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const inst = (configDir: string): ToolInstance => ({
  id: "default",
  name: "Codex",
  config_dir: configDir,
  enabled: true,
});

describe("codexAdapter — defaults", () => {
  it("artifact-bundle paradigm with native MCP", () => {
    expect(codexAdapter.defaults.toolId).toBe("codex");
    expect(codexAdapter.defaults.capabilities.bundleParadigm).toBe("artifact");
    expect(codexAdapter.defaults.capabilities.mcp).toBe(true);
  });
});

describe("buildCodexOwnership", () => {
  it("attributes plugin skills to plugin name", () => {
    const plug = join(tmp, "plugins", "linear");
    mkdirSync(join(plug, ".codex-plugin"), { recursive: true });
    writeFileSync(
      join(plug, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "linear", skills: "./skills/" }),
    );
    mkdirSync(join(plug, "skills", "ticket-creator"), { recursive: true });
    writeFileSync(join(plug, "skills", "ticket-creator", "SKILL.md"), "# x");

    expect(buildCodexOwnership(tmp).get("skill:ticket-creator")).toBe("linear");
  });
});

describe("codexAdapter — scan excludes system skills", () => {
  it("ignores skills/.system/", async () => {
    mkdirSync(join(tmp, "skills", ".system", "marker"), { recursive: true });
    writeFileSync(join(tmp, "skills", ".system", "marker", "SKILL.md"), "# system");
    mkdirSync(join(tmp, "skills", "user-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills", "user-skill", "SKILL.md"), "# u");

    const inv = await codexAdapter.scan(inst(tmp));
    const names = inv.artifacts.filter((a) => a.type === "skill").map((a) => a.name);
    expect(names).toEqual(["user-skill"]);
  });
});

describe("codexAdapter — MCP TOML emission", () => {
  it("merges mcp_servers into existing config.toml without disturbing other tables", async () => {
    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(
      join(liveDir, "config.toml"),
      `model = "gpt-5"\n\n[features]\nchild_agents_md = true\n`,
    );
    const servers: McpServer[] = [
      {
        name: "github",
        type: "remote",
        url: "https://gh/mcp",
        bearerTokenEnv: "GITHUB_TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      },
      {
        name: "local",
        type: "local",
        command: ["npx", "-y", "@x/srv"],
        env: { TOKEN: "$env:T" },
        enabled: true,
        compat: {},
      },
    ];
    const result = await codexAdapter.emitMcp!(servers, inst(liveDir));
    expect(result.written).toHaveLength(1);

    const parsed = parseToml(readFileSync(join(liveDir, "config.toml"), "utf-8")) as {
      model: string;
      features: { child_agents_md: boolean };
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.model).toBe("gpt-5");
    expect(parsed.features.child_agents_md).toBe(true);
    expect(parsed.mcp_servers.github.bearerTokenEnv).toBe("GITHUB_TOKEN");
    expect(parsed.mcp_servers.local.command).toBe("npx");
    expect((parsed.mcp_servers.local as { args: string[] }).args).toEqual(["-y", "@x/srv"]);
  });

  it("idempotent on second emit", async () => {
    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const servers: McpServer[] = [
      { name: "x", type: "remote", url: "https://x", bearerTokenEnv: "T", headers: {}, enabled: true, compat: {} },
    ];
    const a = await codexAdapter.emitMcp!(servers, inst(liveDir));
    expect(a.written).toHaveLength(1);
    const b = await codexAdapter.emitMcp!(servers, inst(liveDir));
    expect(b.unchanged).toHaveLength(1);
  });

  it("refuses to overwrite malformed TOML", async () => {
    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, "config.toml"), "garbage = = =");
    await expect(
      codexAdapter.emitMcp!([], inst(liveDir)),
    ).rejects.toThrow(/not valid TOML/);
  });
});
