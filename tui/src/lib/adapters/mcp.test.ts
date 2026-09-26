import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolInstance } from "../types.js";

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
    commandsSubdir: null,
    agentsSubdir: null,
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
    skillsSubdir: null,
    commandsSubdir: null,
    agentsSubdir: null,
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
  };
}

function writePluginMcpJson(pluginDir: string, servers: Record<string, unknown>) {
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "mcp.json"), JSON.stringify(servers, null, 2));
}

beforeEach(() => {
  process.env.HOME = TEST_HOME;
  process.env.XDG_CACHE_HOME = join(TEST_HOME, ".cache");
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(join(TEST_HOME, ".cache", "blackbook"), { recursive: true });
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_XDG_CACHE) process.env.XDG_CACHE_HOME = ORIGINAL_XDG_CACHE;
  else delete process.env.XDG_CACHE_HOME;
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("installMcpServersToInstance", () => {
  it("writes to <configDir>/.claude.json for a Claude instance (where `claude mcp add` writes)", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));
    mkdirSync(join(TEST_ROOT, "claude"), { recursive: true });

    const result = await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    expect(result.count).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Should write to <configDir>/.claude.json (settings.json is not read for MCP)
    const settingsPath = join(TEST_ROOT, "claude", ".claude.json");
    expect(existsSync(settingsPath)).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(written.mcpServers.search).toEqual({ command: "npx", args: ["search-mcp"] });
  });

  it("resolves ${CLAUDE_PLUGIN_ROOT} to the plugin directory (Claude and Pi)", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-root-vars");
    writePluginMcpJson(pluginDir, {
      daw: {
        command: "python3",
        args: ["-m", "server", "--root", "$CLAUDE_PLUGIN_ROOT/x"],
        cwd: "${CLAUDE_PLUGIN_ROOT}/daw",
        env: { PYTHONPATH: "${CLAUDE_PLUGIN_ROOT}/daw", KEEP: "$CLAUDE_PLUGIN_ROOTS" },
      },
    });
    const claudeDir = join(TEST_ROOT, "claude-vars");
    mkdirSync(claudeDir, { recursive: true });
    await installMcpServersToInstance("demo-plugin", pluginDir, claudeInstance(claudeDir));
    const written = JSON.parse(readFileSync(join(claudeDir, ".claude.json"), "utf-8")).mcpServers.daw;
    expect(written.cwd).toBe(join(pluginDir, "daw"));
    expect(written.env.PYTHONPATH).toBe(join(pluginDir, "daw"));
    expect(written.args).toEqual(["-m", "server", "--root", join(pluginDir, "x")]);
    // Only the exact variable is replaced, not a longer name that starts with it.
    expect(written.env.KEEP).toBe("$CLAUDE_PLUGIN_ROOTS");
    expect(JSON.stringify(written)).not.toContain("${CLAUDE_PLUGIN_ROOT}");

    await installMcpServersToInstance("demo-plugin", pluginDir, piInstance(join(TEST_ROOT, "pi-vars")));
    const pi = JSON.parse(readFileSync(join(TEST_HOME, ".config", "mcp", "mcp.json"), "utf-8")).mcpServers.daw;
    expect(pi.cwd).toBe(join(pluginDir, "daw"));
  });

  it("keeps every other .claude.json key, clears a legacy settings.json entry, and refuses unreadable JSON", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-merge");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const claudeDir = join(TEST_ROOT, "claude-merge");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { id: 1 }, projects: { "/p": {} }, mcpServers: { other: { command: "x" } } }));
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark", mcpServers: { search: { command: "stale" } } }));

    const r = await installMcpServersToInstance("demo-plugin", pluginDir, claudeInstance(claudeDir));
    expect(r.errors).toEqual([]);
    const cfg = JSON.parse(readFileSync(join(claudeDir, ".claude.json"), "utf-8"));
    expect(cfg.oauthAccount).toEqual({ id: 1 });
    expect(cfg.projects).toEqual({ "/p": {} });
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(["other", "search"]);
    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings).toEqual({ theme: "dark", mcpServers: {} });

    writeFileSync(join(claudeDir, ".claude.json"), "{ not json");
    const bad = await installMcpServersToInstance("demo-plugin", pluginDir, claudeInstance(claudeDir));
    expect(bad.count).toBe(0);
    expect(bad.errors.length).toBe(1);
    expect(readFileSync(join(claudeDir, ".claude.json"), "utf-8")).toBe("{ not json");
  });

  it("uses ~/.claude.json for the default ~/.claude instance", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-default");
    writePluginMcpJson(pluginDir, { search: { command: "npx" } });
    await installMcpServersToInstance("demo-plugin", pluginDir, claudeInstance("~/.claude"));
    expect(JSON.parse(readFileSync(join(TEST_HOME, ".claude.json"), "utf-8")).mcpServers.search).toEqual({ command: "npx" });
    expect(existsSync(join(TEST_HOME, ".claude", ".claude.json"))).toBe(false);
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
  it("removes only the servers owned by the given plugin from Claude's .claude.json", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx" } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));
    mkdirSync(join(TEST_ROOT, "claude"), { recursive: true });
    await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    const removed = await uninstallMcpServersFromInstance("demo-plugin", instance);

    expect(removed).toBe(1);
    // .claude.json should have empty mcpServers
    const settingsPath = join(TEST_ROOT, "claude", ".claude.json");
    const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(written.mcpServers).toEqual({});
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
});
