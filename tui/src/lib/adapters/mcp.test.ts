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
  it("writes to settings.json for a Claude instance", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx", args: ["search-mcp"] } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));
    mkdirSync(join(TEST_ROOT, "claude"), { recursive: true });

    const result = await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    expect(result.count).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Should write to <configDir>/settings.json
    const settingsPath = join(TEST_ROOT, "claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(written.mcpServers.search).toEqual({ command: "npx", args: ["search-mcp"] });
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
  it("removes only the servers owned by the given plugin from Claude settings.json", async () => {
    const pluginDir = join(TEST_ROOT, "plugin-claude");
    writePluginMcpJson(pluginDir, { search: { command: "npx" } });
    const instance = claudeInstance(join(TEST_ROOT, "claude"));
    mkdirSync(join(TEST_ROOT, "claude"), { recursive: true });
    await installMcpServersToInstance("demo-plugin", pluginDir, instance);

    const removed = await uninstallMcpServersFromInstance("demo-plugin", instance);

    expect(removed).toBe(1);
    // settings.json should have empty mcpServers
    const settingsPath = join(TEST_ROOT, "claude", "settings.json");
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
