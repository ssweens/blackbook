import {
  existsSync,
  mkdirSync,
  readFileSync,
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
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);
import { join, dirname, resolve, basename } from "path";
import { tmpdir, homedir } from "os";
import {
  expandPath,
  getCacheDir,
  getEnabledToolInstances,
  getToolInstances,
  getConfigRepoPath,
  resolveAssetSourcePath,
  getPluginComponentConfig,
  setPluginComponentEnabled,
} from "./config.js";
import { getGitHubToken, isGitHubHost } from "./github.js";
import type {
  Plugin,
  InstalledItem,
  ToolInstance,
  DiffInstanceRef,
} from "./types.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";
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

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function hashFile(path: string): string {
  const data = readFileSync(path);
  return hashBuffer(data);
}

function hashPath(path: string): { hash: string; isDirectory: boolean } {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const resolved = realpathSync(path);
    return hashPath(resolved);
  }
  if (stat.isDirectory()) {
    return { hash: hashDirectory(path), isDirectory: true };
  }
  return { hash: hashFile(path), isDirectory: false };
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashDirectory(path: string): string {
  const entries: string[] = [];
  const walk = (dir: string, prefix: string) => {
    const children = readdirSync(dir);
    children.sort();
    for (const child of children) {
      const fullPath = join(dir, child);
      const relPath = prefix ? `${prefix}/${child}` : child;
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(fullPath);
        const resolvedStat = lstatSync(resolved);
        if (resolvedStat.isDirectory()) {
          walk(resolved, relPath);
        } else if (resolvedStat.isFile()) {
          entries.push(relPath);
        }
      } else if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        entries.push(relPath);
      }
    }
  };

  walk(path, "");
  entries.sort();

  const hasher = createHash("sha256");
  for (const entry of entries) {
    const filePath = join(path, entry);
    const fileHash = hashFile(filePath);
    hasher.update(entry);
    hasher.update("\0");
    hasher.update(fileHash);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

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
): Promise<string | null> {
  validateMarketplaceName(plugin.marketplace);
  validatePluginName(plugin.name);
  const pluginsDir = getPluginsCacheDir();
  const pluginDir = safePath(pluginsDir, plugin.marketplace, plugin.name);

  if (existsSync(pluginDir)) {
    return pluginDir;
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
    if (marketplaceBase.startsWith("~")) {
      marketplaceBase = join(homedir(), marketplaceBase.slice(1));
    }
    if (!marketplaceBase.startsWith("/")) {
      marketplaceBase = resolve(process.cwd(), marketplaceBase);
    }
    // If marketplace points to a file, use its directory
    if (existsSync(marketplaceBase) && lstatSync(marketplaceBase).isFile()) {
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

  // Uninstall from all enabled instances first
  for (const instance of enabledInstances) {
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

  // Download fresh copy and install to all enabled instances
  const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

  if (sourcePath) {
    for (const instance of enabledInstances) {
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
  if (!existsSync(claudePluginsDir)) return plugins;

  try {
    const marketplaceDirs = readdirSync(claudePluginsDir);

    for (const marketplace of marketplaceDirs) {
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

        if (subDirs.length > 0 && subDirs.every((d) => /^[a-f0-9]+$/.test(d))) {
          subDirs.sort();
          contentDir = join(pluginDir, subDirs[subDirs.length - 1]);
        }

        const skills: string[] = [];
        const commands: string[] = [];
        const agents: string[] = [];
        const hooks: string[] = [];
        let hasMcp = false;
        let description = "";

        const skillsDir = join(contentDir, "skills");
        try {
          if (lstatSync(skillsDir).isDirectory()) {
            for (const item of readdirSync(skillsDir)) {
              const itemPath = join(skillsDir, item);
              if (existsSync(join(itemPath, "SKILL.md"))) {
                skills.push(item);
              }
            }
          }
        } catch {
          // Ignore if skills directory doesn't exist
        }

        const commandsDir = join(contentDir, "commands");
        try {
          if (lstatSync(commandsDir).isDirectory()) {
            for (const item of readdirSync(commandsDir)) {
              if (item.endsWith(".md")) {
                commands.push(item.replace(/\.md$/, ""));
              }
            }
          }
        } catch {
          // Ignore if commands directory doesn't exist
        }

        const agentsDir = join(contentDir, "agents");
        try {
          if (lstatSync(agentsDir).isDirectory()) {
            for (const item of readdirSync(agentsDir)) {
              if (item.endsWith(".md")) {
                agents.push(item.replace(/\.md$/, ""));
              }
            }
          }
        } catch {
          // Ignore if agents directory doesn't exist
        }

        const hooksDir = join(contentDir, "hooks");
        try {
          if (lstatSync(hooksDir).isDirectory()) {
            for (const item of readdirSync(hooksDir)) {
              hooks.push(item.replace(/\.(md|json)$/, ""));
            }
          }
        } catch {
          // Ignore if hooks directory doesn't exist
        }

        if (
          existsSync(join(contentDir, "mcp.json")) ||
          existsSync(join(contentDir, ".claude-plugin", "mcp.json"))
        ) {
          hasMcp = true;
        }

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

    if (pluginInfo) {
      // Component came from a marketplace plugin
      key = `${pluginInfo.marketplace}:${pluginInfo.pluginName}`;
      marketplace = pluginInfo.marketplace;
      pluginName = pluginInfo.pluginName;
    } else {
      // Truly local component - treat it as its own plugin
      key = `local:${component.name}`;
      marketplace = "local";
      pluginName = component.name;
    }

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

export function getAllInstalledPlugins(): {
  plugins: Plugin[];
  byTool: Record<string, Plugin[]>;
} {
  const byTool: Record<string, Plugin[]> = {};
  const allPlugins: Plugin[] = [];
  const seen = new Set<string>();
  const instances = getToolInstances();

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

  // Get or download plugin source once for all instances
  let sourcePath = getPluginSourcePath(plugin);
  if (!sourcePath && marketplaceUrl) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl);
  }

  if (!sourcePath) {
    result.errors.push(`Failed to locate plugin source for ${plugin.name}`);
    return result;
  }

  // Sync (install) to all missing instances using the same method
  for (const instance of missingInstances) {
    try {
      const { count, errors } = installPluginItemsToInstance(
        plugin.name,
        sourcePath,
        instance,
        plugin.marketplace,
      );
      result.syncedInstances[instanceKey(instance)] = count;
      result.errors.push(...errors);
    } catch (error) {
      logError(`Sync failed for ${plugin.name} in ${instance.name}`, error);
      result.errors.push(
        `Sync failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
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
