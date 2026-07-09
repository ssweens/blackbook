/**
 * Plugin installation status checking and component toggling
 */

import { existsSync, lstatSync, unlinkSync, rmSync, renameSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import type { Plugin, ToolInstance } from "./types.js";
import { getToolInstances, getEnabledToolInstances, setPluginComponentEnabled } from "./config.js";
import { safePath, validatePluginMetadata, logError } from "./validation.js";
import { loadManifest, saveManifest, type Manifest } from "./manifest.js";
import { getPluginSourcePath, instanceKey, createSymlink, isSymlink, buildManifestItemKey, migrateManifestKeys } from "./plugin-helpers.js";
import { countGetPluginToolStatus } from "./perf.js";
import { getPiBridgeInstalledPluginIds as loadPiBridgeInstalledPluginIds } from "./pi-bridge.js";
// isPiPluginBridgeReady and isConfigOnlyInstance are canonicalized in install.ts,
// the single home for Pi-bridge resolution logic (it also operates the bridge).
// Imported here so the status check and the install path never diverge.
import { isPiPluginBridgeReady, isConfigOnlyInstance } from "./install.js";

export interface ToolInstallStatus {
  toolId: string;
  instanceId: string;
  name: string;
  installed: boolean;
  supported: boolean;
  enabled: boolean;
  supportReason?: string;
  installedVersion?: string;
}

/**
 * Whether Blackbook's own manifest records a file-copy install of `pluginName`
 * for this instance. Codex is materialized via file-copy (like OpenCode/Amp),
 * so `codex plugin list` alone never sees Blackbook-installed plugins; this
 * lets the status check recognize them. Checks both the bare toolId key and the
 * `toolId:instanceId` key, matching getInstalledPluginsForInstance().
 */
function manifestHasPluginForInstance(
  manifest: Manifest,
  instance: ToolInstance,
  pluginName: string,
): boolean {
  const keys = [instance.toolId, `${instance.toolId}:${instance.instanceId}`];
  for (const key of keys) {
    const items = manifest.tools[key]?.items;
    if (!items) continue;
    for (const item of Object.values(items)) {
      if ((item.owner || "") === pluginName) return true;
    }
  }
  return false;
}

// ── Status Cache ────────────────────────────────────────────────────────────
// getPluginToolStatus() probes the filesystem for every skill/command/agent
// of every plugin. This is called O(plugins × tools × components) times per
// render. We cache results and invalidate when the store mutates plugin or
// tool state.

const statusCache = new Map<string, ToolInstallStatus[]>();
let statusCacheGeneration = 0;
let codexInstalledCacheGeneration = -1;
let codexInstalledPluginIds = new Set<string>();
let claudeInstalledCacheGeneration = -1;
let claudeInstalledPluginIds = new Set<string>();
let piBridgeInstalledCacheGeneration = -1;
let piBridgeInstalledPluginIds = new Set<string>();

function getCodexInstalledPluginIds(): Set<string> {
  if (codexInstalledCacheGeneration === statusCacheGeneration) return codexInstalledPluginIds;
  codexInstalledCacheGeneration = statusCacheGeneration;
  codexInstalledPluginIds = new Set<string>();
  try {
    const output = execFileSync("codex", ["plugin", "list"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("Marketplace ") || trimmed.startsWith("PLUGIN ")) continue;
      const match = trimmed.match(/^([^\s]+)\s+(.+)$/);
      if (!match) continue;
      const pluginId = match[1];
      const statusCell = match[2].toLowerCase();
      if (!pluginId.includes("@")) continue;
      if (statusCell.startsWith("installed") || statusCell.includes("installed,")) {
        codexInstalledPluginIds.add(pluginId);
      }
    }
  } catch {
    // If codex isn't available or list fails, treat as empty.
  }
  return codexInstalledPluginIds;
}

function getClaudeInstalledPluginIds(): Set<string> {
  if (claudeInstalledCacheGeneration === statusCacheGeneration) return claudeInstalledPluginIds;
  claudeInstalledCacheGeneration = statusCacheGeneration;
  claudeInstalledPluginIds = new Set<string>();
  try {
    const output = execFileSync("claude", ["plugin", "list"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const raw of output.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("❯ ")) continue;
      const id = line.slice(2).trim();
      if (id.includes("@")) claudeInstalledPluginIds.add(id);
    }
  } catch {
    // unavailable/failed CLI -> empty set
  }
  return claudeInstalledPluginIds;
}

function getPiBridgeInstalledPluginIds(): Set<string> {
  if (piBridgeInstalledCacheGeneration === statusCacheGeneration) return piBridgeInstalledPluginIds;
  piBridgeInstalledCacheGeneration = statusCacheGeneration;
  piBridgeInstalledPluginIds = loadPiBridgeInstalledPluginIds();
  return piBridgeInstalledPluginIds;
}

/** Invalidate the plugin tool status cache. Call after any plugin/tool mutation. */
export function invalidatePluginToolStatusCache(): void {
  statusCache.clear();
  statusCacheGeneration++;
}

function cacheKey(plugin: Plugin): string {
  const components = [
    plugin.marketplace,
    plugin.installedMarketplace ?? "",
    plugin.installedVersion ?? "",
    plugin.latestVersion ?? plugin.version ?? "",
    plugin.skills.join(","),
    plugin.commands.join(","),
    plugin.agents.join(","),
  ].join("|");
  return `${plugin.name}:${statusCacheGeneration}:${components}`;
}

function computePluginToolStatus(plugin: Plugin): ToolInstallStatus[] {
  const statuses: ToolInstallStatus[] = [];
  try {
    validatePluginMetadata(plugin);
  } catch (error) {
    logError(`Invalid plugin metadata for ${plugin.name}`, error);
    return statuses;
  }
  const instances = getToolInstances().filter((i) => i.kind === "tool");

  // Loaded lazily on first Codex instance: Codex installs are file-copy based,
  // so its installed-ness must also consult Blackbook's own manifest.
  let manifest: Manifest | null = null;

  for (const instance of instances) {
    const hasSkills = plugin.skills.length > 0;
    const hasCommands = plugin.commands.length > 0;
    const hasAgents = plugin.agents.length > 0;
    const hasHooks = plugin.hooks.length > 0;

    const canInstallSkills = hasSkills && instance.skillsSubdir !== null;
    const canInstallCommands = hasCommands && instance.commandsSubdir !== null;
    const canInstallAgents = hasAgents && instance.agentsSubdir !== null;

    const isClaude = instance.toolId === "claude-code";
    const isPi = instance.toolId === "pi";
    const isOpenCode = instance.toolId === "opencode";
    const isAmp = instance.toolId === "amp-code";
    const isCodex = instance.toolId === "openai-codex";

    const baseSupported = canInstallSkills || canInstallCommands || canInstallAgents ||
      (isClaude && (plugin.hasMcp || plugin.hasLsp || hasHooks));

    let supported = isCodex ? true : baseSupported;
    let supportReason: string | undefined;

    if (isOpenCode || isAmp) {
      supported = false;
      supportReason = "Plugin support is blocked for this tool until native plugin checks are implemented";
    } else if (isPi) {
      const piBridgeReady = isPiPluginBridgeReady();
      supported = piBridgeReady && baseSupported;
      if (!piBridgeReady) {
        supportReason = "Pi bridge missing (install: @ssweens/pi-plugins, pi-subagents, pi-mcp-adapter)";
      }
    }

    let installed = false;
    let installedVersion: string | undefined;
    const enabled = instance.enabled;

    if (enabled && supported) {
      // Tool-specific plugin checks only. No skill/command/agent filesystem proxy scans.
      if (isClaude) {
        const ids = getClaudeInstalledPluginIds();
        const id1 = `${plugin.name}@${plugin.marketplace}`;
        const id2 = plugin.installedMarketplace ? `${plugin.name}@${plugin.installedMarketplace}` : "";
        installed = ids.has(id1) || (id2 ? ids.has(id2) : false);
      } else if (isPi) {
        // Pi bridge state is authoritative; avoid file-based proxy checks.
        const ids = getPiBridgeInstalledPluginIds();
        const id1 = `${plugin.name}@${plugin.marketplace}`;
        const id2 = plugin.installedMarketplace ? `${plugin.name}@${plugin.installedMarketplace}` : "";
        installed = ids.has(id1) || (id2 ? ids.has(id2) : false);
      } else if (isCodex) {
        // Installed if EITHER Codex's native plugin manager knows about it OR
        // Blackbook's own file-copy manifest records it for this instance.
        const ids = getCodexInstalledPluginIds();
        const id1 = `${plugin.name}@${plugin.marketplace}`;
        const id2 = plugin.installedMarketplace ? `${plugin.name}@${plugin.installedMarketplace}` : "";
        const nativeInstalled = ids.has(id1) || (id2 ? ids.has(id2) : false);
        if (nativeInstalled) {
          installed = true;
        } else {
          if (manifest === null) {
            manifest = loadManifest();
            migrateManifestKeys(manifest);
          }
          installed = manifestHasPluginForInstance(manifest, instance, plugin.name);
        }
      }
    }

    statuses.push({
      toolId: instance.toolId,
      instanceId: instance.instanceId,
      name: instance.name,
      installed,
      supported,
      enabled,
      supportReason,
      installedVersion,
    });
  }

  return statuses;
}

export function getPluginToolStatus(plugin: Plugin): ToolInstallStatus[] {
  countGetPluginToolStatus();
  const key = cacheKey(plugin);
  const cached = statusCache.get(key);
  if (cached) return cached;

  const result = computePluginToolStatus(plugin);
  statusCache.set(key, result);
  return result;
}

export function togglePluginComponent(
  plugin: Plugin,
  kind: "skill" | "command" | "agent",
  componentName: string,
  enabled: boolean
): { success: boolean; error?: string } {
  // Update config first
  try {
    setPluginComponentEnabled(plugin.marketplace, plugin.name, kind, componentName, enabled);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const instances = getEnabledToolInstances();
  const manifest = loadManifest();
  migrateManifestKeys(manifest);
  const sourcePath = getPluginSourcePath(plugin);
  const failures: string[] = [];

  for (const instance of instances) {
    if (isConfigOnlyInstance(instance)) continue;
    const key = instanceKey(instance);
    const itemKey = buildManifestItemKey(plugin.name, kind, componentName);

    if (!enabled) {
      // Remove the component from this instance
      if (!manifest.tools[key]) continue;
      const item = manifest.tools[key].items[itemKey];
      if (!item) continue;

      // Resolve the actual destination path
      const subdir = kind === "skill" ? instance.skillsSubdir :
                     kind === "command" ? instance.commandsSubdir :
                     instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const destPath = instance.pluginFlatInstall
        ? join(instance.configDir, subdir, suffix)
        : join(instance.configDir, subdir, plugin.name, suffix);

      try {
        if (existsSync(destPath) || isSymlink(destPath)) {
          const stat = lstatSync(destPath);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            rmSync(destPath, { recursive: true });
          } else {
            unlinkSync(destPath);
          }
        }
      } catch (error) {
        logError(`Failed to remove ${kind} ${componentName} from ${instance.name}`, error);
        failures.push(
          `Failed to remove ${kind} ${componentName} from ${instance.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Restore backup if exists
      if (item.backup && existsSync(item.backup)) {
        try {
          renameSync(item.backup, destPath);
        } catch (error) {
          logError(`Failed to restore backup for ${componentName}`, error);
          failures.push(
            `Failed to restore backup for ${componentName} in ${instance.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (item.previous) {
        manifest.tools[key].items[itemKey] = item.previous;
      } else {
        delete manifest.tools[key].items[itemKey];
      }
    } else {
      // Enable: create symlink/copy for this component
      if (!sourcePath) continue;

      const subdir = kind === "skill" ? instance.skillsSubdir :
                     kind === "command" ? instance.commandsSubdir :
                     instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const src = join(sourcePath, `${kind}s`, suffix);
      if (!existsSync(src)) continue;

      const dest = instance.pluginFlatInstall
        ? join(instance.configDir, subdir, suffix)
        : join(instance.configDir, subdir, plugin.name, suffix);
      const destRel = instance.pluginFlatInstall
        ? join(subdir, suffix)
        : join(subdir, plugin.name, suffix);

      if (!manifest.tools[key]) {
        manifest.tools[key] = { items: {} };
      }

      const result = createSymlink(src, dest, {
        instanceScope: key,
        pluginName: plugin.name,
        itemKind: kind,
        itemName: componentName,
      });
      if (result.success) {
        manifest.tools[key].items[itemKey] = {
          kind,
          name: componentName,
          source: src,
          dest: destRel,
          backup: null,
          owner: plugin.name,
          previous: null,
        };
      } else {
        failures.push(
          `Failed to enable ${kind} ${componentName} in ${instance.name}: ${result.message}`,
        );
      }
    }
  }

  saveManifest(manifest);
  if (failures.length > 0) {
    return { success: false, error: failures.join("; ") };
  }
  return { success: true };
}
