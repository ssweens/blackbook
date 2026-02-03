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
import { expandPath, getCacheDir, getEnabledToolInstances, getToolInstances, getConfigRepoPath, resolveAssetSourcePath } from "./config.js";
import { getGitHubToken, isGitHubHost } from "./github.js";
import type { Asset, AssetConfig, Plugin, InstalledItem, ToolInstance, ConfigSyncConfig, ConfigFile, ConfigSourceFile, ConfigMapping } from "./types.js";
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

export function getPluginsCacheDir(): string {
  return join(getCacheDir(), "plugins");
}

/**
 * Extract marketplace and plugin name from a source path.
 * Handles multiple cache formats:
 * - Blackbook cache: ~/.cache/blackbook/plugins/{marketplace}/{plugin}/...
 * - Claude cache: ~/.claude/plugins/cache/{marketplace}/{plugin}/...
 * - Claude cache with hash: ~/.claude/plugins/cache/{marketplace}/{plugin}/{hash}/...
 * Returns null if the path doesn't match any expected pattern.
 */
function extractPluginInfoFromSource(sourcePath: string): { marketplace: string; pluginName: string } | null {
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
  const claudeCacheMatch = sourcePath.match(/\.claude[^/]*\/plugins\/cache\/([^/]+)\/([^/]+)/);
  if (claudeCacheMatch) {
    return { marketplace: claudeCacheMatch[1], pluginName: claudeCacheMatch[2] };
  }

  return null;
}

function instanceKey(instance: ToolInstance): string {
  return `${instance.toolId}:${instance.instanceId}`;
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

function getUrlCachePath(url: string): string {
  const cacheDir = join(getCacheDir(), "assets");
  mkdirSync(cacheDir, { recursive: true });
  let filename = "asset";
  try {
    const { pathname } = new URL(url);
    const base = pathname.split("/").filter(Boolean).pop();
    if (base) filename = base;
  } catch {
    // ignore
  }
  const prefix = hashString(url).slice(0, 12);
  return join(cacheDir, `${prefix}-${filename}`);
}

function fetchUrlToCache(url: string): { path: string; error?: string } {
  const cachePath = getUrlCachePath(url);
  try {
    const args = ["-fsSL"];
    const token = getGitHubToken();
    if (token && isGitHubHost(url)) {
      args.push("-H", `Authorization: token ${token}`);
    }
    if (existsSync(cachePath)) {
      args.push("-z", cachePath);
    }
    args.push("-o", cachePath, url);
    execFileSync("curl", args);
    return { path: cachePath };
  } catch (error) {
    return {
      path: cachePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

export interface AssetToolStatus {
  toolId: string;
  instanceId: string;
  name: string;
  configDir: string;
  enabled: boolean;
  installed: boolean;
  drifted: boolean;
  targetPath: string;
}

export interface AssetSourceInfo {
  sourcePath: string;
  exists: boolean;
  isDirectory: boolean;
  hash: string | null;
  error?: string;
}

function normalizeAssetTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Asset target cannot be empty.");
  }
  const cleaned = trimmed.replace(/\/+$/, "");
  validateRelativeSubPath(cleaned);
  return cleaned;
}

export function resolveAssetTarget(asset: AssetConfig, instance: ToolInstance): string {
  const overrideKey = `${instance.toolId}:${instance.instanceId}`;
  const override = asset.overrides?.[overrideKey];
  if (override) return normalizeAssetTarget(override);
  if (asset.defaultTarget) return normalizeAssetTarget(asset.defaultTarget);
  return instance.toolId === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

export function getAssetSourceInfo(asset: AssetConfig): AssetSourceInfo {
  // Handle simple single-source syntax
  if (!asset.source) {
    return {
      sourcePath: "",
      exists: false,
      isDirectory: false,
      hash: null,
      error: "Asset has no source configured.",
    };
  }
  const sourcePath = resolveAssetSourcePath(asset.source);
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    const result = fetchUrlToCache(sourcePath);
    if (result.error) {
      return {
        sourcePath,
        exists: false,
        isDirectory: false,
        hash: null,
        error: `Failed to fetch asset source: ${result.error}`,
      };
    }
    try {
      const { hash, isDirectory } = hashPath(result.path);
      return { sourcePath: result.path, exists: true, isDirectory, hash };
    } catch (error) {
      return {
        sourcePath: result.path,
        exists: false,
        isDirectory: false,
        hash: null,
        error: `Failed to read asset source: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (!existsSync(sourcePath)) {
    return { sourcePath, exists: false, isDirectory: false, hash: null, error: "Asset source not found." };
  }

  try {
    const { hash, isDirectory } = hashPath(sourcePath);
    return { sourcePath, exists: true, isDirectory, hash };
  } catch (error) {
    return {
      sourcePath,
      exists: false,
      isDirectory: false,
      hash: null,
      error: `Failed to read asset source: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

type SymlinkErrorCode =
  | "SOURCE_NOT_FOUND"
  | "TARGET_MISSING"
  | "BACKUP_FAILED"
  | "SYMLINK_FAILED"
  | "UNLINK_FAILED";

export type SymlinkResult =
  | { success: true }
  | { success: false; code: SymlinkErrorCode; message: string };

let cachedGitAvailable: boolean | null = null;

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${message}`);
}

async function ensureGitAvailable(): Promise<void> {
  if (cachedGitAvailable === true) return;
  try {
    await execFileAsync("git", ["--version"]);
    cachedGitAvailable = true;
  } catch (error) {
    cachedGitAvailable = false;
    throw new Error("Git is required to download plugins but was not found. Install from https://git-scm.com/");
  }
}

async function execClaudeCommand(
  instance: ToolInstance,
  command: "install" | "uninstall" | "enable" | "disable" | "update",
  pluginName: string
): Promise<void> {
  validatePluginName(pluginName);
  await execFileAsync("claude", ["plugin", command, pluginName], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: instance.configDir,
    },
  });
}

function buildBackupPath(
  pluginName: string,
  itemKind: string,
  itemName: string
): string {
  validatePluginName(pluginName);
  validateItemName(itemKind, itemName);
  const backupRoot = join(getCacheDir(), "backups");
  const backupPath = safePath(backupRoot, itemKind, itemName);
  mkdirSync(dirname(backupPath), { recursive: true });
  return backupPath;
}

function buildLooseBackupPath(target: string): string {
  let backupPath = `${target}.bak`;
  let attempt = 0;
  while (existsSync(backupPath) || isSymlink(backupPath)) {
    attempt += 1;
    backupPath = `${target}.bak.${attempt}`;
  }
  return backupPath;
}

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
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

function validatePluginMetadata(plugin: Plugin): void {
  validateMarketplaceName(plugin.marketplace);
  validatePluginName(plugin.name);
  for (const skill of plugin.skills) {
    validateItemName("skill", skill);
  }
  for (const cmd of plugin.commands) {
    validateItemName("command", cmd);
  }
  for (const agent of plugin.agents) {
    validateItemName("agent", agent);
  }
}

function parseGithubRepoFromUrl(url: string): { repo: string; ref: string } | null {
  const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/);
  if (rawMatch) return { repo: rawMatch[1], ref: rawMatch[2] };

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (gitMatch) return { repo: gitMatch[1], ref: "main" };

  return null;
}

export async function downloadPlugin(plugin: Plugin, marketplaceUrl: string): Promise<string | null> {
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
  const isLocalMarketplace = marketplaceUrl.startsWith("/") ||
    marketplaceUrl.startsWith("./") ||
    marketplaceUrl.startsWith("../") ||
    marketplaceUrl.startsWith("~");

  if (isLocalMarketplace && typeof source === "string" && source.startsWith("./")) {
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
        new Error(`source=${source}, marketplaceBase=${marketplaceBase}`)
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
      new Error(`source=${JSON.stringify(source)}, marketplaceUrl=${marketplaceUrl}`)
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
      await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, repoUrl!, tempDir]);

      const sourceDir = subPath ? join(tempDir, subPath) : tempDir;

      if (!existsSync(sourceDir)) {
        logError(`Plugin source path not found: ${sourceDir}`, new Error("Missing plugin source"));
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

export function getPluginSourcePath(plugin: Plugin): string | null {
  try {
    validateMarketplaceName(plugin.marketplace);
    validatePluginName(plugin.name);
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    if (existsSync(pluginDir)) {
      return pluginDir;
    }
    return null;
  } catch (error) {
    logError(`Invalid plugin source path for ${plugin.name}`, error);
    return null;
  }
}

export function manifestPath(cacheDir?: string): string {
  return join(cacheDir || getCacheDir(), "installed_items.json");
}

interface Manifest {
  tools: Record<string, { items: Record<string, InstalledItem> }>;
}

export function loadManifest(cacheDir?: string): Manifest {
  const path = manifestPath(cacheDir);
  if (!existsSync(path)) return { tools: {} };
  return withFileLockSync(path, () => {
    const content = readFileSync(path, "utf-8");
    try {
      return JSON.parse(content);
    } catch (error) {
      const message = `Manifest file is corrupted at ${path}: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(message);
    }
  });
}

export function saveManifest(manifest: Manifest, cacheDir?: string): void {
  const path = manifestPath(cacheDir);
  withFileLockSync(path, () => {
    atomicWriteFileSync(path, JSON.stringify(manifest, null, 2));
  });
}

export function createSymlink(
  source: string,
  target: string,
  pluginName?: string,
  itemKind?: string,
  itemName?: string
): SymlinkResult {
  if (!existsSync(source)) {
    return { success: false, code: "SOURCE_NOT_FOUND", message: `Source not found: ${source}` };
  }

  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target)) {
      try {
        const actual = realpathSync(target);
        const expected = realpathSync(source);
        if (actual === expected) return { success: true };
      } catch (error) {
        logError(`Broken symlink at ${target}`, error);
      }
    }

    let backupPath: string;
    if (pluginName && itemKind && itemName) {
      backupPath = buildBackupPath(pluginName, itemKind, itemName);
    } else {
      backupPath = buildLooseBackupPath(target);
    }

    try {
      const tempBackup = `${backupPath}.new.${Date.now()}`;
      renameSync(target, tempBackup);
      if (existsSync(backupPath) || isSymlink(backupPath)) {
        rmSync(backupPath, { recursive: true, force: true });
      }
      renameSync(tempBackup, backupPath);
    } catch (error) {
      logError(`Failed to backup ${target}`, error);
      return { success: false, code: "BACKUP_FAILED", message: `Failed to backup ${target}` };
    }
  }

  const tmpPath = join(tmpdir(), `.tmp_${Date.now()}`);
  try {
    symlinkSync(source, tmpPath);
    renameSync(tmpPath, target);
    return { success: true };
  } catch (error) {
    logError(`Failed to create symlink ${target}`, error);
    return { success: false, code: "SYMLINK_FAILED", message: `Failed to create symlink ${target}` };
  } finally {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch (error) {
        logError(`Failed to remove temp symlink ${tmpPath}`, error);
      }
    }
  }
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function removeSymlink(target: string): SymlinkResult {
  if (!isSymlink(target)) {
    return { success: false, code: "TARGET_MISSING", message: `Target is not a symlink: ${target}` };
  }
  try {
    unlinkSync(target);
    return { success: true };
  } catch (error) {
    logError(`Failed to remove symlink ${target}`, error);
    return { success: false, code: "UNLINK_FAILED", message: `Failed to remove symlink ${target}` };
  }
}



export interface InstallResult {
  success: boolean;
  linkedInstances: Record<string, number>;
  errors: string[];
  skippedInstances: string[];
}

export async function installPlugin(plugin: Plugin, marketplaceUrl: string): Promise<InstallResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
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

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  // For Claude instances, use the native CLI
  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "install", plugin.name);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (e) {
      result.errors.push(
        `Claude install failed for ${instance.name}: ${e instanceof Error ? e.message : "unknown error"}`
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
          const { count, errors } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
          result.linkedInstances[instanceKey(instance)] = count;
          result.errors.push(...errors);
        } catch (error) {
          logError(`Install failed for ${plugin.name} in ${instance.name}`, error);
          result.errors.push(
            `Install failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
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
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
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
  itemName: string
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

function installAssetToInstance(
  asset: Asset,
  instance: ToolInstance,
  sourceInfo: AssetSourceInfo
): { count: number; item?: InstalledItem; error?: string } {
  if (!instance.enabled) return { count: 0 };
  try {
    validateItemName("asset", asset.name);
    const targetRel = resolveAssetTarget(asset, instance);
    const targetPath = join(instance.configDir, targetRel);
    if (!sourceInfo.exists || !sourceInfo.hash) {
      return { count: 0, error: sourceInfo.error || "Asset source not found." };
    }

    const manifest = loadManifest();
    const key = instanceKey(instance);
    if (!manifest.tools[key]) {
      manifest.tools[key] = { items: {} };
    }

    const itemKey = `asset:${asset.name}`;
    const previous = manifest.tools[key].items[itemKey] || null;
    const backupName = `${asset.name}-${instance.toolId}-${instance.instanceId}`;
    const result = copyWithBackup(sourceInfo.sourcePath, targetPath, asset.name, "asset", backupName);

    const item: InstalledItem = {
      kind: "asset",
      name: asset.name,
      source: asset.source || "",
      dest: result.dest,
      backup: result.backup,
      owner: asset.name,
      previous,
    };

    manifest.tools[key].items[itemKey] = item;
    saveManifest(manifest);

    return { count: 1, item };
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getAssetToolStatus(asset: Asset, sourceInfo?: AssetSourceInfo): AssetToolStatus[] {
  const statuses: AssetToolStatus[] = [];
  const instances = getToolInstances();
  const resolvedSource = sourceInfo || getAssetSourceInfo(asset);

  for (const instance of instances) {
    const enabled = instance.enabled;
    let installed = false;
    let drifted = false;
    let targetPath = "";
    try {
      const targetRel = resolveAssetTarget(asset, instance);
      targetPath = join(instance.configDir, targetRel);
      if (enabled && existsSync(targetPath)) {
        installed = true;
        if (resolvedSource.exists && resolvedSource.hash) {
          try {
            const targetHash = hashPath(targetPath);
            if (targetHash.isDirectory !== resolvedSource.isDirectory) {
              drifted = true;
            } else {
              drifted = targetHash.hash !== resolvedSource.hash;
            }
          } catch {
            drifted = true;
          }
        }
      }
    } catch (error) {
      logError(`Failed to resolve asset target for ${asset.name}`, error);
    }

    statuses.push({
      toolId: instance.toolId,
      instanceId: instance.instanceId,
      name: instance.name,
      configDir: instance.configDir,
      enabled,
      installed,
      drifted,
      targetPath,
    });
  }

  return statuses;
}

function installPluginItemsToInstance(
  pluginName: string,
  sourcePath: string,
  instance: ToolInstance
): { count: number; items: InstalledItem[]; errors: string[] } {
  if (!instance.enabled) return { count: 0, items: [], errors: [] };

  validatePluginName(pluginName);
  const errors: string[] = [];
  const items: InstalledItem[] = [];
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
        if (item.backup && (existsSync(item.backup) || isSymlink(item.backup))) {
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

  const installItem = (kind: "skill" | "command" | "agent", name: string, src: string, dest: string) => {
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
    errors.push(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    rollback();
    return { count: 0, items: [], errors };
  }

  if (items.length > 0) {
    saveManifest(manifest);
  }

  return { count: items.length, items, errors };
}

function uninstallPluginItemsFromInstance(pluginName: string, instance: ToolInstance): number {
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

export async function enablePlugin(plugin: Plugin, marketplaceUrl?: string): Promise<EnableResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
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
    try {
      const { count, errors } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
      result.linkedInstances[instanceKey(instance)] = count;
      result.errors.push(...errors);
    } catch (error) {
      logError(`Enable failed for ${plugin.name} in ${instance.name}`, error);
      result.errors.push(
        `Enable failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
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
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
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
    const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
    result.linkedInstances[instanceKey(instance)] = removed;
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function updatePlugin(plugin: Plugin, marketplaceUrl: string): Promise<EnableResult> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
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
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    rmSync(pluginDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to remove plugin dir for ${plugin.name}`, error);
  }

  // Download fresh copy and install to all enabled instances
  const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

  if (sourcePath) {
    for (const instance of enabledInstances) {
      try {
        const { count, errors } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
        result.linkedInstances[instanceKey(instance)] = count;
        result.errors.push(...errors);
      } catch (error) {
        logError(`Update failed for ${plugin.name} in ${instance.name}`, error);
        result.errors.push(
          `Update failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
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
  sourcePath: string
): number {
  if (!instance.enabled) return 0;
  validatePluginName(plugin.name);

  let linked = 0;
  const manifest = loadManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }

  // Debug logging
  console.error(`[DEBUG] linkPluginToInstance: ${plugin.name} -> ${instance.name}`);
  console.error(`[DEBUG] sourcePath: ${sourcePath}`);
  console.error(`[DEBUG] skillsSubdir: ${instance.skillsSubdir}, commandsSubdir: ${instance.commandsSubdir}, agentsSubdir: ${instance.agentsSubdir}`);
  console.error(`[DEBUG] plugin.skills: ${JSON.stringify(plugin.skills)}`);
  console.error(`[DEBUG] plugin.commands: ${JSON.stringify(plugin.commands)}`);
  console.error(`[DEBUG] plugin.agents: ${JSON.stringify(plugin.agents)}`);

  for (const skill of plugin.skills) {
    validateItemName("skill", skill);
    const source = safePath(join(sourcePath, "skills"), skill);
    console.error(`[DEBUG] Checking skill source: ${source}, exists: ${existsSync(source)}`);
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
  console.error(`[DEBUG] linkPluginToInstance completed: ${linked} items linked for ${instance.name}`);
  return linked;
}

function getInstalledPluginsForClaudeInstance(instance: ToolInstance): Plugin[] {
  const plugins: Plugin[] = [];

  // Read installed_plugins.json for the authoritative list of installed plugins
  const installedPluginsPath = join(instance.configDir, "plugins/installed_plugins.json");
  const installedPluginKeys = new Set<string>();

  if (existsSync(installedPluginsPath)) {
    try {
      const content = readFileSync(installedPluginsPath, "utf-8");
      const data = JSON.parse(content);
      if (data.plugins && typeof data.plugins === "object") {
        // Keys are in format "pluginName@marketplace"
        for (const key of Object.keys(data.plugins)) {
          installedPluginKeys.add(key);
        }
      }
    } catch (error) {
      logError(`Failed to read installed_plugins.json for ${instance.name}`, error);
    }
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
        const subDirs = readdirSync(pluginDir).filter(d => {
          const p = join(pluginDir, d);
          try {
            return lstatSync(p).isDirectory() && !d.startsWith(".");
          } catch (error) {
            logError(`Failed to stat ${p}`, error);
            return false;
          }
        });

        if (subDirs.length > 0 && subDirs.every(d => /^[a-f0-9]+$/.test(d))) {
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
        if (existsSync(skillsDir)) {
          try {
            for (const item of readdirSync(skillsDir)) {
              const itemPath = join(skillsDir, item);
              if (existsSync(join(itemPath, "SKILL.md"))) {
                skills.push(item);
              }
            }
          } catch (error) {
            logError(`Failed to read skills in ${skillsDir}`, error);
          }
        }

        const commandsDir = join(contentDir, "commands");
        if (existsSync(commandsDir)) {
          try {
            for (const item of readdirSync(commandsDir)) {
              if (item.endsWith(".md")) {
                commands.push(item.replace(/\.md$/, ""));
              }
            }
          } catch (error) {
            logError(`Failed to read commands in ${commandsDir}`, error);
          }
        }

        const agentsDir = join(contentDir, "agents");
        if (existsSync(agentsDir)) {
          try {
            for (const item of readdirSync(agentsDir)) {
              if (item.endsWith(".md")) {
                agents.push(item.replace(/\.md$/, ""));
              }
            }
          } catch (error) {
            logError(`Failed to read agents in ${agentsDir}`, error);
          }
        }

        const hooksDir = join(contentDir, "hooks");
        if (existsSync(hooksDir)) {
          try {
            for (const item of readdirSync(hooksDir)) {
              hooks.push(item.replace(/\.(md|json)$/, ""));
            }
          } catch (error) {
            logError(`Failed to read hooks in ${hooksDir}`, error);
          }
        }

        if (existsSync(join(contentDir, "mcp.json")) ||
            existsSync(join(contentDir, ".claude-plugin", "mcp.json"))) {
          hasMcp = true;
        }

        const manifestPath = join(contentDir, ".claude-plugin", "manifest.json");
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            description = manifest.description || "";
          } catch (error) {
            logError(`Failed to read manifest ${manifestPath}`, error);
          }
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

export function getInstalledPluginsForInstance(instance: ToolInstance): Plugin[] {
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
    if (existsSync(skillsDir)) {
      try {
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
      } catch (error) {
        logError(`Failed to read skills in ${skillsDir}`, error);
      }
    }
  }

  // Scan commands
  if (instance.commandsSubdir) {
    const commandsDir = join(instance.configDir, instance.commandsSubdir);
    if (existsSync(commandsDir)) {
      try {
        for (const item of readdirSync(commandsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            const itemPath = join(commandsDir, item);
            const source = getSource(itemPath);
            components.push({ type: "command", name, source });
          }
        }
      } catch (error) {
        logError(`Failed to read commands in ${commandsDir}`, error);
      }
    }
  }

  // Scan agents
  if (instance.agentsSubdir) {
    const agentsDir = join(instance.configDir, instance.agentsSubdir);
    if (existsSync(agentsDir)) {
      try {
        for (const item of readdirSync(agentsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            const itemPath = join(agentsDir, item);
            const source = getSource(itemPath);
            components.push({ type: "agent", name, source });
          }
        }
      } catch (error) {
        logError(`Failed to read agents in ${agentsDir}`, error);
      }
    }
  }

  // Group components by plugin (using source path to determine actual plugin)
  // Key format: "marketplace:pluginName" or "local:componentName" for truly local items
  const pluginGroups = new Map<string, {
    marketplace: string;
    pluginName: string;
    source: string;
    skills: string[];
    commands: string[];
    agents: string[];
  }>();

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

export function getAllInstalledPlugins(): { plugins: Plugin[]; byTool: Record<string, Plugin[]> } {
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
  return instances.find(
    (instance) => instance.toolId === toolId && instance.instanceId === instanceId
  ) || null;
}

export async function syncPluginInstances(
  plugin: Plugin,
  marketplaceUrl: string | undefined,
  missingStatuses: ToolInstallStatus[]
): Promise<SyncResult> {
  validatePluginMetadata(plugin);
  const result: SyncResult = { success: false, syncedInstances: {}, errors: [] };
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
      const { count, errors } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
      result.syncedInstances[instanceKey(instance)] = count;
      result.errors.push(...errors);
    } catch (error) {
      logError(`Sync failed for ${plugin.name} in ${instance.name}`, error);
      result.errors.push(
        `Sync failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  result.success = Object.values(result.syncedInstances).some((n) => n > 0);
  return result;
}

export function syncAssetInstances(
  asset: Asset,
  targetStatuses: AssetToolStatus[]
): AssetSyncResult {
  const result: AssetSyncResult = { success: false, syncedInstances: {}, errors: [] };
  if (targetStatuses.length === 0) return result;

  const sourceInfo = getAssetSourceInfo(asset);
  if (!sourceInfo.exists || !sourceInfo.hash) {
    result.errors.push(sourceInfo.error || `Asset source not found for ${asset.name}`);
    return result;
  }

  for (const status of targetStatuses) {
    const instance = findInstance(status.toolId, status.instanceId);
    if (!instance) continue;
    if (!instance.enabled) continue;

    const installResult = installAssetToInstance(asset, instance, sourceInfo);
    if (installResult.count > 0) {
      result.syncedInstances[instanceKey(instance)] = installResult.count;
    }
    if (installResult.error) {
      result.errors.push(`Asset sync failed for ${instance.name}: ${installResult.error}`);
    }
  }

  result.success = Object.values(result.syncedInstances).some((n) => n > 0);
  return result;
}

export function getPluginToolStatus(plugin: Plugin): ToolInstallStatus[] {
  const statuses: ToolInstallStatus[] = [];
  try {
    validatePluginMetadata(plugin);
  } catch (error) {
    logError(`Invalid plugin metadata for ${plugin.name}`, error);
    return statuses;
  }
  const instances = getToolInstances();

  for (const instance of instances) {
    const hasSkills = plugin.skills.length > 0;
    const hasCommands = plugin.commands.length > 0;
    const hasAgents = plugin.agents.length > 0;
    
    const canInstallSkills = hasSkills && instance.skillsSubdir !== null;
    const canInstallCommands = hasCommands && instance.commandsSubdir !== null;
    const canInstallAgents = hasAgents && instance.agentsSubdir !== null;
    
    const supported = canInstallSkills || canInstallCommands || canInstallAgents || 
                      (instance.toolId === "claude-code" && (plugin.hasMcp || plugin.hasLsp));
    
    let installed = false;
    const enabled = instance.enabled;

    if (enabled && supported) {
      // Check for installed components by looking at actual files/symlinks
      // This works for all tools including Claude
      if (canInstallSkills && instance.skillsSubdir) {
        for (const skill of plugin.skills) {
          const base = join(instance.configDir, instance.skillsSubdir);
          const skillPath = safePath(base, skill);
          if (existsSync(skillPath)) {
            installed = true;
            break;
          }
        }
      }
      if (!installed && canInstallCommands && instance.commandsSubdir) {
        for (const cmd of plugin.commands) {
          const base = join(instance.configDir, instance.commandsSubdir);
          const cmdPath = safePath(base, `${cmd}.md`);
          if (existsSync(cmdPath)) {
            installed = true;
            break;
          }
        }
      }
      if (!installed && canInstallAgents && instance.agentsSubdir) {
        for (const agent of plugin.agents) {
          const base = join(instance.configDir, instance.agentsSubdir);
          const agentPath = safePath(base, `${agent}.md`);
          if (existsSync(agentPath)) {
            installed = true;
            break;
          }
        }
      }
      
      // For MCP-only plugins on Claude, check installed_plugins.json
      if (!installed && plugin.hasMcp && instance.toolId === "claude-code") {
        const installedPluginsPath = join(instance.configDir, "plugins/installed_plugins.json");
        if (existsSync(installedPluginsPath)) {
          try {
            const content = readFileSync(installedPluginsPath, "utf-8");
            const data = JSON.parse(content);
            if (data.plugins && typeof data.plugins === "object") {
              for (const key of Object.keys(data.plugins)) {
                const pluginName = key.split("@")[0];
                if (pluginName === plugin.name) {
                  installed = true;
                  break;
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
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
    });
  }

  return statuses;
}

// Config sync types and functions

export interface ConfigToolStatus {
  toolId: string;
  instanceId: string;
  name: string;
  configDir: string;
  enabled: boolean;
  installed: boolean;
  drifted: boolean;
  targetPath: string;
}

export interface ConfigSyncResult {
  success: boolean;
  syncedInstances: Record<string, number>;
  errors: string[];
}


// Helper to check if a path is a directory sync (ends with / or \)
function isDirectorySyncPath(path: string): boolean {
  return path.endsWith("/") || path.endsWith("\\");
}

// Helper to check if a path contains glob patterns
function isGlobPattern(path: string): boolean {
  return fastGlob.isDynamicPattern(path);
}

function normalizeConfigSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Config source cannot be empty.");
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  const validationPath = normalized.replace(/\/+$/, "");
  validateRelativeSubPath(validationPath);
  return normalized;
}

interface NormalizedConfigTarget {
  path: string;
  isDir: boolean;
}

function normalizeConfigTarget(target: string): NormalizedConfigTarget {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Config target cannot be empty.");
  }
  const isDir = trimmed === "." || trimmed === "./" || isDirectorySyncPath(trimmed);
  const cleaned = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const withoutDot = cleaned.replace(/^\.\//, "");
  const normalized = withoutDot === "." ? "" : withoutDot;
  if (normalized) {
    validateRelativeSubPath(normalized);
  }
  return { path: normalized, isDir };
}

function buildConfigTargetPath(
  target: NormalizedConfigTarget,
  fileName: string,
  sourceIsMultiFile: boolean
): string {
  const useDir = sourceIsMultiFile || target.isDir;
  if (useDir) {
    return target.path ? join(target.path, fileName) : fileName;
  }
  return target.path;
}

function normalizeBackupLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Config name cannot be empty.");
  }
  const normalized = trimmed.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!normalized) {
    throw new Error(`Invalid backup label: ${value}`);
  }
  return normalized;
}

// Expand a mapping to list of source files
async function expandConfigMapping(
  mapping: ConfigMapping,
  configRepo: string
): Promise<Array<{ sourcePath: string; targetPath: string; hash: string }>> {
  const sourcePattern = normalizeConfigSource(mapping.source);
  const targetInfo = normalizeConfigTarget(mapping.target);
  const results: Array<{ sourcePath: string; targetPath: string; hash: string }> = [];

  const addEntry = (sourcePath: string, fileName: string, sourceIsMultiFile: boolean) => {
    const targetPath = buildConfigTargetPath(targetInfo, fileName, sourceIsMultiFile);
    const hash = hashFile(sourcePath);
    results.push({ sourcePath, targetPath, hash });
  };

  // Handle directory sync (trailing slash convention)
  if (isDirectorySyncPath(sourcePattern)) {
    const sourceDir = join(configRepo, sourcePattern.replace(/[\\/]+$/, ""));
    if (!existsSync(sourceDir)) {
      return [];
    }

    const stat = lstatSync(sourceDir);
    if (!stat.isDirectory()) {
      return [];
    }

    // Get all files in directory recursively
    const entries = await fastGlob("**/*", {
      cwd: sourceDir,
      absolute: false,
      onlyFiles: true,
      dot: true,
    });

    for (const entry of entries) {
      const fullSourcePath = join(sourceDir, entry);
      addEntry(fullSourcePath, basename(entry), true);
    }

    return results;
  }

  // Handle glob patterns
  if (isGlobPattern(sourcePattern)) {
    const entries = await fastGlob(sourcePattern, {
      cwd: configRepo,
      absolute: true,
      onlyFiles: true,
      dot: true,
    });

    for (const entry of entries) {
      addEntry(entry, basename(entry), true);
    }

    return results;
  }

  const sourceFullPath = join(configRepo, sourcePattern);
  if (!existsSync(sourceFullPath)) {
    return [];
  }

  const stat = lstatSync(sourceFullPath);
  if (stat.isDirectory()) {
    const entries = await fastGlob("**/*", {
      cwd: sourceFullPath,
      absolute: false,
      onlyFiles: true,
      dot: true,
    });

    for (const entry of entries) {
      const fullSourcePath = join(sourceFullPath, entry);
      addEntry(fullSourcePath, basename(entry), true);
    }
  } else {
    addEntry(sourceFullPath, basename(sourceFullPath), false);
  }

  return results;
}

// Get all source files for a config (handles both legacy and new formats)
export async function getConfigSourceFiles(config: ConfigSyncConfig): Promise<ConfigSourceFile[]> {
  const configRepo = getConfigRepoPath();
  if (!configRepo) {
    throw new Error("Config repo not configured. Add [sync] config_repo to your config.toml");
  }

  if (!config.name || !config.name.trim()) {
    throw new Error("Config name cannot be empty.");
  }

  const mappings: ConfigMapping[] = config.mappings && config.mappings.length > 0
    ? config.mappings
    : config.sourcePath && config.targetPath
      ? [{ source: config.sourcePath, target: config.targetPath }]
      : [];

  if (mappings.length === 0) {
    throw new Error(`Config ${config.name || "(unnamed)"} has no mappings. Add [[configs.files]] or source_path/target_path.`);
  }

  const results: ConfigSourceFile[] = [];
  const seenTargets = new Set<string>();

  for (const mapping of mappings) {
    if (!mapping.source || !mapping.target) {
      throw new Error(`Config ${config.name || "(unnamed)"} mapping requires both source and target.`);
    }

    const expanded = await expandConfigMapping(mapping, configRepo);
    if (expanded.length === 0) {
      throw new Error(`No files found for config ${config.name || "(unnamed)"} mapping ${mapping.source} → ${mapping.target}`);
    }

    for (const file of expanded) {
      const targetKey = file.targetPath.replace(/\\/g, "/");
      if (seenTargets.has(targetKey)) {
        throw new Error(`Config ${config.name || "(unnamed)"} has duplicate target path: ${file.targetPath}`);
      }
      seenTargets.add(targetKey);
      results.push({
        sourcePath: file.sourcePath,
        targetPath: file.targetPath,
        hash: file.hash,
        isDirectory: false,
      });
    }
  }

  return results;
}

// Compute aggregated hash for all source files
function hashSourceFiles(files: ConfigSourceFile[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return files[0].hash;

  const hasher = createHash("sha256");
  for (const file of files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))) {
    hasher.update(file.targetPath);
    hasher.update("\0");
    hasher.update(file.hash);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

// Updated status check for multi-file configs
export function getConfigToolStatus(config: ConfigSyncConfig, sourceFiles?: ConfigSourceFile[]): ConfigToolStatus[] {
  const statuses: ConfigToolStatus[] = [];
  const instances = getToolInstances();

  // Only get instances that match the config's toolId
  const matchingInstances = instances.filter((instance) => instance.toolId === config.toolId);

  for (const instance of matchingInstances) {
    const enabled = instance.enabled;
    const files = sourceFiles || [];
    const hasFiles = files.length > 0;

    let installed = false;
    let drifted = false;
    const targetBase = join(instance.configDir, config.targetPath || ".");

    if (enabled && hasFiles) {
      let anyExist = false;
      let anyMissing = false;
      let anyDrifted = false;

      for (const file of files) {
        const targetPath = join(instance.configDir, file.targetPath);
        if (!existsSync(targetPath)) {
          anyMissing = true;
          continue;
        }

        anyExist = true;
        try {
          const targetHash = hashFile(targetPath);
          if (targetHash !== file.hash) {
            anyDrifted = true;
          }
        } catch {
          anyDrifted = true;
        }
      }

      installed = anyExist;
      drifted = anyExist && (anyDrifted || anyMissing);
    }

    statuses.push({
      toolId: instance.toolId,
      instanceId: instance.instanceId,
      name: instance.name,
      configDir: instance.configDir,
      enabled,
      installed,
      drifted,
      targetPath: targetBase,
    });
  }

  return statuses;
}

// Install multi-file config to instance
async function installConfigToInstance(
  config: ConfigSyncConfig,
  instance: ToolInstance,
  sourceFiles: ConfigSourceFile[]
): Promise<{ count: number; error?: string }> {
  if (!instance.enabled) return { count: 0 };
  if (instance.toolId !== config.toolId) return { count: 0 };

  if (sourceFiles.length === 0) {
    return { count: 0, error: "No source files found for config." };
  }

  try {
    const manifest = loadManifest();
    const key = instanceKey(instance);
    if (!manifest.tools[key]) {
      manifest.tools[key] = { items: {} };
    }

    let syncedCount = 0;
    const itemKey = `config:${config.name}`;
    const previous = manifest.tools[key].items[itemKey] || null;
    const backupOwner = normalizeBackupLabel(config.name);

    for (const file of sourceFiles) {
      const targetPath = join(instance.configDir, file.targetPath);

      // Check if target exists and matches (skip if already in sync)
      if (existsSync(targetPath)) {
        try {
          const targetHash = hashFile(targetPath);
          if (targetHash === file.hash) {
            continue; // Already in sync
          }
        } catch {
          // Target exists but can't be hashed, continue with sync
        }
      }

      const backupName = normalizeBackupLabel(
        `${config.name}-${basename(file.targetPath)}-${instance.toolId}-${instance.instanceId}`
      );
      copyWithBackup(file.sourcePath, targetPath, backupOwner, "config", backupName);
      syncedCount++;
    }

    // Update manifest with aggregate info
    const item: InstalledItem = {
      kind: "asset",
      name: config.name,
      source: hashSourceFiles(sourceFiles),
      dest: instance.configDir,
      backup: null,
      owner: config.name,
      previous,
    };

    manifest.tools[key].items[itemKey] = item;
    saveManifest(manifest);

    return { count: syncedCount };
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function syncConfigInstances(
  config: ConfigFile,
  targetStatuses: ConfigToolStatus[]
): Promise<ConfigSyncResult> {
  const result: ConfigSyncResult = { success: false, syncedInstances: {}, errors: [] };
  if (targetStatuses.length === 0) return result;

  let sourceFiles: ConfigSourceFile[] = [];
  try {
    sourceFiles = config.sourceFiles || await getConfigSourceFiles(config);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  for (const status of targetStatuses) {
    const instance = getToolInstances().find(
      (inst) => inst.toolId === status.toolId && inst.instanceId === status.instanceId
    );
    if (!instance) continue;
    if (!instance.enabled) continue;

    const installResult = await installConfigToInstance(config, instance, sourceFiles);
    if (installResult.count > 0) {
      result.syncedInstances[instanceKey(instance)] = installResult.count;
    }
    if (installResult.error) {
      result.errors.push(`Config sync failed for ${instance.name}: ${installResult.error}`);
    }
  }

  result.success = Object.values(result.syncedInstances).some((n) => n > 0);
  return result;
}
