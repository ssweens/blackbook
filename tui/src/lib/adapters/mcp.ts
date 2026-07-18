/**
 * MCP server install/uninstall for the two tools that read a shared,
 * portable `{"mcpServers": {...}}` convention: Claude Code and Pi (via the
 * `pi-mcp-adapter` extension). Codex (TOML config), Amp, and OpenCode are
 * out of scope here — Amp/OpenCode instead get a plugin's `mcp.json` copied
 * alongside its skill (see `installPluginItemsToInstance` in managed.ts);
 * Codex has no shared-file convention to write to at all.
 *
 * Claude: shelled out to the native `claude mcp` CLI, never hand-edited —
 * `~/.claude.json` is scope-keyed, Claude-owned state (same reasoning as
 * the plugin lifecycle in claude.ts: JSON surgery would desync it).
 *
 * Pi: `~/.config/mcp/mcp.json` is directly read-merge-written — unlike
 * `~/.claude.json`, this file is an external, tool-agnostic convention the
 * `pi-mcp-adapter` extension reads, not Pi's own internal state.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { InstalledItem, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { instanceKey, buildManifestItemKey, migrateManifestKeys } from "../plugin-helpers.js";
import { getPluginMcpServers } from "../path-utils.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import { logError } from "../validation.js";

const execFileAsync = promisify(execFile);

// Computed lazily (not a module-level constant) so it reflects HOME at call
// time — important for test sandboxing, and correct in general.
function getPiGlobalMcpPath(): string {
  return join(homedir(), ".config", "mcp", "mcp.json");
}

function loadMigratedManifest(): Manifest {
  const manifest = loadManifest();
  migrateManifestKeys(manifest);
  return manifest;
}

async function addClaudeMcpServer(instance: ToolInstance, name: string, config: unknown): Promise<void> {
  await execFileAsync("claude", ["mcp", "add-json", name, JSON.stringify(config), "--scope", "user"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: instance.configDir },
  });
}

async function removeClaudeMcpServer(instance: ToolInstance, name: string): Promise<void> {
  await execFileAsync("claude", ["mcp", "remove", name, "--scope", "user"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: instance.configDir },
  });
}

function readPiMcpServers(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(getPiGlobalMcpPath(), "utf-8"));
    const servers = parsed?.mcpServers;
    return servers && typeof servers === "object" && !Array.isArray(servers) ? servers : {};
  } catch {
    return {};
  }
}

function writePiMcpServers(servers: Record<string, unknown>): void {
  const path = getPiGlobalMcpPath();
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
}

function writePiMcpServer(name: string, config: unknown): void {
  const servers = readPiMcpServers();
  servers[name] = config;
  writePiMcpServers(servers);
}

function removePiMcpServer(name: string): void {
  const servers = readPiMcpServers();
  if (!(name in servers)) return;
  delete servers[name];
  writePiMcpServers(servers);
}

/**
 * Install every MCP server a plugin bundles (via `getPluginMcpServers`) to
 * an instance. No-op (0 count, no error) for any tool besides Claude/Pi, or
 * a plugin with no MCP servers — callers can unconditionally add this to
 * their component-install count without checking the tool first.
 */
export async function installMcpServersToInstance(
  pluginName: string,
  sourcePath: string,
  instance: ToolInstance,
): Promise<{ count: number; errors: string[] }> {
  if (instance.toolId !== "claude-code" && instance.toolId !== "pi") return { count: 0, errors: [] };
  const servers = getPluginMcpServers(sourcePath);
  if (!servers) return { count: 0, errors: [] };

  const manifest = loadMigratedManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) manifest.tools[key] = { items: {} };
  const toolManifest = manifest.tools[key];
  const dest = instance.toolId === "claude-code" ? `claude-mcp:${key}` : getPiGlobalMcpPath();

  let count = 0;
  const errors: string[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    try {
      if (instance.toolId === "claude-code") {
        await addClaudeMcpServer(instance, serverName, config);
      } else {
        writePiMcpServer(serverName, config);
      }
      const itemKey = buildManifestItemKey(pluginName, "mcp", serverName);
      const item: InstalledItem = {
        kind: "mcp",
        name: serverName,
        source: sourcePath,
        dest,
        backup: null,
        owner: pluginName,
        previous: toolManifest.items[itemKey] || null,
      };
      toolManifest.items[itemKey] = item;
      count++;
    } catch (error) {
      logError(`Failed to install MCP server ${serverName} for ${pluginName} in ${instance.name}`, error);
      errors.push(
        `Failed to install MCP server ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (count > 0) saveManifest(manifest);
  return { count, errors };
}

/** Remove every MCP server this plugin installed to an instance. Returns the count removed. */
export async function uninstallMcpServersFromInstance(pluginName: string, instance: ToolInstance): Promise<number> {
  if (instance.toolId !== "claude-code" && instance.toolId !== "pi") return 0;
  const manifest = loadMigratedManifest();
  const key = instanceKey(instance);
  const toolManifest = manifest.tools[key];
  if (!toolManifest) return 0;

  let removed = 0;
  const keysToRemove: string[] = [];

  for (const [entryKey, item] of Object.entries(toolManifest.items)) {
    if (item.kind !== "mcp") continue;
    if ((item.owner || "") !== pluginName) continue;
    try {
      if (instance.toolId === "claude-code") {
        await removeClaudeMcpServer(instance, item.name);
      } else {
        removePiMcpServer(item.name);
      }
      removed++;
    } catch (error) {
      logError(`Failed to uninstall MCP server ${item.name} for ${pluginName} in ${instance.name}`, error);
    }
    if (item.previous) {
      toolManifest.items[entryKey] = item.previous;
    } else {
      keysToRemove.push(entryKey);
    }
  }

  for (const entryKey of keysToRemove) delete toolManifest.items[entryKey];
  if (removed > 0) saveManifest(manifest);
  return removed;
}
