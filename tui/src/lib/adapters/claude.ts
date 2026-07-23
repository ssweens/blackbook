/**
 * Claude Code adapter. The plugin lifecycle (install/uninstall/update) goes
 * through the shared component file-copy engine — Blackbook is the sole plugin
 * manager. Claude's own CLI is NEVER called.
 *
 * The COMPONENT surface (installComponents/removeComponents), used by
 * enablePlugin/disablePlugin/syncPluginInstances, has always materialized
 * individual skill/command/agent files instead — so those methods delegate to
 * the shared managed file-copy engine. This asymmetry is intentional and
 * preserved from the pre-refactor behavior.
 */

import { existsSync, readFileSync, lstatSync, readdirSync } from "fs";
import { join } from "path";
import type { Plugin, ToolInstance } from "../types.js";
import { logError } from "../validation.js";
import { parseMarketplaces } from "../config.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import { scanPluginContents } from "../path-utils.js";
import {
  installPluginItemsToInstance,
  uninstallPluginItemsFromInstance,
} from "./managed.js";
import { pluginInstalledForManagedInstance } from "./shared.js";
import { installMcpServersToInstance, uninstallMcpServersFromInstance } from "./mcp.js";
import type {
  ToolAdapter,
  PerInstanceResult,
  SupportInput,
  InstalledContext,
} from "./types.js";

/**
 * Remove a plugin entry from Claude's `installed_plugins.json` for the given instance.
 * This file is the authoritative "what plugins are installed" record for Claude Code;
 * our scanner reads it, so we MUST keep it in sync on uninstall.
 */
export function removeFromClaudeInstalledPluginsJson(
  instance: ToolInstance,
  pluginName: string,
  marketplace: string,
): void {
  if (instance.toolId !== "claude-code") return;
  const path = join(instance.configDir, "plugins", "installed_plugins.json");
  if (!existsSync(path)) return;
  try {
    const content = readFileSync(path, "utf-8");
    const data = JSON.parse(content);
    if (!data?.plugins || typeof data.plugins !== "object") return;
    const key = `${pluginName}@${marketplace}`;
    let changed = false;
    if (key in data.plugins) {
      delete data.plugins[key];
      changed = true;
    }
    // Also remove any bare-name entries (older Claude versions)
    if (pluginName in data.plugins) {
      delete data.plugins[pluginName];
      changed = true;
    }
    if (changed) {
      // Atomic write (temp-file + rename): a real Claude Code process may read
      // this file concurrently, so it must never observe a truncated/partial write.
      atomicWriteFileSync(path, JSON.stringify(data, null, 2) + "\n");
    }
  } catch (error) {
    logError(`Failed to update ${path}`, error);
  }
}

function readClaudePluginMetadata(
  pluginDir: string,
): { version?: string; description?: string; homepage?: string } {
  for (const rel of [join(".claude-plugin", "plugin.json"), join(".claude-plugin", "manifest.json")]) {
    const metadataPath = join(pluginDir, rel);
    try {
      if (!lstatSync(metadataPath).isFile()) continue;
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      return {
        version: typeof metadata.version === "string" ? metadata.version : undefined,
        description: typeof metadata.description === "string" ? metadata.description : undefined,
        homepage: typeof metadata.homepage === "string" ? metadata.homepage : undefined,
      };
    } catch {
      // Try the next supported metadata filename.
    }
  }
  return {};
}

function getInstalledPluginsForClaudeInstance(instance: ToolInstance): Plugin[] {
  const plugins: Plugin[] = [];

  // Read installed_plugins.json for the authoritative list of installed plugins
  const installedPluginsPath = join(
    instance.configDir,
    "plugins/installed_plugins.json",
  );
  const installedPluginKeys = new Set<string>();
  const installedPluginRecords = new Map<string, { version?: string; installPath?: string }>();

  try {
    if (lstatSync(installedPluginsPath).isFile()) {
      const content = readFileSync(installedPluginsPath, "utf-8");
      const data = JSON.parse(content);
      if (data.plugins && typeof data.plugins === "object") {
        // Keys are in format "pluginName@marketplace". Values are usually arrays
        // of install records containing version/installPath metadata.
        for (const [key, value] of Object.entries(data.plugins)) {
          installedPluginKeys.add(key);
          const records = Array.isArray(value) ? value : [value];
          const first = records.find((r) => r && typeof r === "object") as Record<string, unknown> | undefined;
          installedPluginRecords.set(key, {
            version: typeof first?.version === "string" ? first.version : undefined,
            installPath: typeof first?.installPath === "string" ? first.installPath : undefined,
          });
        }
      }
    }
  } catch {
    // Ignore if file doesn't exist or can't be read
  }

  // If no installed_plugins.json or it's empty, fall back to scanning cache
  // (for backwards compatibility with older Claude versions)
  const claudePluginsDir = join(instance.configDir, "plugins/cache");
  // Don't early-return — even without plugins/cache, we still need to
  // scan skills/commands/agents directories below

  // Only scan cache subdirs for marketplaces that are still configured
  const configuredMarketplaceNames = new Set(
    parseMarketplaces().map((m) => m.name)
  );

  if (existsSync(claudePluginsDir)) try {
    const marketplaceDirs = readdirSync(claudePluginsDir);

    for (const marketplace of marketplaceDirs) {
      const marketplaceConfigured = configuredMarketplaceNames.has(marketplace);
      const hasInstalledRecordForMarketplace = [...installedPluginKeys].some((key) => key.endsWith(`@${marketplace}`));
      if (!marketplaceConfigured && !hasInstalledRecordForMarketplace) continue;
      const mpDir = join(claudePluginsDir, marketplace);

      try {
        const stat = lstatSync(mpDir);
        if (!stat.isDirectory()) continue;
      } catch (error) {
        logError(`Failed to stat ${mpDir}`, error);
        continue;
      }

      const pluginDirs = readdirSync(mpDir);

      for (const pluginName of pluginDirs) {
        // Check if this plugin is actually installed (in installed_plugins.json)
        // If we have installed_plugins.json data, use it as the filter
        if (installedPluginKeys.size > 0) {
          const pluginKey = `${pluginName}@${marketplace}`;
          if (!installedPluginKeys.has(pluginKey)) {
            continue; // Skip plugins that are cached but not installed
          }
        }

        const pluginDir = join(mpDir, pluginName);

        try {
          const stat = lstatSync(pluginDir);
          if (!stat.isDirectory()) continue;
        } catch (error) {
          logError(`Failed to stat ${pluginDir}`, error);
          continue;
        }

        let contentDir = pluginDir;
        const subDirs = readdirSync(pluginDir).filter((d) => {
          const p = join(pluginDir, d);
          try {
            return lstatSync(p).isDirectory() && !d.startsWith(".");
          } catch (error) {
            logError(`Failed to stat ${p}`, error);
            return false;
          }
        });

        const isVersionDir = (d: string) => /^[a-f0-9]+$/.test(d) || /^\d+\.\d+/.test(d) || d === "unknown";
        if (subDirs.length > 0 && subDirs.every(isVersionDir)) {
          subDirs.sort();
          contentDir = join(pluginDir, subDirs[subDirs.length - 1]);
        }

        const { skills, commands, agents, hooks, hasMcp } = scanPluginContents(contentDir);
        const metadata = readClaudePluginMetadata(contentDir);
        const pluginKey = `${pluginName}@${marketplace}`;
        const installedRecord = installedPluginRecords.get(pluginKey);
        const installedVersion = installedRecord?.version ?? metadata.version;

        plugins.push({
          name: pluginName,
          marketplace,
          version: metadata.version,
          installedVersion,
          latestVersion: metadata.version,
          description: metadata.description || "",
          source: contentDir,
          skills,
          commands,
          agents,
          hooks,
          hasMcp,
          hasLsp: false,
          homepage: metadata.homepage || "",
          installed: true,
          scope: "user",
        });
      }
    }
  } catch (error) {
    logError("Failed to scan Claude plugins directory", error);
  }

  return plugins;
}

export const claudeAdapter: ToolAdapter = {
  toolId: "claude-code",
  usesSource: false,

  supports(input: SupportInput): { supported: boolean; reason?: string } {
    const { plugin, canInstallSkills, canInstallCommands, canInstallAgents, hasHooks } = input;
    const supported =
      canInstallSkills ||
      canInstallCommands ||
      canInstallAgents ||
      plugin.hasMcp ||
      plugin.hasLsp ||
      hasHooks;
    return { supported };
  },

  isInstalled(plugin: Plugin, instance: ToolInstance, ctx: InstalledContext): boolean {
    // Skills reach Claude through the derived-view overlay symlinks into the
    // shared store (not the native plugin CLI / installed_plugins.json), so a
    // skills-only or standalone-installed plugin is "installed" when the
    // overlay skill is present or a per-tool manifest entry records a component.
    return pluginInstalledForManagedInstance(plugin, instance, ctx.getManifest());
  },

  listInstalled(instance: ToolInstance): Plugin[] {
    return getInstalledPluginsForClaudeInstance(instance);
  },

  // Blackbook is the sole plugin manager: it NEVER runs `claude plugin
  // install/uninstall/update`. Claude's lifecycle is the same component
  // file-copy/proxy as every other tool — skills materialize into the shared
  // ~/.agents store (with a ~/.claude derived-view overlay), commands/agents
  // into ~/.agents, MCP servers into Claude's mcp config. install/uninstall/
  // update are therefore identical to the component surface below.
  async install(plugin: Plugin, instance: ToolInstance, sourcePath: string | null): Promise<PerInstanceResult> {
    return claudeAdapter.installComponents(plugin, instance, sourcePath);
  },

  async uninstall(plugin: Plugin, instance: ToolInstance): Promise<PerInstanceResult> {
    const removed = await claudeAdapter.removeComponents(plugin, instance);
    return { count: removed, errors: [] };
  },

  async update(plugin: Plugin, instance: ToolInstance, sourcePath: string | null): Promise<PerInstanceResult> {
    return claudeAdapter.installComponents(plugin, instance, sourcePath);
  },

  // Component surface: file-copy/proxy (NOT the native CLI). See file header.
  async installComponents(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
  ): Promise<PerInstanceResult> {
    if (!sourcePath) return { count: 0, errors: [] };
    const { count, errors } = installPluginItemsToInstance(
      plugin.name,
      sourcePath,
      instance,
      plugin.marketplace,
    );
    const mcp = await installMcpServersToInstance(plugin.name, sourcePath, instance);
    return { count: count + mcp.count, errors: [...errors, ...mcp.errors] };
  },

  async removeComponents(plugin: Plugin, instance: ToolInstance): Promise<number> {
    const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
    const mcpRemoved = await uninstallMcpServersFromInstance(plugin.name, instance);
    return removed + mcpRemoved;
  },
};
