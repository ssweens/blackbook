/**
 * Plugin installation status checking and component toggling
 */

import { existsSync, lstatSync, unlinkSync, rmSync, renameSync } from "fs";
import { join, dirname, relative } from "path";
import { resolveInstanceSubdirPath } from "./path-utils.js";
import type { Plugin, ToolInstance } from "./types.js";
import { getToolInstances, getEnabledToolInstances, setPluginComponentEnabled } from "./config.js";
import { validatePluginMetadata, logError } from "./validation.js";
import { loadManifest, saveManifest, type Manifest } from "./manifest.js";
import { getPluginSourcePath, instanceKey, createSymlink, isSymlink, buildManifestItemKey, migrateManifestKeys } from "./plugin-helpers.js";
import { countGetPluginToolStatus } from "./perf.js";
// isConfigOnlyInstance is canonicalized in install.ts. Per-tool status logic
// (supports/isInstalled) now lives in the adapters, dispatched by toolId.
import { isConfigOnlyInstance } from "./install.js";
import { ensureAgentsSkillMaterialized } from "./adapters/managed.js";
import { getAdapterForTool, type InstalledContext } from "./adapters/types.js";
import { fetchClaudeInstalledPluginIds } from "./adapters/claude.js";
import { fetchCodexInstalledPluginIds } from "./adapters/codex.js";

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

function getCodexInstalledPluginIds(): Set<string> {
  if (codexInstalledCacheGeneration === statusCacheGeneration) return codexInstalledPluginIds;
  codexInstalledCacheGeneration = statusCacheGeneration;
  codexInstalledPluginIds = fetchCodexInstalledPluginIds();
  return codexInstalledPluginIds;
}

function getClaudeInstalledPluginIds(): Set<string> {
  if (claudeInstalledCacheGeneration === statusCacheGeneration) return claudeInstalledPluginIds;
  claudeInstalledCacheGeneration = statusCacheGeneration;
  claudeInstalledPluginIds = fetchClaudeInstalledPluginIds();
  return claudeInstalledPluginIds;
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

  // Shared, lazily-resolved state for the adapters' installed-checks. The Codex
  // manifest is loaded at most once per call (its file-copy installs must also
  // consult Blackbook's own manifest, not just `codex plugin list`).
  let manifest: Manifest | null = null;
  const ctx: InstalledContext = {
    getClaudeInstalledIds: getClaudeInstalledPluginIds,
    getCodexInstalledIds: getCodexInstalledPluginIds,
    getManifest: () => {
      if (manifest === null) {
        manifest = loadManifest();
        migrateManifestKeys(manifest);
      }
      return manifest;
    },
  };

  for (const instance of instances) {
    const hasSkills = plugin.skills.length > 0;
    const hasCommands = plugin.commands.length > 0;
    const hasAgents = plugin.agents.length > 0;
    const hasHooks = plugin.hooks.length > 0;

    const canInstallSkills = hasSkills && instance.skillsSubdir !== null;
    const canInstallCommands = hasCommands && instance.commandsSubdir !== null;
    const canInstallAgents = hasAgents && instance.agentsSubdir !== null;

    const adapter = getAdapterForTool(instance.toolId);
    const { supported, reason: supportReason } = adapter.supports({
      plugin,
      instance,
      canInstallSkills,
      canInstallCommands,
      canInstallAgents,
      hasHooks,
    });

    let installed = false;
    const installedVersion: string | undefined = undefined;
    const enabled = instance.enabled;

    if (enabled && supported) {
      // Tool-specific plugin checks only. No skill/command/agent filesystem proxy scans.
      installed = adapter.isInstalled(plugin, instance, ctx);
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
        ? resolveInstanceSubdirPath(instance.configDir, subdir, suffix)
        : resolveInstanceSubdirPath(instance.configDir, subdir, plugin.name, suffix);

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
        ? resolveInstanceSubdirPath(instance.configDir, subdir, suffix)
        : resolveInstanceSubdirPath(instance.configDir, subdir, plugin.name, suffix);
      const destRel = instance.pluginFlatInstall
        ? join(subdir, suffix)
        : join(subdir, plugin.name, suffix);

      if (!manifest.tools[key]) {
        manifest.tools[key] = { items: {} };
      }

      // Flat tools (Claude) keep skills as a derived view of the shared
      // ~/.agents/skills store — re-enabling links to the store entry
      // (materializing it from the cache if missing), never to the cache.
      let linkSource = src;
      if (kind === "skill" && instance.pluginFlatInstall) {
        try {
          // Relative link: survives home-dir moves/renames (portability).
          linkSource = relative(
            dirname(dest),
            ensureAgentsSkillMaterialized(src, plugin.name, componentName).agentsPath,
          );
        } catch (error) {
          logError(`Failed to materialize ${componentName} into ~/.agents/skills`, error);
          failures.push(
            `Failed to enable ${kind} ${componentName} in ${instance.name}: could not materialize shared skill store entry`,
          );
          continue;
        }
      }

      const result = createSymlink(linkSource, dest, {
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
