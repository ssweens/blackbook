/**
 * MCP server install/uninstall for the two tools that read a shared,
 * portable `{"mcpServers": {...}}` convention: Claude Code and Pi (via the
 * `pi-mcp-adapter` extension). Codex (TOML config), Amp, and OpenCode are
 * out of scope here — Amp/OpenCode instead get a plugin's `mcp.json` copied
 * alongside its skill (see `installPluginItemsToInstance` in managed.ts);
 * Codex has no shared-file convention to write to at all.
 *
 * Both Claude and Pi: directly read-merge-written to their respective JSON
 * files. Blackbook is the sole manager — no tool CLI is ever called.
 */

import { mkdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { InstalledItem, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { instanceKey, buildManifestItemKey, migrateManifestKeys } from "../plugin-helpers.js";
import { getPluginMcpServers, resolvePluginRootVars } from "../path-utils.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import { logError } from "../validation.js";
import { expandPath } from "../config/path.js";

function loadMigratedManifest(): Manifest {
  const manifest = loadManifest();
  migrateManifestKeys(manifest);
  return manifest;
}

// ── Claude MCP config ──────────────────────────────────────────────────────
// Claude Code reads user-scoped MCP servers from `.claude.json` in its config
// dir (`claude mcp add --scope user` writes there). For the default instance
// (~/.claude, no CLAUDE_CONFIG_DIR) that file is ~/.claude.json in $HOME;
// for any other config dir it is <configDir>/.claude.json. `settings.json`
// is NOT read for MCP servers — earlier Blackbook versions wrote there, so
// install/uninstall also clear any leftover entry of the same name.

function getClaudeMcpPath(instance: ToolInstance): string {
  const configDir = expandPath(instance.configDir);
  return configDir === join(homedir(), ".claude") ? join(homedir(), ".claude.json") : join(configDir, ".claude.json");
}

function getClaudeLegacySettingsPath(instance: ToolInstance): string {
  return join(expandPath(instance.configDir), "settings.json");
}

/** Parse a JSON object file; `{}` when absent. Throws on unreadable JSON rather than risk overwriting it. */
function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed as Record<string, unknown>;
}

function serversOf(obj: Record<string, unknown>): Record<string, unknown> {
  const servers = obj.mcpServers;
  return servers && typeof servers === "object" && !Array.isArray(servers) ? { ...(servers as Record<string, unknown>) } : {};
}

function readClaudeMcpServers(instance: ToolInstance): Record<string, unknown> {
  try {
    return serversOf(readJsonObject(getClaudeMcpPath(instance)));
  } catch {
    return {};
  }
}

/** Replace only `mcpServers` in the file, keeping every other key (Claude keeps much more state here). */
function updateServersIn(path: string, update: (servers: Record<string, unknown>) => boolean): void {
  const existing = readJsonObject(path);
  const servers = serversOf(existing);
  if (!update(servers)) return;
  existing.mcpServers = servers;
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify(existing, null, 2) + "\n");
}

function removeLegacySettingsServer(instance: ToolInstance, name: string): void {
  try {
    updateServersIn(getClaudeLegacySettingsPath(instance), (servers) => {
      if (!(name in servers)) return false;
      delete servers[name];
      return true;
    });
  } catch {
    // Unreadable legacy settings: leave it alone.
  }
}

function writeClaudeMcpServer(instance: ToolInstance, name: string, config: unknown): void {
  updateServersIn(getClaudeMcpPath(instance), (servers) => {
    servers[name] = config;
    return true;
  });
  removeLegacySettingsServer(instance, name);
}

function removeClaudeMcpServer(instance: ToolInstance, name: string): void {
  updateServersIn(getClaudeMcpPath(instance), (servers) => {
    if (!(name in servers)) return false;
    delete servers[name];
    return true;
  });
  removeLegacySettingsServer(instance, name);
}

// ── Pi MCP config ──────────────────────────────────────────────────────────
// Stored in ~/.config/mcp/mcp.json under "mcpServers".

function getPiGlobalMcpPath(): string {
  return join(homedir(), ".config", "mcp", "mcp.json");
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
  const dest = instance.toolId === "claude-code" ? getClaudeMcpPath(instance) : getPiGlobalMcpPath();

  let count = 0;
  const errors: string[] = [];

  for (const [serverName, rawConfig] of Object.entries(servers)) {
    const config = resolvePluginRootVars(rawConfig, sourcePath);
    try {
      if (instance.toolId === "claude-code") {
        writeClaudeMcpServer(instance, serverName, config);
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
        removeClaudeMcpServer(instance, item.name);
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
