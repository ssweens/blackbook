import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  lstatSync,
  realpathSync,
  readdirSync,
  copyFileSync,
  cpSync,
  rmSync,
} from "fs";
import { promisify } from "util";
import { execFile, execFileSync } from "child_process";
import { hashBuffer, hashFile, hashPath, hashString, hashDirectory } from "./modules/hash.js";

const execFileAsync = promisify(execFile);
import { join, dirname, resolve, basename } from "path";
import { tmpdir } from "os";
import {
  expandPath,
  getCacheDir,
  getEnabledToolInstances,
  getToolInstances,
  getConfigRepoPath,
  resolveAssetSourcePath,
  getPluginComponentConfig,
  setPluginComponentEnabled,
  parseMarketplaces,
} from "./config.js";
import { loadConfig as loadYamlConfig } from "./config/loader.js";
import { saveConfig as saveYamlConfig } from "./config/writer.js";
import { getGitHubToken, isGitHubHost } from "./github.js";
import type {
  Plugin,
  InstalledItem,
  ToolInstance,
  DiffInstanceRef,
  FileStatus,
} from "./types.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";
import { expandTilde, scanPluginContents } from "./path-utils.js";
import {
  safePath,
  validateGitRef,
  validateItemName,
  validateMarketplaceName,
  validatePluginName,
  validateRepoUrl,
  validateRelativeSubPath,
} from "./validation.js";
import fastGlob from "fast-glob";
import {
  getPluginsCacheDir,
  instanceKey,
  buildBackupPath,
  buildLooseBackupPath,
  getPluginSourcePath,
  createSymlink,
  isSymlink,
  removeSymlink,
  type SymlinkResult,
} from "./plugin-helpers.js";
import {
  manifestPath,
  loadManifest,
  saveManifest,
  type Manifest,
} from "./manifest.js";
import { logError, validatePluginMetadata } from "./validation.js";
import { getPluginToolStatus } from "./plugin-status.js";

/**
 * Extract marketplace and plugin name from a source path.
 * Handles multiple cache formats:
 * - Blackbook cache: ~/.cache/blackbook/plugins/{marketplace}/{plugin}/...
 * - Claude cache: ~/.claude/plugins/cache/{marketplace}/{plugin}/...
 * - Claude cache with hash: ~/.claude/plugins/cache/{marketplace}/{plugin}/{hash}/...
 * Returns null if the path doesn't match any expected pattern.
 */
function extractPluginInfoFromSource(
  sourcePath: string,
): { marketplace: string; pluginName: string } | null {
  // Try blackbook cache first: ~/.cache/blackbook/plugins/{marketplace}/{plugin}/...
  const blackbookCacheDir = getPluginsCacheDir();
  if (sourcePath.startsWith(blackbookCacheDir)) {
    const relativePath = sourcePath.slice(blackbookCacheDir.length + 1);
    const parts = relativePath.split("/");
    // Expected: {marketplace}/{plugin}/{componentType}/{componentName} (4+ parts)
    if (parts.length >= 4) {
      return { marketplace: parts[0], pluginName: parts[1] };
    }
  }

  // Try Claude cache: ~/.claude/plugins/cache/{marketplace}/{plugin}/...
  // or ~/.claude*/plugins/cache/{marketplace}/{plugin}/...
  const claudeCacheMatch = sourcePath.match(
    /\.claude[^/]*\/plugins\/cache\/([^/]+)\/([^/]+)/,
  );
  if (claudeCacheMatch) {
    return {
      marketplace: claudeCacheMatch[1],
      pluginName: claudeCacheMatch[2],
    };
  }

  return null;
}

// Hash functions imported from modules/hash.ts (single source of truth)

function isConfigOnlyInstance(instance: ToolInstance): boolean {
  return (
    !instance.skillsSubdir && !instance.commandsSubdir && !instance.agentsSubdir
  );
}

let cachedGitAvailable: boolean | null = null;

async function ensureGitAvailable(): Promise<void> {
  if (cachedGitAvailable === true) return;
  try {
    await execFileAsync("git", ["--version"]);
    cachedGitAvailable = true;
  } catch (error) {
    cachedGitAvailable = false;
    throw new Error(
      "Git is required to download plugins but was not found. Install from https://git-scm.com/",
    );
  }
}

async function execClaudeCommand(
  instance: ToolInstance,
  command: "install" | "uninstall" | "enable" | "disable" | "update",
  pluginName: string,
): Promise<void> {
  validatePluginName(pluginName);
  await execFileAsync("claude", ["plugin", command, pluginName], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: instance.configDir,
    },
  });
}

function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const tempDir = join(tmpdir(), `${prefix}-${Date.now()}-${process.pid}`);
  mkdirSync(tempDir, { recursive: true });
  return fn(tempDir).finally(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      logError(`Failed to clean temp dir ${tempDir}`, error);
    }
  });
}

function parseGithubRepoFromUrl(
  url: string,
): { repo: string; ref: string } | null {
  const rawMatch = url.match(
    /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/,
  );
  if (rawMatch) return { repo: rawMatch[1], ref: rawMatch[2] };

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (gitMatch) return { repo: gitMatch[1], ref: "main" };

  return null;
}

export async function downloadPlugin(
  plugin: Plugin,
  marketplaceUrl: string,
  options?: { force?: boolean },
): Promise<string | null> {
  validateMarketplaceName(plugin.marketplace);
  validatePluginName(plugin.name);
  const pluginsDir = getPluginsCacheDir();
  const pluginDir = safePath(pluginsDir, plugin.marketplace, plugin.name);

  if (existsSync(pluginDir)) {
    if (!options?.force) {
      return pluginDir;
    }
    rmSync(pluginDir, { recursive: true, force: true });
  }

  mkdirSync(pluginDir, { recursive: true });

  const source = plugin.source;

  // Handle local marketplace (path-based)
  const isLocalMarketplace =
    marketplaceUrl.startsWith("/") ||
    marketplaceUrl.startsWith("./") ||
    marketplaceUrl.startsWith("../") ||
    marketplaceUrl.startsWith("~");

  if (
    isLocalMarketplace &&
    typeof source === "string" &&
    source.startsWith("./")
  ) {
    // Resolve marketplace base directory
    let marketplaceBase = marketplaceUrl;
    marketplaceBase = expandTilde(marketplaceBase);
    if (!marketplaceBase.startsWith("/")) {
      marketplaceBase = resolve(process.cwd(), marketplaceBase);
    }
    // If marketplace points to a file, use its directory
    if (existsSync(marketplaceBase) && lstatSync(marketplaceBase).isFile()) {
      marketplaceBase = dirname(marketplaceBase);
    }

    // Source paths in marketplace.json are relative to repo root.
    // If marketplace base is .claude-plugin/, step up to repo root.
    if (basename(marketplaceBase) === ".claude-plugin") {
      marketplaceBase = dirname(marketplaceBase);
    }

    const sourceDir = resolve(marketplaceBase, source);

    if (!existsSync(sourceDir)) {
      logError(
        `Local plugin source not found: ${sourceDir}`,
        new Error(`source=${source}, marketplaceBase=${marketplaceBase}`),
      );
      rmSync(pluginDir, { recursive: true, force: true });
      return null;
    }

    try {
      cpSync(sourceDir, pluginDir, { recursive: true });
      return pluginDir;
    } catch (error) {
      logError(`Failed to copy local plugin ${plugin.name}`, error);
      rmSync(pluginDir, { recursive: true, force: true });
      return null;
    }
  }

  // Handle remote (GitHub) marketplace
  let repoUrl: string | null = null;
  let ref = "main";
  let subPath = "";

  if (typeof source === "object") {
    if (source.source === "github" && source.repo) {
      repoUrl = `https://github.com/${source.repo}.git`;
      ref = source.ref || "main";
    } else if (source.source === "url" && source.url) {
      const parsed = parseGithubRepoFromUrl(source.url);
      if (parsed) {
        repoUrl = `https://github.com/${parsed.repo}.git`;
        ref = parsed.ref;
      }
    }
  } else if (typeof source === "string" && source.startsWith("./")) {
    const parsed = parseGithubRepoFromUrl(marketplaceUrl);
    if (parsed) {
      repoUrl = `https://github.com/${parsed.repo}.git`;
      ref = parsed.ref;
      subPath = source.replace(/^\.\//, "");
    }
  }

  if (!repoUrl) {
    logError(
      `Cannot determine repo URL for plugin ${plugin.name}`,
      new Error(
        `source=${JSON.stringify(source)}, marketplaceUrl=${marketplaceUrl}`,
      ),
    );
    rmSync(pluginDir, { recursive: true, force: true });
    return null;
  }

  try {
    validateRepoUrl(repoUrl);
    validateGitRef(ref);
    validateRelativeSubPath(subPath);
    await ensureGitAvailable();

    return await withTempDir("blackbook-clone", async (tempDir) => {
      await execFileAsync("git", [
        "clone",
        "--depth",
        "1",
        "--branch",
        ref,
        repoUrl!,
        tempDir,
      ]);

      const sourceDir = subPath ? join(tempDir, subPath) : tempDir;

      if (!existsSync(sourceDir)) {
        logError(
          `Plugin source path not found: ${sourceDir}`,
          new Error("Missing plugin source"),
        );
        rmSync(pluginDir, { recursive: true, force: true });
        return null;
      }

      cpSync(sourceDir, pluginDir, { recursive: true });
      return pluginDir;
    });
  } catch (error) {
    logError(`Failed to download plugin ${plugin.name}`, error);
    rmSync(pluginDir, { recursive: true, force: true });
    return null;
  }
}

function pluginSourceHasExpectedComponents(plugin: Plugin, sourcePath: string): boolean {
  for (const skill of plugin.skills) {
    if (!existsSync(join(sourcePath, "skills", skill, "SKILL.md"))) return false;
  }
  for (const cmd of plugin.commands) {
    if (!existsSync(join(sourcePath, "commands", `${cmd}.md`))) return false;
  }
  for (const agent of plugin.agents) {
    if (!existsSync(join(sourcePath, "agents", `${agent}.md`))) return false;
  }
  return true;
}

export interface InstallResult {
  success: boolean;
  linkedInstances: Record<string, number>;
  errors: string[];
  skippedInstances: string[];
}

export async function installPlugin(
  plugin: Plugin,
  marketplaceUrl: string,
): Promise<InstallResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances
    .filter((instance) => !instance.enabled)
    .map(instanceKey);
  const result: InstallResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  const claudeInstances = enabledInstances.filter(
    (instance) => instance.toolId === "claude-code",
  );
  const nonClaudeInstances = enabledInstances.filter(
    (instance) => instance.toolId !== "claude-code",
  );

  // For Claude instances, use the native CLI
  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "install", plugin.name);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (e) {
      result.errors.push(
        `Claude install failed for ${instance.name}: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  }

  // For non-Claude instances, download and create symlinks
  if (nonClaudeInstances.length > 0) {
    const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

    if (!sourcePath) {
      if (claudeInstances.length === 0) {
        result.errors.push(`Failed to download plugin ${plugin.name}`);
        return result;
      }
    } else {
      for (const instance of nonClaudeInstances) {
        try {
          const { count, errors } = installPluginItemsToInstance(
            plugin.name,
            sourcePath,
            instance,
            plugin.marketplace,
          );
          result.linkedInstances[instanceKey(instance)] = count;
          result.errors.push(...errors);
        } catch (error) {
          logError(
            `Install failed for ${plugin.name} in ${instance.name}`,
            error,
          );
          result.errors.push(
            `Install failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }
    }
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export function uninstallPluginFromInstance(
  plugin: Plugin,
  toolId: string,
  instanceId: string,
): boolean {
  validatePluginMetadata(plugin);
  const instances = getToolInstances().filter((i) => i.kind === "tool");
  const instance = instances.find(
    (i) => i.toolId === toolId && i.instanceId === instanceId,
  );
  if (!instance) return false;
  const removed = uninstallPluginItemsFromInstance(plugin.name, instance) > 0;
  removeFromClaudeInstalledPluginsJson(instance, plugin.name, plugin.marketplace);
  return removed;
}

/**
 * Remove a plugin entry from Claude's `installed_plugins.json` for the given instance.
 * This file is the authoritative "what plugins are installed" record for Claude Code;
 * our scanner reads it, so we MUST keep it in sync on uninstall.
 */
function removeFromClaudeInstalledPluginsJson(
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
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
    }
  } catch (error) {
    logError(`Failed to update ${path}`, error);
  }
}

export async function uninstallPlugin(plugin: Plugin): Promise<boolean> {
  validatePluginMetadata(plugin);
  const enabledInstances = getEnabledToolInstances();
  let removedCount = 0;

  if (enabledInstances.length === 0) {
    return false;
  }

  // Uninstall from all enabled instances using the same method
  for (const instance of enabledInstances) {
    removedCount += uninstallPluginItemsFromInstance(plugin.name, instance);
    // Claude tracks installed plugins in installed_plugins.json — must clean it.
    removeFromClaudeInstalledPluginsJson(instance, plugin.name, plugin.marketplace);
  }

  try {
    const pluginDir = safePath(
      getPluginsCacheDir(),
      plugin.marketplace,
      plugin.name,
    );
    rmSync(pluginDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to remove plugin dir for ${plugin.name}`, error);
  }

  return removedCount > 0;
}

export interface EnableResult {
  success: boolean;
  linkedInstances: Record<string, number>;
  errors: string[];
  skippedInstances: string[];
}

export interface SyncResult {
  success: boolean;
  syncedInstances: Record<string, number>;
  errors: string[];
}

export interface AssetSyncResult {
  success: boolean;
  syncedInstances: Record<string, number>;
  errors: string[];
}

function copyWithBackup(
  src: string,
  dest: string,
  pluginName: string,
  itemKind: string,
  itemName: string,
): { dest: string; backup: string | null } {
  let backupPath: string | null = null;

  if (existsSync(dest) || isSymlink(dest)) {
    backupPath = buildBackupPath(pluginName, itemKind, itemName);
    const tempBackup = `${backupPath}.new.${Date.now()}`;
    renameSync(dest, tempBackup);
    if (existsSync(backupPath) || isSymlink(backupPath)) {
      rmSync(backupPath, { recursive: true, force: true });
    }
    renameSync(tempBackup, backupPath);
  }

  mkdirSync(dirname(dest), { recursive: true });

  const srcStat = lstatSync(src);
  if (srcStat.isDirectory()) {
    cpSync(src, dest, { recursive: true });
  } else {
    copyFileSync(src, dest);
  }

  return { dest, backup: backupPath };
}

function installPluginItemsToInstance(
  pluginName: string,
  sourcePath: string,
  instance: ToolInstance,
  marketplace?: string,
): { count: number; items: InstalledItem[]; errors: string[] } {
  if (!instance.enabled) return { count: 0, items: [], errors: [] };

  validatePluginName(pluginName);
  const errors: string[] = [];
  const items: InstalledItem[] = [];
  const componentConfig = marketplace
    ? getPluginComponentConfig(marketplace, pluginName)
    : null;
  const appliedKeys: string[] = [];

  const manifest = loadManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }
  const toolManifest = manifest.tools[key];

  const rollback = () => {
    for (const appliedKey of appliedKeys.reverse()) {
      const item = toolManifest.items[appliedKey];
      if (!item) continue;
      try {
        if (existsSync(item.dest) || isSymlink(item.dest)) {
          const stat = lstatSync(item.dest);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            rmSync(item.dest, { recursive: true });
          } else {
            unlinkSync(item.dest);
          }
        }
        if (
          item.backup &&
          (existsSync(item.backup) || isSymlink(item.backup))
        ) {
          renameSync(item.backup, item.dest);
        }
      } catch (error) {
        logError(`Failed to rollback ${item.dest}`, error);
      }
      if (item.previous) {
        toolManifest.items[appliedKey] = item.previous;
      } else {
        delete toolManifest.items[appliedKey];
      }
    }
  };

  const installItem = (
    kind: "skill" | "command" | "agent",
    name: string,
    src: string,
    dest: string,
  ) => {
    validateItemName(kind, name);
    const key = `${kind}:${name}`;
    const previous = toolManifest.items[key] || null;
    const result = copyWithBackup(src, dest, pluginName, kind, name);
    const item: InstalledItem = {
      kind,
      name,
      source: src,
      dest: result.dest,
      backup: result.backup,
      owner: pluginName,
      previous,
    };
    toolManifest.items[key] = item;
    items.push(item);
    appliedKeys.push(key);
  };

  try {
    if (instance.skillsSubdir) {
      const skillsDir = join(sourcePath, "skills");
      if (existsSync(skillsDir)) {
        for (const entry of readdirSync(skillsDir)) {
          const src = safePath(skillsDir, entry);
          if (existsSync(join(src, "SKILL.md"))) {
            if (componentConfig?.disabledSkills.includes(entry)) continue;
            const baseDest = join(instance.configDir, instance.skillsSubdir);
            const dest = safePath(baseDest, entry);
            installItem("skill", entry, src, dest);
          }
        }
      }
    }

    if (instance.commandsSubdir) {
      const commandsDir = join(sourcePath, "commands");
      if (existsSync(commandsDir)) {
        for (const entry of readdirSync(commandsDir)) {
          if (entry.endsWith(".md")) {
            const name = entry.replace(/\.md$/, "");
            if (componentConfig?.disabledCommands.includes(name)) continue;
            const src = safePath(commandsDir, entry);
            const baseDest = join(instance.configDir, instance.commandsSubdir);
            const dest = safePath(baseDest, entry);
            installItem("command", name, src, dest);
          }
        }
      }
    }

    if (instance.agentsSubdir) {
      const agentsDir = join(sourcePath, "agents");
      if (existsSync(agentsDir)) {
        for (const entry of readdirSync(agentsDir)) {
          if (entry.endsWith(".md")) {
            const name = entry.replace(/\.md$/, "");
            if (componentConfig?.disabledAgents.includes(name)) continue;
            const src = safePath(agentsDir, entry);
            const baseDest = join(instance.configDir, instance.agentsSubdir);
            const dest = safePath(baseDest, entry);
            installItem("agent", name, src, dest);
          }
        }
      }
    }
  } catch (error) {
    const message = `Install failed for ${pluginName} in ${instance.name}`;
    logError(message, error);
    errors.push(
      `${message}: ${error instanceof Error ? error.message : String(error)}`,
    );
    rollback();
    return { count: 0, items: [], errors };
  }

  if (items.length > 0) {
    saveManifest(manifest);
  }

  return { count: items.length, items, errors };
}

function uninstallPluginItemsFromInstance(
  pluginName: string,
  instance: ToolInstance,
): number {
  validatePluginName(pluginName);
  let manifest: Manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    logError("Failed to load manifest during uninstall", error);
    return 0;
  }
  const key = instanceKey(instance);
  const toolManifest = manifest.tools[key];
  if (!toolManifest) return 0;

  let removed = 0;
  const keysToRemove: string[] = [];
  const processedDests = new Set<string>();

  for (const [entryKey, item] of Object.entries(toolManifest.items)) {
    const owner = item.owner || "";
    if (owner === pluginName || (!owner && item.source.includes(pluginName))) {
      const dest = item.dest;
      const backup = item.backup;

      // Only do file operations once per dest (handles duplicate entries)
      if (!processedDests.has(dest)) {
        processedDests.add(dest);
        try {
          if (existsSync(dest) || isSymlink(dest)) {
            const stat = lstatSync(dest);
            if (stat.isDirectory() && !stat.isSymbolicLink()) {
              rmSync(dest, { recursive: true });
            } else {
              unlinkSync(dest);
            }
            removed++;
          }

          if (backup && (existsSync(backup) || isSymlink(backup))) {
            renameSync(backup, dest);
          }
        } catch (error) {
          logError(`Failed to uninstall ${item.kind}:${item.name}`, error);
        }
      }

      // Always update manifest for matching entries (even duplicates)
      if (item.previous) {
        toolManifest.items[entryKey] = item.previous;
      } else {
        keysToRemove.push(entryKey);
      }
    }
  }

  for (const entryKey of keysToRemove) {
    delete toolManifest.items[entryKey];
  }
  saveManifest(manifest);

  return removed;
}

export async function enablePlugin(
  plugin: Plugin,
  marketplaceUrl?: string,
): Promise<EnableResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances
    .filter((instance) => !instance.enabled)
    .map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  // Get or download plugin source
  let sourcePath = getPluginSourcePath(plugin);

  if (sourcePath && marketplaceUrl && !pluginSourceHasExpectedComponents(plugin, sourcePath)) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl, { force: true });
  }

  if (!sourcePath && marketplaceUrl) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl);
  }

  if (!sourcePath) {
    result.errors.push(`Plugin source not found for ${plugin.name}`);
    return result;
  }

  // Enable (install) to all enabled instances using the same method
  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    try {
      const { count, errors } = installPluginItemsToInstance(
        plugin.name,
        sourcePath,
        instance,
        plugin.marketplace,
      );
      result.linkedInstances[instanceKey(instance)] = count;
      result.errors.push(...errors);
    } catch (error) {
      logError(`Enable failed for ${plugin.name} in ${instance.name}`, error);
      result.errors.push(
        `Enable failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function disablePlugin(plugin: Plugin): Promise<EnableResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances
    .filter((instance) => !instance.enabled)
    .map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  // Disable (uninstall) from all enabled instances using the same method
  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
    result.linkedInstances[instanceKey(instance)] = removed;
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function updatePlugin(
  plugin: Plugin,
  marketplaceUrl: string,
): Promise<EnableResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances().filter((instance) => instance.kind === "tool");
  const installedStatusKeys = new Set(
    getPluginToolStatus(plugin)
      .filter((status) => status.enabled && status.installed)
      .map((status) => `${status.toolId}:${status.instanceId}`),
  );
  const targetInstances = instances.filter((instance) =>
    installedStatusKeys.has(instanceKey(instance)),
  );
  const skippedInstances = instances
    .filter((instance) => !instance.enabled)
    .map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (targetInstances.length === 0) {
    result.errors.push(`Plugin ${plugin.name} is not installed in any enabled tool instance.`);
    return result;
  }

  // Uninstall from currently-installed instances first
  for (const instance of targetInstances) {
    uninstallPluginItemsFromInstance(plugin.name, instance);
  }

  // Clear cached plugin
  try {
    const pluginDir = safePath(
      getPluginsCacheDir(),
      plugin.marketplace,
      plugin.name,
    );
    rmSync(pluginDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to remove plugin dir for ${plugin.name}`, error);
  }

  // Download fresh copy and install only to instances where plugin is already installed
  const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

  if (sourcePath) {
    for (const instance of targetInstances) {
      try {
        const { count, errors } = installPluginItemsToInstance(
          plugin.name,
          sourcePath,
          instance,
          plugin.marketplace,
        );
        result.linkedInstances[instanceKey(instance)] = count;
        result.errors.push(...errors);
      } catch (error) {
        logError(`Update failed for ${plugin.name} in ${instance.name}`, error);
        result.errors.push(
          `Update failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
  } else {
    result.errors.push(`Failed to download plugin update for ${plugin.name}`);
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export function linkPluginToInstance(
  plugin: Plugin,
  instance: ToolInstance,
  sourcePath: string,
): number {
  if (!instance.enabled) return 0;
  validatePluginName(plugin.name);
  const componentConfig = getPluginComponentConfig(
    plugin.marketplace,
    plugin.name,
  );

  let linked = 0;
  const manifest = loadManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }

  // Debug logging
  console.error(
    `[DEBUG] linkPluginToInstance: ${plugin.name} -> ${instance.name}`,
  );
  console.error(`[DEBUG] sourcePath: ${sourcePath}`);
  console.error(
    `[DEBUG] skillsSubdir: ${instance.skillsSubdir}, commandsSubdir: ${instance.commandsSubdir}, agentsSubdir: ${instance.agentsSubdir}`,
  );
  console.error(`[DEBUG] plugin.skills: ${JSON.stringify(plugin.skills)}`);
  console.error(`[DEBUG] plugin.commands: ${JSON.stringify(plugin.commands)}`);
  console.error(`[DEBUG] plugin.agents: ${JSON.stringify(plugin.agents)}`);

  for (const skill of plugin.skills) {
    if (componentConfig.disabledSkills.includes(skill)) continue;
    validateItemName("skill", skill);
    const source = safePath(join(sourcePath, "skills"), skill);
    console.error(
      `[DEBUG] Checking skill source: ${source}, exists: ${existsSync(source)}`,
    );
    if (!existsSync(source)) continue;

    if (instance.skillsSubdir) {
      const baseTarget = join(instance.configDir, instance.skillsSubdir);
      const target = safePath(baseTarget, skill);
      const result = createSymlink(source, target, plugin.name, "skill", skill);
      if (result.success) {
        manifest.tools[key].items[`skill:${skill}`] = {
          kind: "skill",
          name: skill,
          source,
          dest: join(instance.skillsSubdir, skill),
          backup: null,
          owner: plugin.name,
          previous: null,
        };
        linked++;
      } else {
        logError(`Failed to link skill ${skill}`, result.message);
      }
    }
  }

  for (const cmd of plugin.commands) {
    if (componentConfig.disabledCommands.includes(cmd)) continue;
    validateItemName("command", cmd);
    const source = safePath(join(sourcePath, "commands"), `${cmd}.md`);
    if (!existsSync(source)) continue;

    if (instance.commandsSubdir) {
      const baseTarget = join(instance.configDir, instance.commandsSubdir);
      const target = safePath(baseTarget, `${cmd}.md`);
      const result = createSymlink(source, target, plugin.name, "command", cmd);
      if (result.success) {
        manifest.tools[key].items[`command:${cmd}`] = {
          kind: "command",
          name: cmd,
          source,
          dest: join(instance.commandsSubdir, `${cmd}.md`),
          backup: null,
          owner: plugin.name,
          previous: null,
        };
        linked++;
      } else {
        logError(`Failed to link command ${cmd}`, result.message);
      }
    }
  }

  for (const agent of plugin.agents) {
    if (componentConfig.disabledAgents.includes(agent)) continue;
    validateItemName("agent", agent);
    const source = safePath(join(sourcePath, "agents"), `${agent}.md`);
    if (!existsSync(source)) continue;

    if (instance.agentsSubdir) {
      const baseTarget = join(instance.configDir, instance.agentsSubdir);
      const target = safePath(baseTarget, `${agent}.md`);
      const result = createSymlink(source, target, plugin.name, "agent", agent);
      if (result.success) {
        manifest.tools[key].items[`agent:${agent}`] = {
          kind: "agent",
          name: agent,
          source,
          dest: join(instance.agentsSubdir, `${agent}.md`),
          backup: null,
          owner: plugin.name,
          previous: null,
        };
        linked++;
      } else {
        logError(`Failed to link agent ${agent}`, result.message);
      }
    }
  }

  saveManifest(manifest);
  console.error(
    `[DEBUG] linkPluginToInstance completed: ${linked} items linked for ${instance.name}`,
  );
  return linked;
}

/**
 * Toggle a single plugin component (skill/command/agent) on or off.
 * When disabling: removes symlinks/copies from all tool instances and updates config.
 * When enabling: creates symlinks/copies to all tool instances and updates config.
 */
export function togglePluginComponent(
  plugin: Plugin,
  kind: "skill" | "command" | "agent",
  componentName: string,
  enabled: boolean,
): { success: boolean; error?: string } {
  // Update config first
  setPluginComponentEnabled(
    plugin.marketplace,
    plugin.name,
    kind,
    componentName,
    enabled,
  );

  const instances = getEnabledToolInstances();
  const manifest = loadManifest();
  const sourcePath = getPluginSourcePath(plugin);

  for (const instance of instances) {
    if (isConfigOnlyInstance(instance)) continue;
    const key = instanceKey(instance);
    const itemKey = `${kind}:${componentName}`;

    if (!enabled) {
      // Remove the component from this instance
      if (!manifest.tools[key]) continue;
      const item = manifest.tools[key].items[itemKey];
      if (!item) continue;

      // Resolve the actual destination path
      const subdir =
        kind === "skill"
          ? instance.skillsSubdir
          : kind === "command"
            ? instance.commandsSubdir
            : instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const destPath = join(instance.configDir, subdir, suffix);

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
        logError(
          `Failed to remove ${kind} ${componentName} from ${instance.name}`,
          error,
        );
      }

      // Restore backup if exists
      if (item.backup && existsSync(item.backup)) {
        try {
          renameSync(item.backup, destPath);
        } catch (error) {
          logError(`Failed to restore backup for ${componentName}`, error);
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

      const subdir =
        kind === "skill"
          ? instance.skillsSubdir
          : kind === "command"
            ? instance.commandsSubdir
            : instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const src = join(sourcePath, `${kind}s`, suffix);
      if (!existsSync(src)) continue;

      const dest = join(instance.configDir, subdir, suffix);

      if (!manifest.tools[key]) {
        manifest.tools[key] = { items: {} };
      }

      const result = createSymlink(src, dest, plugin.name, kind, componentName);
      if (result.success) {
        manifest.tools[key].items[itemKey] = {
          kind,
          name: componentName,
          source: src,
          dest: join(subdir, suffix),
          backup: null,
          owner: plugin.name,
          previous: null,
        };
      }
    }
  }

  saveManifest(manifest);
  return { success: true };
}

function getInstalledPluginsForClaudeInstance(
  instance: ToolInstance,
): Plugin[] {
  const plugins: Plugin[] = [];

  // Read installed_plugins.json for the authoritative list of installed plugins
  const installedPluginsPath = join(
    instance.configDir,
    "plugins/installed_plugins.json",
  );
  const installedPluginKeys = new Set<string>();

  try {
    if (lstatSync(installedPluginsPath).isFile()) {
      const content = readFileSync(installedPluginsPath, "utf-8");
      const data = JSON.parse(content);
      if (data.plugins && typeof data.plugins === "object") {
        // Keys are in format "pluginName@marketplace"
        for (const key of Object.keys(data.plugins)) {
          installedPluginKeys.add(key);
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
      if (!configuredMarketplaceNames.has(marketplace)) continue;
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
        let description = "";

        const manifestPath = join(
          contentDir,
          ".claude-plugin",
          "manifest.json",
        );
        try {
          if (lstatSync(manifestPath).isFile()) {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            description = manifest.description || "";
          }
        } catch {
          // Ignore if manifest doesn't exist or can't be read
        }

        plugins.push({
          name: pluginName,
          marketplace,
          description,
          source: contentDir,
          skills,
          commands,
          agents,
          hooks,
          hasMcp,
          hasLsp: false,
          homepage: "",
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

export function getInstalledPluginsForInstance(
  instance: ToolInstance,
): Plugin[] {
  if (!instance.enabled) return [];
  if (instance.toolId === "claude-code") {
    return getInstalledPluginsForClaudeInstance(instance);
  }

  // Load manifest to get authoritative source paths
  // Manifest may have items under both "toolId" and "toolId:instanceId" keys
  const manifest = loadManifest();
  const toolKeys = [
    instance.toolId,
    `${instance.toolId}:${instance.instanceId}`,
  ];
  const toolManifest: Record<string, InstalledItem> = {};
  for (const key of toolKeys) {
    const items = manifest.tools[key]?.items || {};
    Object.assign(toolManifest, items);
  }

  // Build map of dest path -> source path from manifest
  const destToSource = new Map<string, string>();
  for (const item of Object.values(toolManifest)) {
    if (item.dest && item.source) {
      destToSource.set(item.dest, item.source);
    }
  }

  // Collect all components and group by actual plugin name (from source path)
  interface ComponentInfo {
    type: "skill" | "command" | "agent";
    name: string;
    source: string;
  }

  const components: ComponentInfo[] = [];

  // Helper to get source: prefer manifest, fall back to symlink resolution, then itemPath
  function getSource(itemPath: string): string {
    // First try manifest
    const manifestSource = destToSource.get(itemPath);
    if (manifestSource) return manifestSource;

    // Then try symlink resolution
    try {
      const stat = lstatSync(itemPath);
      if (stat.isSymbolicLink()) {
        return realpathSync(itemPath);
      }
    } catch {
      // Ignore errors
    }

    // Fall back to item path itself
    return itemPath;
  }

  // Scan skills
  if (instance.skillsSubdir) {
    const skillsDir = join(instance.configDir, instance.skillsSubdir);
    try {
      if (lstatSync(skillsDir).isDirectory()) {
        for (const item of readdirSync(skillsDir)) {
          const itemPath = join(skillsDir, item);
          try {
            const stat = lstatSync(itemPath);
            if (stat.isDirectory() || stat.isSymbolicLink()) {
              if (existsSync(join(itemPath, "SKILL.md"))) {
                const source = getSource(itemPath);
                components.push({ type: "skill", name: item, source });
              }
            }
          } catch (error) {
            logError(`Failed to stat skill entry ${itemPath}`, error);
          }
        }
      }
    } catch {
      // Ignore if skills directory doesn't exist
    }
  }

  // Scan commands
  if (instance.commandsSubdir) {
    const commandsDir = join(instance.configDir, instance.commandsSubdir);
    try {
      if (lstatSync(commandsDir).isDirectory()) {
        for (const item of readdirSync(commandsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            const itemPath = join(commandsDir, item);
            const source = getSource(itemPath);
            components.push({ type: "command", name, source });
          }
        }
      }
    } catch {
      // Ignore if commands directory doesn't exist
    }
  }

  // Scan agents
  if (instance.agentsSubdir) {
    const agentsDir = join(instance.configDir, instance.agentsSubdir);
    try {
      if (lstatSync(agentsDir).isDirectory()) {
        for (const item of readdirSync(agentsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            const itemPath = join(agentsDir, item);
            const source = getSource(itemPath);
            components.push({ type: "agent", name, source });
          }
        }
      }
    } catch {
      // Ignore if agents directory doesn't exist
    }
  }

  // Group components by plugin (using source path to determine actual plugin)
  // Key format: "marketplace:pluginName" or "local:componentName" for truly local items
  const pluginGroups = new Map<
    string,
    {
      marketplace: string;
      pluginName: string;
      source: string;
      skills: string[];
      commands: string[];
      agents: string[];
    }
  >();

  for (const component of components) {
    const pluginInfo = extractPluginInfoFromSource(component.source);

    let key: string;
    let marketplace: string;
    let pluginName: string;

    if (!pluginInfo) continue; // no known plugin source — skip rather than fake a local entry
    key = `${pluginInfo.marketplace}:${pluginInfo.pluginName}`;
    marketplace = pluginInfo.marketplace;
    pluginName = pluginInfo.pluginName;

    let group = pluginGroups.get(key);
    if (!group) {
      group = {
        marketplace,
        pluginName,
        source: component.source,
        skills: [],
        commands: [],
        agents: [],
      };
      pluginGroups.set(key, group);
    }

    // Add component to appropriate list
    switch (component.type) {
      case "skill":
        if (!group.skills.includes(component.name)) {
          group.skills.push(component.name);
        }
        break;
      case "command":
        if (!group.commands.includes(component.name)) {
          group.commands.push(component.name);
        }
        break;
      case "agent":
        if (!group.agents.includes(component.name)) {
          group.agents.push(component.name);
        }
        break;
    }
  }

  // Convert groups to Plugin objects
  const plugins: Plugin[] = [];
  for (const group of pluginGroups.values()) {
    plugins.push({
      name: group.pluginName,
      marketplace: group.marketplace,
      description: "",
      source: group.source,
      skills: group.skills,
      commands: group.commands,
      agents: group.agents,
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    });
  }

  return plugins;
}

export interface SkillInstallation {
  toolId: string;
  instanceId: string;
  instanceName: string;
  diskPath: string;
  /** True if this specific install's SKILL.md differs from the source-repo copy. */
  drifted?: boolean;
}

/**
 * Git tracking status for a path in the source repo.
 * - clean: path is tracked and matches HEAD
 * - modified: tracked files inside have uncommitted changes (or staged)
 * - untracked: dir/file exists but is not in git's index at all (or has untracked content)
 * - unknown: source repo not a git repo, or check failed
 */
export type GitStatus = "clean" | "modified" | "untracked" | "unknown";

/**
 * Source-repo layout for a standalone skill.
 * - canonical: `<repo>/skills/<name>/SKILL.md` (the desired location)
 * - legacy-plugin: `<repo>/plugins/<name>/skills/<name>/SKILL.md` (wrapped in plugin folder, no marketplace)
 * - missing: not present in source repo
 */
export type SkillSourceLayout = "canonical" | "legacy-plugin" | "missing";

export interface StandaloneSkill {
  name: string;
  /** All tool instances where this skill is installed. */
  installations: SkillInstallation[];
  /** First/primary install path — used as the source for diff/preview. */
  diskPath: string;
  /** Convenience: toolId of the first installation. */
  toolId: string;
  /** Convenience: instanceName of the first installation. */
  instanceName: string;
  instanceId: string;
  /** Source-repo path if a matching SKILL.md exists in the configured source repo. */
  sourcePath?: string;
  /** Layout style of the source-repo location. */
  sourceLayout?: SkillSourceLayout;
  /** True if the disk copy differs (structurally) from the source-repo copy. */
  drifted?: boolean;
  /** Git tracking state of the source-repo path ("clean" / "modified" / "untracked" / "unknown"). */
  gitStatus?: GitStatus;
}



/**
 * Get git status for every path under a repo. Returns a Map keyed by path
 * relative to the repo root. Values are git's two-character status codes.
 * Returns `null` if the directory isn't a git repo.
 */
export function getRepoGitStatus(repoRoot: string): Map<string, string> | null {
  if (!existsSync(join(repoRoot, ".git"))) return null;
  try {
    const output = execFileSync(
      "git",
      ["-C", repoRoot, "status", "--porcelain", "--ignore-submodules"],
      { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
    );
    const result = new Map<string, string>();
    for (const line of output.split("\n")) {
      if (line.length < 4) continue;
      const code = line.slice(0, 2);
      // Porcelain format: "XY path" where X is index status, Y is worktree.
      // Path begins at column 3 (after "XY ").
      let path = line.slice(3);
      // Handle renames "oldname -> newname" by taking the new name.
      const arrow = path.indexOf(" -> ");
      if (arrow !== -1) path = path.slice(arrow + 4);
      // Strip optional surrounding quotes (git quotes paths with special chars).
      if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
      result.set(path, code);
    }
    return result;
  } catch {
    return null;
  }
}

/** Compute the GitStatus for a given absolute path within a repo.
 *  Works for both files (exact match) and directories (any descendant). */
export function gitStatusForPath(
  repoRoot: string,
  absolutePath: string,
  statusMap: Map<string, string> | null,
): GitStatus {
  if (!statusMap) return "unknown";
  if (!absolutePath.startsWith(repoRoot)) return "unknown";
  // Normalize to repo-relative path (no leading slash, no trailing slash).
  let rel = absolutePath.slice(repoRoot.length);
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (rel.endsWith("/")) rel = rel.slice(0, -1);
  const relPrefix = rel + "/";

  let hasUntracked = false;
  let hasModified = false;
  for (const [path, code] of statusMap) {
    // Three match modes:
    // 1) Exact path (file): "assets/AGENTS.md" == "assets/AGENTS.md"
    // 2) Descendant of rel (rel is dir): "skills/foo/SKILL.md" startsWith "skills/foo/"
    // 3) Ancestor of rel (rel is under an untracked dir): git reports "skills/" untracked
    //    when the whole skills/ tree is new — our rel "skills/foo" sits under it.
    const isExact = path === rel;
    const isDescendant = path.startsWith(relPrefix);
    // Git uses trailing slash on dir entries in porcelain output for untracked dirs.
    const pathAsDirPrefix = path.endsWith("/") ? path : path + "/";
    const isAncestor = relPrefix.startsWith(pathAsDirPrefix);
    if (!isExact && !isDescendant && !isAncestor) continue;
    if (code.startsWith("??")) hasUntracked = true;
    else hasModified = true;
  }
  if (hasUntracked) return "untracked";
  if (hasModified) return "modified";
  return "clean";
}

/**
 * Return skills on disk that are NOT owned by any installed plugin.
 * These are standalone skills installed/synced directly (e.g. by blackbook).
 */
export function getStandaloneSkills(): StandaloneSkill[] {
  const { plugins: allPlugins } = getAllInstalledPlugins();
  const configuredMarketplaceNames = new Set(parseMarketplaces().map((m) => m.name));

  // Build a GLOBAL set of skill names owned by any plugin from a configured marketplace.
  // Skills from removed marketplaces (e.g. "playbook") are NOT in this set — they're standalone.
  const globalPluginOwnedSkills = new Set<string>();
  // The compound-engineering plugin (https://github.com/everyinc/compound-engineering-plugin)
  // uses a custom installer that ships MORE skills than its claude `plugin.json` declares,
  // prefixed with `ce-` for non-Claude tools. If that plugin is installed, treat all `ce-*`
  // skills as plugin-owned.
  let compoundEngineeringInstalled = false;
  for (const p of allPlugins) {
    if (!configuredMarketplaceNames.has(p.marketplace)) continue;
    if (p.name === "compound-engineering" && p.installed) compoundEngineeringInstalled = true;
    for (const s of p.skills ?? []) {
      globalPluginOwnedSkills.add(s);
      globalPluginOwnedSkills.add(`ce-${s}`);
    }
  }

  // Aggregate installations per skill name across all tool instances.
  const byName = new Map<string, StandaloneSkill>();
  const instances = getToolInstances().filter((i) => i.kind === "tool" && i.enabled);

  for (const instance of instances) {
    if (!instance.skillsSubdir) continue;
    const skillsDir = join(instance.configDir, instance.skillsSubdir);
    if (!existsSync(skillsDir)) continue;

    try {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        const skillPath = join(skillsDir, entry.name);
        if (!existsSync(join(skillPath, "SKILL.md"))) continue;
        if (globalPluginOwnedSkills.has(entry.name)) continue;
        if (compoundEngineeringInstalled && entry.name.startsWith("ce-")) continue;

        const installation: SkillInstallation = {
          toolId: instance.toolId,
          instanceId: instance.instanceId,
          instanceName: instance.name,
          diskPath: skillPath,
        };
        const existing = byName.get(entry.name);
        if (existing) {
          existing.installations.push(installation);
        } else {
          byName.set(entry.name, {
            name: entry.name,
            installations: [installation],
            diskPath: skillPath,
            toolId: instance.toolId,
            instanceId: instance.instanceId,
            instanceName: instance.name,
          });
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  // Attach source-repo paths (and drift state) where the skill exists in the source repo.
  const sourceRepo = getConfigRepoPath();
  const repoGitStatus = sourceRepo ? getRepoGitStatus(sourceRepo) : null;
  if (sourceRepo && existsSync(sourceRepo)) {
    // Index every SKILL.md under <repo>/skills/** so we can map a tool-disk skill
    // name to its source path even when the source repo groups skills in subdirs
    // (e.g. skills/gbrain/<name>/SKILL.md). Tool disks always have a flat layout,
    // but the source repo can use namespaced subdirs for organization.
    // Also use this index to surface skills that exist in the source repo but
    // aren't yet installed on any tool — those still show up in the Skills section
    // with an empty installations[] so the user can sync them from source.
    const sourceSkillIndex = new Map<string, string>(); // name -> absolute SKILL.md path
    const skillsRoot = join(sourceRepo, "skills");
    if (existsSync(skillsRoot)) {
      const walk = (dir: string) => {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".")) continue;
            const p = join(dir, e.name);
            if (e.isDirectory()) {
              const skillMd = join(p, "SKILL.md");
              if (existsSync(skillMd)) {
                // First match wins for any given basename.
                if (!sourceSkillIndex.has(e.name)) sourceSkillIndex.set(e.name, skillMd);
              } else {
                walk(p);
              }
            }
          }
        } catch { /* skip */ }
      };
      walk(skillsRoot);
    }

    // Add source-only skills (in source repo but not installed on any tool disk).
    // They appear in the Skills section with empty installations so the user can
    // "Sync to <tool>" them.
    for (const [name, skillMd] of sourceSkillIndex) {
      if (byName.has(name)) continue;
      // Skip plugin-owned and compound-engineering ce-* if applicable.
      if (globalPluginOwnedSkills.has(name)) continue;
      if (compoundEngineeringInstalled && name.startsWith("ce-")) continue;
      const sourceDir = dirname(skillMd);
      byName.set(name, {
        name,
        installations: [],
        diskPath: sourceDir,   // use source path as the canonical disk reference
        toolId: "",
        instanceId: "",
        instanceName: "",
      });
    }

    for (const skill of byName.values()) {
      skill.sourceLayout = "missing";
      // Candidates in priority order:
      //   0. Canonical flat: source_repo/skills/<name>/SKILL.md
      //   1. Nested in skills/: discovered via the recursive index (e.g. skills/gbrain/<name>/)
      //   2. Legacy plugin-wrapped: source_repo/plugins/<name>/skills/<name>/SKILL.md
      const flat = join(sourceRepo, "skills", skill.name, "SKILL.md");
      const indexed = sourceSkillIndex.get(skill.name);
      const legacy = join(sourceRepo, "plugins", skill.name, "skills", skill.name, "SKILL.md");
      const candidates: Array<{ path: string; layout: SkillSourceLayout }> = [];
      if (existsSync(flat)) candidates.push({ path: flat, layout: "canonical" });
      else if (indexed) candidates.push({ path: indexed, layout: "canonical" });
      if (existsSync(legacy)) candidates.push({ path: legacy, layout: "legacy-plugin" });
      for (const { path: candidate, layout } of candidates) {
        if (existsSync(candidate)) {
          const sourceDir = dirname(candidate);
          skill.sourcePath = sourceDir;
          skill.sourceLayout = layout;
          // Lightweight per-install drift: compare each disk SKILL.md to the source one.
          try {
            const sourceSkillMd = readFileSync(candidate, "utf-8");
            for (const inst of skill.installations) {
              const diskSkillMd = join(inst.diskPath, "SKILL.md");
              if (!existsSync(diskSkillMd)) { inst.drifted = true; continue; }
              inst.drifted = readFileSync(diskSkillMd, "utf-8") !== sourceSkillMd;
            }
            skill.drifted = skill.installations.some((i) => i.drifted);
          } catch { /* ignore */ }
          // Git status for the source path — is it committed?
          skill.gitStatus = gitStatusForPath(sourceRepo, sourceDir, repoGitStatus);
          break;
        }
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Standalone Skill Mutations
// ---------------------------------------------------------------------------

/** Remove a single installation of a skill from one tool instance. */
export function uninstallSkillFromInstance(
  skill: StandaloneSkill,
  toolId: string,
  instanceId: string,
): boolean {
  const inst = skill.installations.find(
    (i) => i.toolId === toolId && i.instanceId === instanceId,
  );
  if (!inst) return false;
  try {
    rmSync(inst.diskPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Remove every installation of the skill. Returns the number successfully removed. */
export function uninstallSkillAllInstances(skill: StandaloneSkill): number {
  let removed = 0;
  for (const inst of skill.installations) {
    try {
      rmSync(inst.diskPath, { recursive: true, force: true });
      removed += 1;
    } catch { /* skip */ }
  }
  return removed;
}

/**
 * Delete a file from EVERYWHERE: every tool's target path + the source-repo source file +
 * the config.yaml entry. The config.yaml and source-repo edits are left uncommitted so
 * the user can review and commit themselves.
 */
export function deleteFileEverywhere(file: FileStatus): {
  ok: boolean;
  targets: number;
  source: boolean;
  config: boolean;
  error?: string;
} {
  let targetsRemoved = 0;
  for (const inst of file.instances) {
    try {
      if (existsSync(inst.targetPath)) {
        rmSync(inst.targetPath, { force: true });
        targetsRemoved += 1;
      }
    } catch { /* skip */ }
  }

  // Source-repo file removal.
  let sourceRemoved = false;
  const sourcePath = file.instances[0]?.sourcePath;
  if (sourcePath && existsSync(sourcePath)) {
    try {
      rmSync(sourcePath, { force: true });
      sourceRemoved = true;
    } catch (e) {
      return { ok: false, targets: targetsRemoved, source: false, config: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Config.yaml entry removal.
  let configRemoved = false;
  try {
    const { config, configPath } = loadYamlConfig();
    const before = config.files.length;
    config.files = config.files.filter((f) => f.name !== file.name);
    if (config.files.length < before) {
      saveYamlConfig(config, configPath);
      configRemoved = true;
    }
  } catch (e) {
    return { ok: false, targets: targetsRemoved, source: sourceRemoved, config: false, error: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true, targets: targetsRemoved, source: sourceRemoved, config: configRemoved };
}

/**
 * Delete a plugin from EVERYWHERE on the local machine.
 * This is exactly what uninstallPlugin() does (uninstall from every tool + clear cache +
 * remove manifest entries) — surfaced as a separate user-facing action for clarity and
 * parity with the skill/file delete actions. The marketplace remote copy is untouched
 * (we cannot delete from the marketplace).
 */
export async function deletePluginEverywhere(plugin: Plugin): Promise<{
  ok: boolean;
  tools: number;
  cache: boolean;
  error?: string;
}> {
  let toolsRemoved = 0;
  const enabled = getEnabledToolInstances();
  for (const instance of enabled) {
    try {
      toolsRemoved += uninstallPluginItemsFromInstance(plugin.name, instance);
      removeFromClaudeInstalledPluginsJson(instance, plugin.name, plugin.marketplace);
    } catch { /* skip */ }
  }
  let cacheRemoved = false;
  try {
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true, force: true });
      cacheRemoved = true;
    }
  } catch (e) {
    return { ok: false, tools: toolsRemoved, cache: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, tools: toolsRemoved, cache: cacheRemoved };
}

/**
 * Delete a skill from EVERYWHERE: every tool disk install AND the source-repo copy.
 * The source-repo deletion is left uncommitted so the user can review and commit themselves.
 * Returns counts of what was removed.
 */
export function deleteSkillEverywhere(skill: StandaloneSkill): { ok: boolean; tools: number; source: boolean; error?: string } {
  let toolsRemoved = 0;
  for (const inst of skill.installations) {
    try {
      rmSync(inst.diskPath, { recursive: true, force: true });
      toolsRemoved += 1;
    } catch { /* skip */ }
  }
  let sourceRemoved = false;
  if (skill.sourcePath && existsSync(skill.sourcePath)) {
    try {
      rmSync(skill.sourcePath, { recursive: true, force: true });
      sourceRemoved = true;
    } catch (e) {
      return { ok: false, tools: toolsRemoved, source: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true, tools: toolsRemoved, source: sourceRemoved };
}

/** Pull the skill from a specific disk installation back to the source repo. */
export function pullbackSkillToSource(
  skill: StandaloneSkill,
  fromToolId: string,
  fromInstanceId: string,
): boolean {
  if (!skill.sourcePath) return false;
  const inst = skill.installations.find(
    (i) => i.toolId === fromToolId && i.instanceId === fromInstanceId,
  );
  if (!inst) return false;
  try {
    rmSync(skill.sourcePath, { recursive: true, force: true });
    cpSync(inst.diskPath, skill.sourcePath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Copy the skill from its current first installation into a target tool instance. */
export function installSkillToInstance(
  skill: StandaloneSkill,
  toolId: string,
  instanceId: string,
): boolean {
  // Prefer source-repo path (canonical) over an existing disk install. Falls back to
  // an existing install when the skill isn't tracked in the source repo.
  const sourcePath = skill.sourcePath ?? skill.installations[0]?.diskPath;
  if (!sourcePath) return false;
  const target = getToolInstances().find(
    (i) => i.toolId === toolId && i.instanceId === instanceId,
  );
  if (!target || !target.skillsSubdir) return false;
  const targetDir = join(target.configDir, target.skillsSubdir, skill.name);
  try {
    cpSync(sourcePath, targetDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function getAllInstalledPlugins(): {
  plugins: Plugin[];
  byTool: Record<string, Plugin[]>;
} {
  const byTool: Record<string, Plugin[]> = {};
  const allPlugins: Plugin[] = [];
  const seen = new Set<string>();
  const instances = getToolInstances().filter((i) => i.kind === "tool");

  for (const instance of instances) {
    const key = instanceKey(instance);
    if (!instance.enabled) {
      byTool[key] = [];
      continue;
    }

    const instancePlugins = getInstalledPluginsForInstance(instance);
    byTool[key] = instancePlugins;

    for (const p of instancePlugins) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        allPlugins.push(p);
      }
    }
  }

  return { plugins: allPlugins, byTool };
}

export interface ToolInstallStatus {
  toolId: string;
  instanceId: string;
  name: string;
  installed: boolean;
  supported: boolean;
  enabled: boolean;
}

function findInstance(toolId: string, instanceId: string): ToolInstance | null {
  const instances = getToolInstances();
  return (
    instances.find(
      (instance) =>
        instance.toolId === toolId && instance.instanceId === instanceId,
    ) || null
  );
}

function buildStandalonePluginRoot(plugin: Plugin, sourcePath: string): string | null {
  const stagedRoot = join(
    tmpdir(),
    `blackbook-standalone-${plugin.name}-${Date.now()}-${process.pid}`,
  );

  let stagedCount = 0;

  // Standalone skill source: /path/to/skill-dir/SKILL.md
  if (existsSync(join(sourcePath, "SKILL.md"))) {
    const skillName = basename(sourcePath);
    if (plugin.skills.includes(skillName)) {
      const dest = safePath(stagedRoot, "skills", skillName);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(sourcePath, dest, { recursive: true });
      stagedCount++;
    }
  }

  // Standalone command/agent source: /path/to/name.md
  const sourceIsMarkdownFile = sourcePath.endsWith(".md") && existsSync(sourcePath);
  if (sourceIsMarkdownFile) {
    const fileName = basename(sourcePath);
    const commandName = fileName.replace(/\.md$/, "");

    if (plugin.commands.includes(commandName)) {
      const dest = safePath(stagedRoot, "commands", fileName);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(sourcePath, dest);
      stagedCount++;
    }

    if (plugin.agents.includes(commandName)) {
      const dest = safePath(stagedRoot, "agents", fileName);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(sourcePath, dest);
      stagedCount++;
    }
  }

  if (stagedCount === 0) {
    if (existsSync(stagedRoot)) {
      rmSync(stagedRoot, { recursive: true, force: true });
    }
    return null;
  }

  return stagedRoot;
}

export async function syncPluginInstances(
  plugin: Plugin,
  marketplaceUrl: string | undefined,
  missingStatuses: ToolInstallStatus[],
): Promise<SyncResult> {
  validatePluginMetadata(plugin);
  const result: SyncResult = {
    success: false,
    syncedInstances: {},
    errors: [],
  };
  if (missingStatuses.length === 0) return result;

  const missingInstances = missingStatuses
    .map((status) => findInstance(status.toolId, status.instanceId))
    .filter((instance): instance is ToolInstance => Boolean(instance));

  // Get or download plugin source once for all instances.
  // Installed-only plugins discovered from tool directories may have source paths
  // that are standalone component paths (e.g. /.../skills/my-skill).
  let sourcePath = getPluginSourcePath(plugin);

  // If cached plugin source exists but doesn't match current marketplace metadata
  // (new/renamed components), force a fresh download before syncing.
  if (sourcePath && marketplaceUrl && !pluginSourceHasExpectedComponents(plugin, sourcePath)) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl, { force: true });
  }

  if (!sourcePath && typeof plugin.source === "string" && existsSync(plugin.source)) {
    sourcePath = plugin.source;
  }
  if (!sourcePath && marketplaceUrl) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl);
  }

  if (!sourcePath) {
    result.errors.push(`Failed to locate plugin source for ${plugin.name}`);
    return result;
  }

  let stagedStandaloneRoot: string | null = null;

  try {
    // Sync (install) to all missing instances using the same method
    for (const instance of missingInstances) {
      try {
        let { count, errors } = installPluginItemsToInstance(
          plugin.name,
          sourcePath,
          instance,
          plugin.marketplace,
        );

        // Fallback for standalone component source paths discovered from installed
        // directories (no package root with skills/commands/agents subdirs).
        if (count === 0 && errors.length === 0) {
          if (!stagedStandaloneRoot) {
            stagedStandaloneRoot = buildStandalonePluginRoot(plugin, sourcePath);
          }
          if (stagedStandaloneRoot) {
            const fallback = installPluginItemsToInstance(
              plugin.name,
              stagedStandaloneRoot,
              instance,
              plugin.marketplace,
            );
            count += fallback.count;
            errors = errors.concat(fallback.errors);
          }
        }

        result.syncedInstances[instanceKey(instance)] = count;
        result.errors.push(...errors);
      } catch (error) {
        logError(`Sync failed for ${plugin.name} in ${instance.name}`, error);
        result.errors.push(
          `Sync failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
  } finally {
    if (stagedStandaloneRoot && existsSync(stagedStandaloneRoot)) {
      rmSync(stagedStandaloneRoot, { recursive: true, force: true });
    }
  }

  result.success = Object.values(result.syncedInstances).some(
    (n: any) => n > 0,
  );
  return result;
}
// Re-exports for backward compatibility (store.ts and tests import from install.ts)
export { manifestPath, loadManifest, saveManifest } from "./manifest.js";
export { getPluginToolStatus } from "./plugin-status.js";
export {
  getPluginsCacheDir,
  createSymlink,
  isSymlink,
  removeSymlink,
} from "./plugin-helpers.js";
