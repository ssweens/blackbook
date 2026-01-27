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
import { execFile } from "child_process";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);
import { join, dirname } from "path";
import { tmpdir } from "os";
import { expandPath, getCacheDir, getEnabledToolInstances, getToolInstances } from "./config.js";
import type { Asset, AssetConfig, Plugin, InstalledItem, ToolInstance } from "./types.js";
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

export function getPluginsCacheDir(): string {
  return join(getCacheDir(), "plugins");
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

function resolveAssetTarget(asset: AssetConfig, instance: ToolInstance): string {
  const overrideKey = `${instance.toolId}:${instance.instanceId}`;
  const override = asset.overrides?.[overrideKey];
  if (override) return normalizeAssetTarget(override);
  if (asset.defaultTarget) return normalizeAssetTarget(asset.defaultTarget);
  return instance.toolId === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

export function getAssetSourceInfo(asset: AssetConfig): AssetSourceInfo {
  const sourcePath = expandPath(asset.source);
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    return {
      sourcePath,
      exists: false,
      isDirectory: false,
      hash: null,
      error: "Asset source URLs are not supported yet.",
    };
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
let cachedClaudeAvailable: boolean | null = null;

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

async function ensureClaudeAvailable(): Promise<void> {
  if (cachedClaudeAvailable === true) return;
  try {
    await execFileAsync("claude", ["--version"]);
    cachedClaudeAvailable = true;
  } catch (error) {
    cachedClaudeAvailable = false;
    throw new Error(
      "Claude CLI was not found. Install it or disable Claude instances in your config."
    );
  }
}

async function execClaudeCommand(
  instance: ToolInstance,
  command: "install" | "uninstall" | "enable" | "disable" | "update",
  pluginName: string
): Promise<void> {
  validatePluginName(pluginName);
  await ensureClaudeAvailable();
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

  let repoUrl: string | null = null;
  let ref = "main";
  let subPath = "";

  const source = plugin.source;
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

function isPluginInstalledInClaudeInstance(plugin: Plugin, instance: ToolInstance): boolean {
  const claudePluginsDir = join(instance.configDir, "plugins/cache");
  if (!existsSync(claudePluginsDir)) return false;

  for (const marketplace of readdirSync(claudePluginsDir)) {
    const mpDir = join(claudePluginsDir, marketplace);
    if (!existsSync(mpDir)) continue;

    for (const pluginName of readdirSync(mpDir)) {
      if (pluginName === plugin.name) return true;
    }
  }

  return false;
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

  if (nonClaudeInstances.length > 0) {
    const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

    if (!sourcePath) {
      if (Object.values(result.linkedInstances).every((count) => count === 0)) {
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
  let claudeSuccess = false;
  let removedCount = 0;

  if (enabledInstances.length === 0) {
    return false;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "uninstall", plugin.name);
      claudeSuccess = true;
    } catch (error) {
      logError(`Claude uninstall failed for ${instance.name}`, error);
    }
  }

  for (const instance of nonClaudeInstances) {
    removedCount += uninstallPluginItemsFromInstance(plugin.name, instance);
  }

  try {
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    rmSync(pluginDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to remove plugin dir for ${plugin.name}`, error);
  }

  return claudeSuccess || removedCount > 0;
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
      source: asset.source,
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

          if (item.previous) {
            toolManifest.items[entryKey] = item.previous;
          } else {
            keysToRemove.push(entryKey);
          }
        } catch (error) {
          logError(`Failed to uninstall ${item.kind}:${item.name}`, error);
        }
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

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "enable", plugin.name);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (error) {
      logError(`Claude enable failed for ${instance.name}`, error);
      result.errors.push(
        `Claude enable failed for ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  let sourcePath = getPluginSourcePath(plugin);
  
  if (!sourcePath && marketplaceUrl) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl);
  }
  
  if (sourcePath) {
    for (const instance of nonClaudeInstances) {
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
  } else if (nonClaudeInstances.length > 0) {
    result.errors.push(`Plugin source not found for ${plugin.name}`);
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

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "disable", plugin.name);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (error) {
      logError(`Claude disable failed for ${instance.name}`, error);
      result.errors.push(
        `Claude disable failed for ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  for (const instance of nonClaudeInstances) {
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

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "update", plugin.name);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (error) {
      logError(`Claude update failed for ${instance.name}`, error);
      result.errors.push(
        `Claude update failed for ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  for (const instance of nonClaudeInstances) {
    uninstallPluginItemsFromInstance(plugin.name, instance);
  }

  try {
    const pluginDir = safePath(getPluginsCacheDir(), plugin.marketplace, plugin.name);
    rmSync(pluginDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to remove plugin dir for ${plugin.name}`, error);
  }

  if (nonClaudeInstances.length > 0) {
    const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

    if (sourcePath) {
      for (const instance of nonClaudeInstances) {
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
    } else if (Object.values(result.linkedInstances).every((count) => count === 0)) {
      result.errors.push(`Failed to download plugin update for ${plugin.name}`);
    }
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

  for (const skill of plugin.skills) {
    validateItemName("skill", skill);
    const source = safePath(join(sourcePath, "skills"), skill);
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
  return linked;
}

function getInstalledPluginsForClaudeInstance(instance: ToolInstance): Plugin[] {
  const claudePluginsDir = join(instance.configDir, "plugins/cache");
  const plugins: Plugin[] = [];

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

  const plugins: Plugin[] = [];
  const seen = new Set<string>();

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
                if (!seen.has(item)) {
                  seen.add(item);
                  plugins.push({
                    name: item,
                    marketplace: "local",
                    description: "",
                    source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                    skills: [item],
                    commands: [],
                    agents: [],
                    hooks: [],
                    hasMcp: false,
                    hasLsp: false,
                    homepage: "",
                    installed: true,
                    scope: "user",
                  });
                }
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

  if (instance.commandsSubdir) {
    const commandsDir = join(instance.configDir, instance.commandsSubdir);
    if (existsSync(commandsDir)) {
      try {
        for (const item of readdirSync(commandsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            if (!seen.has(name)) {
              seen.add(name);
              const itemPath = join(commandsDir, item);
              const stat = lstatSync(itemPath);
              plugins.push({
                name,
                marketplace: "local",
                description: "",
                source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                skills: [],
                commands: [name],
                agents: [],
                hooks: [],
                hasMcp: false,
                hasLsp: false,
                homepage: "",
                installed: true,
                scope: "user",
              });
            }
          }
        }
      } catch (error) {
        logError(`Failed to read commands in ${commandsDir}`, error);
      }
    }
  }

  if (instance.agentsSubdir) {
    const agentsDir = join(instance.configDir, instance.agentsSubdir);
    if (existsSync(agentsDir)) {
      try {
        for (const item of readdirSync(agentsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            if (!seen.has(name)) {
              seen.add(name);
              const itemPath = join(agentsDir, item);
              const stat = lstatSync(itemPath);
              plugins.push({
                name,
                marketplace: "local",
                description: "",
                source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                skills: [],
                commands: [],
                agents: [name],
                hooks: [],
                hasMcp: false,
                hasLsp: false,
                homepage: "",
                installed: true,
                scope: "user",
              });
            }
          }
        }
      } catch (error) {
        logError(`Failed to read agents in ${agentsDir}`, error);
      }
    }
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

  const claudeInstances = missingInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = missingInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, "install", plugin.name);
      result.syncedInstances[instanceKey(instance)] = 1;
    } catch (e) {
      result.errors.push(
        `Claude sync failed for ${instance.name}: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }
  }

  if (nonClaudeInstances.length > 0) {
    let sourcePath = getPluginSourcePath(plugin);
    if (!sourcePath && marketplaceUrl) {
      sourcePath = await downloadPlugin(plugin, marketplaceUrl);
    }

    if (!sourcePath) {
      result.errors.push(`Failed to locate plugin source for ${plugin.name}`);
    } else {
      for (const instance of nonClaudeInstances) {
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
      if (instance.toolId === "claude-code") {
        installed = isPluginInstalledInClaudeInstance(plugin, instance);
      } else {
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
