import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolInstance } from "../types.js";

// installMcpServersToInstance/uninstallMcpServersFromInstance shell out to the
// real `claude` CLI for Claude instances — mock child_process so tests never
// invoke a real binary, and so we can assert on exactly what would have run.
const execFileCalls: Array<{ file: string; args: string[]; options: any }> = [];
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execFile: (file: string, args: string[], options: any, callback: any) => {
      execFileCalls.push({ file, args, options });
      const cb = typeof options === "function" ? options : callback;
      cb(null, { stdout: "", stderr: "" });
    },
  };
});

import { installMcpServersToInstance, uninstallMcpServersFromInstance } from "./mcp.js";

const TEST_ROOT = join(tmpdir(), `blackbook-mcp-test-${Date.now()}`);
const TEST_HOME = join(TEST_ROOT, "home");
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_CACHE = process.env.XDG_CACHE_HOME;

function claudeInstance(configDir: string): ToolInstance {
  return {
    toolId: "claude-code",
    instanceId: "default",
    name: "Claude",
    configDir,
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: true,
  };
}

function piInstance(configDir: string): ToolInstance {
  return {
    toolId: "pi",
    instanceId: "default",
    name: "Pi",
    configDir,
    skillsSubdir: "~/.agents/skills",
    commandsSubdir: "prompts",
    agentsSubdir: null,
    enabled: true,
    kind: "tool",
    pluginFlatInstall: true,
  };
}

function opencodeInstance(configDir: string): ToolInstance {
  return {
    toolId: "opencode",
    instanceId: "default",
    name: "OpenCode",
    configDir,
    skillsSubdir: "~/.agents/skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
  };
}

function writePluginMcpJson(pluginDir: string, servers: Record<string, unknown>): void {
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
}

beforeEach(() => {
  execFileCalls.length = 0;
  process.env.HOME = TEST_HOME;
  process.env.XDG_CACHE_HOME = join(TEST_ROOT, "cache");
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_XDG_CACHE === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIGINAL_XDG_CACHE;
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("installMcpServersToInstance", () => {
  it("is a no-op for tools other than Claude/Pi", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-opencode");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const result = await installMcpServersToInstance("demo-plugin", pluginDir, opencodeInstance(join(TEST_ROOT, "opencode")));
    expect(result).toEqual({ count: 0, errors: [] });
    expect(execFileCalls).toHaveLength(0);
  });

  it("is a no-op when the plugin has no MCP servers", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-empty");
    mkdirSync(pluginDir, { recursive: true });
    const result = await installMcpServersToInstance("demo-plugin", pluginDir, piInstance(join(TEST_ROOT, "pi")));
    expect(result).toEqual({ count: 0, errors: [] });
  });

  it("shells out to the claude CLI per server for a Claude instance", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));

    const result = await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    expect(result.count).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].file).toBe("claude");
    expect(execFileCalls[0].args[0]).toBe("mcp");
    expect(execFileCalls[0].args[1]).toBe("add-json");
    expect(execFileCalls[0].args[2]).toBe("search");
    expect(JSON.parse(execFileCalls[0].args[3])).toEqual({ command: "npx", args: ["search-mcp"] });
    expect(execFileCalls[0].args.slice(4)).toEqual(["--scope", "user"]);
    expect(execFileCalls[0].options.env.CLAUDE_CONFIG_DIR).toBe(instance.configDir);

    // Never hand-edits ~/.claude.json directly.
    expect(existsSync(join(TEST_HOME, ".claude.json"))).toBe(false);
  });

  it("writes a merged ~/.config/mcp/mcp.json for a Pi instance", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-pi");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const instance = piInstance(join(TEST_ROOT, "pi"));

    const result = await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    expect(result.count).toBe(1);
    const mcpPath = join(TEST_HOME, ".config", "mcp", "mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    const written = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(written.mcpServers.search).toEqual({ command: "npx", args: ["search-mcp"] });
    expect(execFileCalls).toHaveLength(0);
  });

  it("merges into an existing ~/.config/mcp/mcp.json without clobbering other servers", async () => {
    const mcpPath = join(TEST_HOME, ".config", "mcp", "mcp.json");
    mkdirSync(join(TEST_HOME, ".config", "mcp"), { recursive: true });
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { existing: { command: "other" } } }));

    const pluginDir = join(TEST_ROOT, "plugin-pi-2");
    writePluginMcpJson(pluginDir, { search: { command: "npx" } });
    await installMcpServersToInstance("demo-plugin", pluginDir, piInstance(join(TEST_ROOT, "pi")));

    const written = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(written.mcpServers.existing).toEqual({ command: "other" });
    expect(written.mcpServers.search).toEqual({ command: "npx" });
  });
});

describe("uninstallMcpServersFromInstance", () => {
  it("removes only the servers owned by the given plugin, via the claude CLI", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx" } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));
    await installMcpServersToInstance("demo-plugin", pluginDir, instance);
    execFileCalls.length = 0;

    const removed = await uninstallMcpServersFromInstance("demo-plugin", instance);

    expect(removed).toBe(1);
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].args).toEqual(["mcp", "remove", "search", "--scope", "user"]);
  });

  it("removes only the given plugin's servers from the shared Pi mcp.json, leaving others intact", async () => {
    const instance = piInstance(join(TEST_ROOT, "pi"));

    const pluginADir = join(TEST_ROOT, "plugin-a");
    writePluginMcpJson(pluginADir, { "a-server": { command: "a" } });
    await installMcpServersToInstance("plugin-a", pluginADir, instance);

    const pluginBDir = join(TEST_ROOT, "plugin-b");
    writePluginMcpJson(pluginBDir, { "b-server": { command: "b" } });
    await installMcpServersToInstance("plugin-b", pluginBDir, instance);

    const removed = await uninstallMcpServersFromInstance("plugin-a", instance);
    expect(removed).toBe(1);

    const mcpPath = join(TEST_HOME, ".config", "mcp", "mcp.json");
    const written = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(written.mcpServers["a-server"]).toBeUndefined();
    expect(written.mcpServers["b-server"]).toEqual({ command: "b" });
  });

  it("returns 0 for a plugin with nothing installed", async () => {
    const removed = await uninstallMcpServersFromInstance("nothing-installed", piInstance(join(TEST_ROOT, "pi")));
    expect(removed).toBe(0);
  });
});
