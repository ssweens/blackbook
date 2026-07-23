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
  readlinkSync,
  statSync,
  copyFileSync,
  cpSync,
  rmSync,
} from "fs";
import { promisify } from "util";
import { execFile, execFileSync } from "child_process";
import { hashBuffer, hashFile, hashPath, hashString, hashDirectory } from "./modules/hash.js";
import { createBackup, pruneBackups } from "./modules/backup.js";
import { applySymlinkSync, checkSymlinkSync } from "./modules/symlink-create.js";

const execFileAsync = promisify(execFile);
import { join, dirname, resolve, relative, basename } from "path";
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
  parseMarketplaces,
  getSkillSyncMode,
} from "./config.js";
import { loadPiSettings, normalizePiPackageSource } from "./marketplace.js";
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
import { atomicWriteFileSync, renameOrCopy, withFileLockSync } from "./fs-utils.js";
import { agentsSkillsDir, flattenNamespacedName, readSkillFrontmatterName, resolveInstanceSubdirPath, resolveLocalPath, scanPluginContents } from "./path-utils.js";
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
  buildManifestItemKey,
  migrateManifestKeys,
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
// Per-tool plugin lifecycle logic lives in the adapters, dispatched by toolId.
// The orchestrators below resolve `getAdapterForTool(instance.toolId)` and call
// its install/uninstall/update/installComponents/removeComponents methods
// instead of the old inline `if (isClaude) … else if (isPi) …` chains.
import { getAdapterForTool } from "./adapters/types.js";
import {
  installPluginItemsToInstance,
  uninstallPluginItemsFromInstance,
} from "./adapters/managed.js";
import { removeFromClaudeInstalledPluginsJson } from "./adapters/claude.js";
// Preserve the historical public surface: these were exported from install.ts
// before they moved into the adapters. Re-export so external importers (store,
// tests) keep working unchanged.
export { removeFromClaudeInstalledPluginsJson };

// extractPluginInfoFromSource and readClaudePluginMetadata now live in the
// adapters (managed.ts and claude.ts respectively).

// Hash functions imported from modules/hash.ts (single source of truth)

export function isConfigOnlyInstance(instance: ToolInstance): boolean {
  return (
    !instance.skillsSubdir && !instance.commandsSubdir && !instance.agentsSubdir
  );
}

/**
 * Load the manifest and migrate any legacy (un-owned) item keys to the
 * owner-scoped format before any lookup/mutation runs. Use this everywhere
 * install.ts reads the manifest for item-key operations.
 */
function loadMigratedManifest(): Manifest {
  const manifest = loadManifest();
  migrateManifestKeys(manifest);
  return manifest;
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

// execClaudeCommand now lives in ./adapters/claude.ts.
// Pi has no native marketplace registration to clean up (the plugin bridge
// that provided one was removed) — Blackbook's own config.yaml tracking is
// the only bookkeeping, same as OpenCode/Amp/Codex.

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

export function parseGithubRepoFromUrl(
  url: string,
): { repo: string; ref: string } | null {
  const rawMatch = url.match(
    /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/,
  );
  if (rawMatch) return { repo: rawMatch[1], ref: rawMatch[2] };

  // Non-greedy repo segment anchored at the end so a trailing `.git` is stripped
  // without truncating repo names that legitimately contain a dot
  // (e.g. `owner/repo.name`). Mirrors marketplace.ts's correct implementation.
  const gitMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (gitMatch) return { repo: gitMatch[1], ref: "main" };

  return null;
}

/**
 * Fetch a skills.sh-discovered skill's files via their download API and lay
 * them out at `<pluginDir>/skills/<skillId>/...` — the same canonical shape
 * every other plugin source produces, so the rest of the install pipeline
 * (installPlugin, drift detection, uninstall) needs no skills.sh-specific
 * branches beyond this one entry point.
 */
async function downloadSkillsShPlugin(plugin: Plugin, pluginDir: string): Promise<string | null> {
  // plugin.name is "owner-repo" (namespace/manifest-owner) — the actual skill
  // directory/download-API slug is plugin.skills[0] (see skillsShResultToPlugin).
  const skillId = plugin.skills[0];
  const repo = typeof plugin.source === "object" ? plugin.source.repo : undefined;
  if (!skillId) {
    logError(`skills.sh plugin ${plugin.name} has no skill id`, new Error("missing skills[0]"));
    return null;
  }
  if (!repo) {
    logError(`skills.sh plugin ${plugin.name} has no repo source`, new Error("missing source.repo"));
    return null;
  }
  try {
    const res = await fetch(`https://skills.sh/api/download/${repo}/${skillId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logError(`Failed to download skills.sh skill ${skillId}`, new Error(`HTTP ${res.status}`));
      return null;
    }
    const data = (await res.json()) as { files?: Array<{ path?: string; contents?: string }> };
    const files = data.files ?? [];
    if (files.length === 0) return null;

    const skillDir = safePath(join(pluginDir, "skills"), skillId);
    for (const file of files) {
      if (!file.path || typeof file.contents !== "string") continue;
      const dest = safePath(skillDir, ...file.path.split("/"));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.contents, "utf-8");
    }
    return existsSync(join(skillDir, "SKILL.md")) ? pluginDir : null;
  } catch (error) {
    logError(`Failed to download skills.sh skill ${skillId}`, error);
    return null;
  }
}

/**
 * Locate a plugin's source directory inside a LOCAL marketplace repo. A freshly
 * scanned/installed plugin carries an absolute cache `source` (e.g.
 * `~/.cache/blackbook/plugins/<mkt>/<name>/...`), not the marketplace's declared
 * `./plugins/<name>` — so re-deriving from the marketplace is required; trusting
 * the scanned `source` is what made a re-install after a cache delete fail.
 * Tries, in order: a `./`-relative `plugin.source`, the marketplace.json's
 * declared source for this plugin name, then the conventional `plugins/<name>`
 * layout. Returns an existing directory or null.
 */
function resolveLocalPluginSourceDir(marketplaceBase: string, plugin: Plugin): string | null {
  // Source paths in marketplace.json are relative to repo root; if the base is
  // the `.claude-plugin/` dir, step up.
  const base = basename(marketplaceBase) === ".claude-plugin" ? dirname(marketplaceBase) : marketplaceBase;

  // 1. A `./`-relative source carried on the plugin object.
  if (typeof plugin.source === "string" && plugin.source.startsWith("./")) {
    const dir = resolve(base, plugin.source);
    if (existsSync(dir)) return dir;
  }

  // 2. The declared source in the local marketplace.json, looked up by name.
  for (const manifestPath of [
    join(base, ".claude-plugin", "marketplace.json"),
    join(base, "marketplace.json"),
  ]) {
    try {
      if (!existsSync(manifestPath)) continue;
      const data = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        plugins?: Array<{ name?: string; source?: unknown }>;
      };
      const entry = data.plugins?.find((p) => p?.name === plugin.name);
      if (entry && typeof entry.source === "string" && entry.source.startsWith("./")) {
        const dir = resolve(base, entry.source);
        if (existsSync(dir)) return dir;
      }
    } catch {
      // Try the next manifest location.
    }
  }

  // 3. Conventional layout: <repo>/plugins/<name>.
  const conventional = join(base, "plugins", plugin.name);
  return existsSync(conventional) ? conventional : null;
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

  // skills.sh discovery result: fetch the skill's files directly via their
  // download API rather than git-cloning the whole repo — sidesteps having
  // to locate an arbitrary subpath inside someone else's repo layout.
  if (plugin.marketplace === "skills.sh") {
    const downloaded = await downloadSkillsShPlugin(plugin, pluginDir);
    if (!downloaded) rmSync(pluginDir, { recursive: true, force: true });
    return downloaded;
  }

  const source = plugin.source;

  // Handle local marketplace (path-based, including file:// URLs — matches
  // the file:// handling marketplace.ts and path-utils.ts already do). ANY
  // local marketplace copies from disk: there's no git remote to fall back to.
  const localMarketplaceBase = resolveLocalPath(marketplaceUrl);

  if (localMarketplaceBase) {
    const sourceDir = resolveLocalPluginSourceDir(localMarketplaceBase, plugin);
    if (!sourceDir) {
      logError(
        `Local plugin source not found for ${plugin.name}`,
        new Error(`source=${JSON.stringify(source)}, marketplaceBase=${localMarketplaceBase}`),
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
      // Match the 60-120s git-timeout convention used elsewhere (marketplace.ts)
      // so a hung network connection can't block the TUI indefinitely.
      const cloneTimeout = 120000;
      try {
        await execFileAsync(
          "git",
          ["clone", "--depth", "1", "--branch", ref, repoUrl!, tempDir],
          { timeout: cloneTimeout },
        );
      } catch (cloneError) {
        // Distinguish a genuinely missing branch (retryable) from a
        // network/timeout failure (fatal — re-throw so the caller reports it).
        const killed = (cloneError as { killed?: boolean }).killed === true;
        const message = cloneError instanceof Error ? cloneError.message : String(cloneError);
        if (killed || /ETIMEDOUT|timed out/i.test(message)) {
          throw cloneError;
        }
        // The pinned --branch clone failed (e.g. `ref` defaulted to "main" but
        // the repo's default branch is "master"). Retry the default branch, then
        // best-effort check out the requested ref.
        rmSync(tempDir, { recursive: true, force: true });
        mkdirSync(tempDir, { recursive: true });
        await execFileAsync(
          "git",
          ["clone", "--depth", "1", repoUrl!, tempDir],
          { timeout: cloneTimeout },
        );
        try {
          await execFileAsync("git", ["-C", tempDir, "checkout", ref], { timeout: cloneTimeout });
        } catch {
          // `ref` is not a distinct branch/tag here (commonly a default guess for
          // a repo whose default branch differs); fall back to the default branch.
          logError(
            `Using default branch for ${plugin.name}`,
            new Error(`ref "${ref}" not found; used repository default branch`),
          );
        }
      }

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

  // Every tool, INCLUDING Claude, installs through the shared component
  // file-copy engine (installComponents) — never the native `claude plugin
  // install` CLI. Blackbook owns the plugin lifecycle end to end so every
  // artifact lands (and stays) in the shared ~/.agents store; Claude's own
  // native plugin registration is never used.
  const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

  if (!sourcePath) {
    result.errors.push(`Failed to download plugin ${plugin.name}`);
    return result;
  }

  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    try {
      const adapter = getAdapterForTool(instance.toolId);
      const r = await adapter.installComponents(plugin, instance, sourcePath, marketplaceUrl);
      result.linkedInstances[instanceKey(instance)] = r.count;
      result.errors.push(...r.errors);
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

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function uninstallPluginFromInstance(
  plugin: Plugin,
  toolId: string,
  instanceId: string,
): Promise<boolean> {
  validatePluginMetadata(plugin);
  const instances = getToolInstances().filter((i) => i.kind === "tool");
  const instance = instances.find(
    (i) => i.toolId === toolId && i.instanceId === instanceId,
  );
  if (!instance) return false;

  // Component surface for every tool, INCLUDING Claude — never the native
  // `claude plugin uninstall` CLI. count > 0 means "removed".
  const count = await getAdapterForTool(instance.toolId).removeComponents(plugin, instance);
  return count > 0;
}

// removeFromClaudeInstalledPluginsJson now lives in ./adapters/claude.ts and is
// re-exported above for API compatibility.

export async function uninstallPlugin(plugin: Plugin): Promise<boolean> {
  validatePluginMetadata(plugin);
  const enabledInstances = getEnabledToolInstances();
  let removedCount = 0;

  if (enabledInstances.length === 0) {
    return false;
  }

  // Every tool, INCLUDING Claude, was installed through the component surface
  // (see installPlugin), so removal always goes through removeComponents too —
  // never the native `claude plugin uninstall` CLI.
  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    const adapter = getAdapterForTool(instance.toolId);
    removedCount += await adapter.removeComponents(plugin, instance);
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

  // Shared-store skills (installed to multiple tools where one is a flat/derived
  // tool like Claude) can leave the physical ~/.agents/skills copy orphaned:
  // Claude's manifest entry is the SYMLINK dest, so its uninstall unlinks
  // without removing the store target, and the other tools' entries are
  // sharedInstall no-ops. After removing every instance, prune the store
  // namespace dir if nothing in the manifest still points into it.
  removeOrphanedStoreNamespace(plugin.name);

  return removedCount > 0;
}

/**
 * Remove `~/.agents/skills/<namespace>/` (and any empty parent) when no manifest
 * entry across any tool still references a path inside it. Safe no-op when the
 * dir doesn't exist or is still referenced. Best-effort; never throws.
 */
function removeOrphanedStoreNamespace(namespace: string): void {
  try {
    const nsDir = join(homedir(), ".agents", "skills", namespace);
    if (!existsSync(nsDir)) return;

    const manifest = loadManifest();
    const prefix = nsDir.endsWith("/") ? nsDir : `${nsDir}/`;
    for (const toolManifest of Object.values(manifest.tools)) {
      for (const item of Object.values(toolManifest.items)) {
        // A manifest entry keeps the store dir alive only if its dest resolves
        // INTO it — a Claude symlink dest (~/.claude/skills/...) never does, so
        // it correctly doesn't count as a reference here.
        if (item.dest === nsDir || item.dest.startsWith(prefix)) return;
      }
    }
    rmSync(nsDir, { recursive: true, force: true });
  } catch (error) {
    logError(`Failed to prune orphaned store namespace ${namespace}`, error);
  }
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

// copyWithBackup and installPluginItemsToInstance / uninstallPluginItemsFromInstance
// now live in ./adapters/managed.ts (the file-copy engine). install.ts imports
// the latter two for the standalone-delete path and the managed update swap.

// Matches the transient temp name copyWithBackup uses while swapping a user's
// original file into the backup cache: `${backupPath}.new.${Date.now()}`.
const STALE_BACKUP_TEMP_PATTERN = /\.new\.\d+$/;

/**
 * Recover user files stranded by a crash mid-backup.
 *
 * copyWithBackup moves a user's pre-existing file to `<backup>.new.<timestamp>`
 * and then renames it onto its final `<backup>` path. If the process dies
 * between those two renames, the `.new.<timestamp>` orphan is left behind
 * holding the user's ORIGINAL content, with the manifest unaware of it.
 *
 * This scans the backup cache for such orphans and, when the final backup slot
 * is free, completes the interrupted move (unambiguous). If the final slot is
 * already occupied it does NOT touch either file — it logs the orphan for the
 * user to review, since silently overwriting could destroy real content.
 *
 * Safe to call once at startup. Returns a summary for callers/tests.
 */
export function reconcileStaleInstallArtifacts(): {
  restored: string[];
  needsReview: string[];
} {
  const restored: string[] = [];
  const needsReview: string[] = [];
  const backupRoot = join(getCacheDir(), "backups");
  if (!existsSync(backupRoot)) return { restored, needsReview };

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      logError(`Failed to scan backup dir ${dir}`, error);
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (STALE_BACKUP_TEMP_PATTERN.test(entry)) {
        // Orphaned temp artifact: complete or flag the interrupted move.
        const intended = full.replace(STALE_BACKUP_TEMP_PATTERN, "");
        try {
          if (!existsSync(intended) && !isSymlink(intended)) {
            renameSync(full, intended);
            restored.push(intended);
          } else {
            needsReview.push(full);
            logError(
              "Stale install backup needs review",
              new Error(
                `Orphaned backup ${full} could not be auto-restored because ${intended} already exists. It may hold your original file; review it manually.`,
              ),
            );
          }
        } catch (error) {
          needsReview.push(full);
          logError(`Failed to reconcile stale backup ${full}`, error);
        }
        // Do not descend into a matched orphan (it holds user content).
        continue;
      }
      let isDir = false;
      try {
        isDir = lstatSync(full).isDirectory() && !isSymlink(full);
      } catch {
        isDir = false;
      }
      if (isDir) walk(full);
    }
  };

  walk(backupRoot);
  return { restored, needsReview };
}

// installPluginItemsToInstance and uninstallPluginItemsFromInstance now live in
// ./adapters/managed.ts and are imported at the top of this file.

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

  // Enable (install) to all enabled instances via each adapter's component
  // surface (Pi bridge install; everyone else — including Claude here — file-copy).
  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    try {
      const r = await getAdapterForTool(instance.toolId).installComponents(
        plugin,
        instance,
        sourcePath,
        marketplaceUrl,
      );
      result.linkedInstances[instanceKey(instance)] = r.count;
      result.errors.push(...r.errors);
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

  // Disable (uninstall) from all enabled instances via each adapter's component
  // surface (Pi bridge uninstall; everyone else file-copy removal).
  for (const instance of enabledInstances) {
    if (isConfigOnlyInstance(instance)) continue;
    result.linkedInstances[instanceKey(instance)] =
      await getAdapterForTool(instance.toolId).removeComponents(plugin, instance);
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

  // Every installed instance, INCLUDING Claude, swaps its installed copy via
  // the shared component file-copy engine — never the native `claude plugin
  // update` CLI. Claude was never installed through the native CLI to begin
  // with (see installPlugin), so there is nothing for it to "update in place"
  // through there.
  const managedInstances = targetInstances;

  if (managedInstances.length > 0) {
    // Download and VERIFY the replacement BEFORE uninstalling anything or purging
    // any cache. If the download fails (offline, renamed branch, GitHub outage),
    // the currently-installed items and cache must be left exactly as they were —
    // otherwise a transient network error silently deletes an installed plugin.
    let sourcePath: string | null = null;
    try {
      sourcePath = await downloadPlugin(plugin, marketplaceUrl, { force: true });
    } catch (error) {
      logError(`Failed to download plugin update for ${plugin.name}`, error);
    }

    const downloadVerified =
      !!sourcePath && pluginSourceHasExpectedComponents(plugin, sourcePath);

    if (!downloadVerified) {
      result.errors.push(
        `Failed to download plugin update for ${plugin.name}; existing installation left untouched.`,
      );
    } else {
      // Download verified — now it is safe to swap the installed copy.
      for (const instance of managedInstances) {
        uninstallPluginItemsFromInstance(plugin.name, instance);
      }

      // Purge the stale cache copy under the OLD installed marketplace (the
      // selected marketplace was already refreshed by the force download above).
      if (plugin.installedMarketplace && plugin.installedMarketplace !== plugin.marketplace) {
        try {
          const staleDir = safePath(getPluginsCacheDir(), plugin.installedMarketplace, plugin.name);
          rmSync(staleDir, { recursive: true, force: true });
        } catch (error) {
          logError(`Failed to remove stale plugin dir for ${plugin.name}`, error);
        }
      }

      for (const instance of managedInstances) {
        try {
          const { count, errors } = installPluginItemsToInstance(
            plugin.name,
            sourcePath!,
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
    }
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
  const manifest = loadMigratedManifest();
  const scope = instanceKey(instance);
  const key = scope;
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }

  for (const skill of plugin.skills) {
    if (componentConfig.disabledSkills.includes(skill)) continue;
    validateItemName("skill", skill);
    const source = safePath(join(sourcePath, "skills"), skill);
    if (!existsSync(source)) continue;

    if (instance.skillsSubdir) {
      const baseTarget = instance.pluginFlatInstall
        ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir)
        : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, plugin.name);
      const target = safePath(baseTarget, skill);
      const result = createSymlink(source, target, {
        instanceScope: scope,
        pluginName: plugin.name,
        itemKind: "skill",
        itemName: skill,
      });
      if (result.success) {
        manifest.tools[key].items[buildManifestItemKey(plugin.name, "skill", skill)] = {
          kind: "skill",
          name: skill,
          source,
          dest: instance.pluginFlatInstall
            ? join(instance.skillsSubdir, skill)
            : join(instance.skillsSubdir, plugin.name, skill),
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
      const baseTarget = instance.pluginFlatInstall
        ? resolveInstanceSubdirPath(instance.configDir, instance.commandsSubdir)
        : resolveInstanceSubdirPath(instance.configDir, instance.commandsSubdir, plugin.name);
      const target = safePath(baseTarget, `${cmd}.md`);
      const result = createSymlink(source, target, {
        instanceScope: scope,
        pluginName: plugin.name,
        itemKind: "command",
        itemName: cmd,
      });
      if (result.success) {
        manifest.tools[key].items[buildManifestItemKey(plugin.name, "command", cmd)] = {
          kind: "command",
          name: cmd,
          source,
          dest: instance.pluginFlatInstall
            ? join(instance.commandsSubdir, `${cmd}.md`)
            : join(instance.commandsSubdir, plugin.name, `${cmd}.md`),
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
      const baseTarget = instance.pluginFlatInstall
        ? resolveInstanceSubdirPath(instance.configDir, instance.agentsSubdir)
        : resolveInstanceSubdirPath(instance.configDir, instance.agentsSubdir, plugin.name);
      const target = safePath(baseTarget, `${agent}.md`);
      const result = createSymlink(source, target, {
        instanceScope: scope,
        pluginName: plugin.name,
        itemKind: "agent",
        itemName: agent,
      });
      if (result.success) {
        manifest.tools[key].items[buildManifestItemKey(plugin.name, "agent", agent)] = {
          kind: "agent",
          name: agent,
          source,
          dest: instance.pluginFlatInstall
            ? join(instance.agentsSubdir, `${agent}.md`)
            : join(instance.agentsSubdir, plugin.name, `${agent}.md`),
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
  try {
    setPluginComponentEnabled(
      plugin.marketplace,
      plugin.name,
      kind,
      componentName,
      enabled,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const instances = getEnabledToolInstances();
  const manifest = loadMigratedManifest();
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
      const subdir =
        kind === "skill"
          ? instance.skillsSubdir
          : kind === "command"
            ? instance.commandsSubdir
            : instance.agentsSubdir;
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
        logError(
          `Failed to remove ${kind} ${componentName} from ${instance.name}`,
          error,
        );
        failures.push(
          `Failed to remove ${kind} ${componentName} from ${instance.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Restore backup if exists
      if (item.backup && existsSync(item.backup)) {
        try {
          // Cache dir -> tool config dir restore; may cross filesystems.
          renameOrCopy(item.backup, destPath);
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

      const dest = instance.pluginFlatInstall
        ? resolveInstanceSubdirPath(instance.configDir, subdir, suffix)
        : resolveInstanceSubdirPath(instance.configDir, subdir, plugin.name, suffix);
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

// getInstalledPluginsForClaudeInstance and getInstalledPluginsForPiInstance now
// live in ./adapters/claude.ts and ./adapters/pi-bridge.ts. The managed manifest
// scan lives in ./adapters/managed.ts. This dispatches to whichever applies.
export function getInstalledPluginsForInstance(
  instance: ToolInstance,
): Plugin[] {
  if (!instance.enabled) return [];
  return getAdapterForTool(instance.toolId).listInstalled(instance);
}


export interface SkillInstallation {
  toolId: string;
  instanceId: string;
  instanceName: string;
  diskPath: string;
  /** Plugin namespace for namespaced installs (e.g. "ssmp"). */
  namespace?: string;
  /** True if this specific install's SKILL.md differs from the source-repo copy. */
  drifted?: boolean;
  /**
   * If true, this installation is redundant — the same skill exists at a
   * preferred path (typically `.agents/skills/<name>/`). The redundant copy
   * (typically at `.pi/agent/skills/<namespace>/<name>/`) is eligible for
   * cleanup via the skill detail UI.
   */
  redundant?: boolean;
}

/**
 * Git tracking status for a path in the source repo.
 * - clean: path is tracked and matches HEAD
 * - modified: tracked files inside have uncommitted changes (or staged)
 * - untracked: dir/file exists but is not in git's index at all (or has untracked content)
 * - unknown: source repo not a git repo, or check failed
 */
export type GitStatus = "clean" | "modified" | "untracked" | "unknown";


export interface StandaloneSkill {
  name: string;
  /** Plugin namespace for namespaced installs (e.g. "ssmp"). */
  namespace?: string;
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

  /** True if the disk copy differs (structurally) from the source-repo copy. */
  drifted?: boolean;
  /** Git tracking state of the source-repo path ("clean" / "modified" / "untracked" / "unknown"). */
  gitStatus?: GitStatus;
}

/** Aggregate of all skills under a single namespace. */
export interface NamespaceGroup {
  name: string;
  skills: StandaloneSkill[];
  /** Unique toolIds where any skill in this namespace is installed. */
  toolIds: string[];
  /** Total installations across all skills. */
  totalInstallations: number;
  /** Number of skills missing from at least one enabled tool. */
  missingCount: number;
  /** Number of skills with drifted installations. */
  driftedCount: number;
  /** Number of skills not tracked in source repo. */
  notInGitCount: number;
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
export function getStandaloneSkills(prescribedPlugins?: Plugin[]): StandaloneSkill[] {
  const { plugins: installedPlugins } = getAllInstalledPlugins();
  const allPlugins = prescribedPlugins ?? installedPlugins;
  const configuredMarketplaceNames = new Set(parseMarketplaces().map((m) => m.name));

  // Build a GLOBAL set of skill names owned by any plugin from a configured marketplace.
  // Skills from removed marketplaces (e.g. "playbook") are NOT in this set — they're standalone.
  const globalPluginOwnedSkills = new Set<string>();
  for (const p of allPlugins) {
    const isKnownPlugin = configuredMarketplaceNames.has(p.marketplace) || p.prescriptionStatus === "marketplace-removed";
    if (!isKnownPlugin) continue;
    for (const s of p.skills ?? []) {
      globalPluginOwnedSkills.add(s);
    }
  }

  // Aggregate installations per skill name across all tool instances.
  // Sort so that Codex/OpenCode (`.agents/`) skills are discovered before
  // Pi skills so they take precedence as the primary path when colliding.
  const byName = new Map<string, StandaloneSkill>();
  const instances = getToolInstances()
    .filter((i) => i.kind === "tool" && i.enabled)
    .sort((a, b) => {
      // Prefer Codex (`.agents/`) over Pi (`.pi/agent/skills/`)
      const aIsCodex = a.toolId === "openai-codex" ? 0 : 1;
      const bIsCodex = b.toolId === "openai-codex" ? 0 : 1;
      if (aIsCodex !== bIsCodex) return aIsCodex - bIsCodex;
      // Prefer non-Pi over Pi
      const aIsPi = a.toolId === "pi" ? 1 : 0;
      const bIsPi = b.toolId === "pi" ? 1 : 0;
      return aIsPi - bIsPi;
    });

  for (const instance of instances) {
    if (!instance.skillsSubdir) continue;
    const skillsDir = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir);
    if (!existsSync(skillsDir)) continue;

    try {
      if (instance.pluginFlatInstall) {
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          if (entry.name.startsWith(".")) continue;
          const skillPath = join(skillsDir, entry.name);
          if (!existsSync(join(skillPath, "SKILL.md"))) continue;
          // The disk folder name may be flattened/plugin-prefixed (see
          // flattenNamespacedName) — recover the true skill name from its
          // own frontmatter so it aggregates with the same skill's
          // installations on non-flat tools instead of fragmenting into a
          // separate entry keyed by the prefixed name.
          const skillName = readSkillFrontmatterName(skillPath);
          if (globalPluginOwnedSkills.has(skillName)) continue;

          const installation: SkillInstallation = {
            toolId: instance.toolId,
            instanceId: instance.instanceId,
            instanceName: instance.name,
            diskPath: skillPath,
          };
          const existing = byName.get(skillName);
          if (existing) {
            existing.installations.push(installation);
            if (!existing.namespace && installation.namespace) {
              existing.namespace = installation.namespace;
            }
          } else {
            byName.set(skillName, {
              name: skillName,
              installations: [installation],
              diskPath: skillPath,
              toolId: instance.toolId,
              instanceId: instance.instanceId,
              instanceName: instance.name,
              namespace: installation.namespace,
            });
          }
        }
      } else {
        // Preferred namespaced layout: skills/<namespace>/<skill>/SKILL.md
        // Compatibility: also detect legacy flat layout skills/<skill>/SKILL.md.
        for (const pluginEntry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (!pluginEntry.isDirectory() && !pluginEntry.isSymbolicLink()) continue;
          if (pluginEntry.name.startsWith(".")) continue;
          const pluginDir = join(skillsDir, pluginEntry.name);

          // Legacy flat layout entry: skills/<skill>/SKILL.md
          if (existsSync(join(pluginDir, "SKILL.md"))) {
            if (globalPluginOwnedSkills.has(pluginEntry.name)) continue;
            const installation: SkillInstallation = {
              toolId: instance.toolId,
              instanceId: instance.instanceId,
              instanceName: instance.name,
              diskPath: pluginDir,
            };
            const existing = byName.get(pluginEntry.name);
            if (existing) {
              existing.installations.push(installation);
            } else {
              byName.set(pluginEntry.name, {
                name: pluginEntry.name,
                installations: [installation],
                diskPath: pluginDir,
                toolId: instance.toolId,
                instanceId: instance.instanceId,
                instanceName: instance.name,
              });
            }
            continue;
          }

          // Namespaced layout entry: skills/<namespace>/<skill>/SKILL.md
          for (const skillEntry of readdirSync(pluginDir, { withFileTypes: true })) {
            if (!skillEntry.isDirectory() && !skillEntry.isSymbolicLink()) continue;
            if (skillEntry.name.startsWith(".")) continue;
            const skillPath = join(pluginDir, skillEntry.name);
            if (!existsSync(join(skillPath, "SKILL.md"))) continue;
            if (globalPluginOwnedSkills.has(skillEntry.name)) continue;

            const installation: SkillInstallation = {
              toolId: instance.toolId,
              instanceId: instance.instanceId,
              instanceName: instance.name,
              diskPath: skillPath,
              namespace: pluginEntry.name,
            };
            const existing = byName.get(skillEntry.name);
            if (existing) {
              existing.installations.push(installation);
              if (pluginEntry.name && !existing.namespace) {
                existing.namespace = pluginEntry.name;
              }
            } else {
              byName.set(skillEntry.name, {
                name: skillEntry.name,
                namespace: pluginEntry.name,
                installations: [installation],
                diskPath: skillPath,
                toolId: instance.toolId,
                instanceId: instance.instanceId,
                instanceName: instance.name,
              });
            }
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  // ── Conflict detection: flag redundant installations ─────────────────────
  // When the same skill exists in `.agents/skills/<name>/` AND another
  // location (`.pi/agent/skills/`, pi-packages source, etc.), flag the
  // non-`.agents/` copy as `redundant`. `.agents/` may not be a tracked tool
  // instance's skillsSubdir (Codex uses `~/.codex/`), so we check the
  // filesystem directly rather than relying on installation[] membership.
  const AGENTS_DIR = join(homedir(), ".agents", "skills");
  if (existsSync(AGENTS_DIR)) {
    // Build set of skill names that exist in .agents/ (flat or namespaced).
    const agentsSkillNames = new Set<string>();
    for (const entry of readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const p = join(AGENTS_DIR, entry.name);
      if (existsSync(join(p, "SKILL.md"))) {
        agentsSkillNames.add(entry.name);
      } else if (entry.isDirectory()) {
        for (const sub of readdirSync(p, { withFileTypes: true })) {
          if (sub.name.startsWith(".")) continue;
          if (existsSync(join(p, sub.name, "SKILL.md"))) {
            agentsSkillNames.add(sub.name);
          }
        }
      }
    }

    for (const [, skill] of byName) {
      if (!agentsSkillNames.has(skill.name)) continue;
      const redundantIdxs: number[] = [];
      for (let i = 0; i < skill.installations.length; i++) {
        const inst = skill.installations[i];
        // Check if the skill is outside .agents/ and is a non-standard location
        // that's likely duplicating the .agents/ copy. Standard tool-instance
        // paths (.claude/, .codex/, .config/, .code/) are kept; everything else
        // (.pi/agent/skills/, pi-packages source, etc.) is redundant.
        if (inst.diskPath.includes("/.agents/skills/")) continue; // keep agents
        if (inst.diskPath.includes("/.claude/")) continue; // keep claude
        if (inst.diskPath.includes("/.claude-learning/")) continue; // keep claude-learning
        if (inst.diskPath.includes("/.config/")) continue; // keep opencode/amp
        if (inst.diskPath.includes("/.codex/") || inst.diskPath.includes("/.code/")) continue; // keep codex
        if (inst.diskPath.includes("/.pi/agent/")) {
          // Pi skills dir — redundant if .agents has the same skill
          redundantIdxs.push(i);
          continue;
        }
        // Other paths (pi-packages source, local dev dirs): flag as redundant
        // since .agents/ should be authoritative.
        if (existsSync(join(inst.diskPath, "SKILL.md"))) {
          redundantIdxs.push(i);
        }
      }
      for (const idx of redundantIdxs) {
        skill.installations[idx].redundant = true;
      }
    }
  }

  // Attach source-repo paths (and drift state) where the skill exists in the source repo.
  const sourceRepo = getConfigRepoPath();
  const repoGitStatus = sourceRepo ? getRepoGitStatus(sourceRepo) : null;
  if (sourceRepo && existsSync(sourceRepo)) {
    // Index every SKILL.md under <repo>/skills/** so we can map a tool-disk skill
    // name to its source path even when the source repo groups skills in subdirs
    // (e.g. skills/gbrain/<name>/SKILL.md). Claude uses a flat layout for user
    // skills; other tools use namespaced plugin directories. The source repo can
    // use namespaced subdirs for organization.
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
      if (globalPluginOwnedSkills.has(name)) continue;
      const sourceDir = dirname(skillMd);
      // Derive namespace from source path: .../skills/<namespace>/<name>/SKILL.md
      let namespace: string | undefined;
      const relToSkills = sourceDir.slice(skillsRoot.length + 1); // e.g. "ssmp/agentic-audio-sensory-system"
      const parts = relToSkills.split("/");
      if (parts.length >= 2) {
        namespace = parts[0];
      }
      byName.set(name, {
        name,
        namespace,
        installations: [],
        diskPath: sourceDir,
        toolId: "",
        instanceId: "",
        instanceName: "",
      });
    }

    for (const skill of byName.values()) {
      // Find the skill in the source repo. Priority:
      //   1. Canonical flat: source_repo/skills/<name>/SKILL.md
      //   2. Nested in skills/: discovered via the recursive index (e.g. skills/gbrain/<name>/)
      const flat = join(sourceRepo, "skills", skill.name, "SKILL.md");
      const indexed = sourceSkillIndex.get(skill.name);
      const candidate = existsSync(flat) ? flat : indexed;
      if (candidate && existsSync(candidate)) {
        {
          const sourceDir = dirname(candidate);
          skill.sourcePath = sourceDir;
          // Derive namespace from source path if not already set from disk scan
          if (!skill.namespace) {
            const relToSkills = sourceDir.slice(skillsRoot.length + 1);
            const parts = relToSkills.split("/");
            if (parts.length >= 2) {
              skill.namespace = parts[0];
            }
          }
          // Lightweight per-install drift: compare each disk SKILL.md to the source one.
          // Deduplicate by physical path first — symlinked installs that resolve
          // to the same directory share one SKILL.md and must not be double-counted.
          try {
            const sourceSkillMd = readFileSync(candidate, "utf-8");
            const seenPaths = new Set<string>();
            for (const inst of skill.installations) {
              let realPath: string;
              try { realPath = realpathSync(inst.diskPath); } catch { realPath = inst.diskPath; }
              if (seenPaths.has(realPath)) {
                // Same physical dir as a prior install — inherit its drift state.
                const peer = skill.installations.find((i) => {
                  let rp: string;
                  try { rp = realpathSync(i.diskPath); } catch { rp = i.diskPath; }
                  return rp === realPath && i !== inst;
                });
                inst.drifted = peer?.drifted ?? false;
                continue;
              }
              seenPaths.add(realPath);
              const diskSkillMd = join(inst.diskPath, "SKILL.md");
              if (!existsSync(diskSkillMd)) { inst.drifted = true; continue; }
              inst.drifted = readFileSync(diskSkillMd, "utf-8") !== sourceSkillMd;
            }
            skill.drifted = skill.installations.some((i) => i.drifted);
          } catch { /* ignore */ }
          // Git status for the source path — is it committed?
          skill.gitStatus = gitStatusForPath(sourceRepo, sourceDir, repoGitStatus);
        }
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Group standalone skills by their namespace. Skills without a namespace are excluded. */
export function groupSkillsByNamespace(skills: StandaloneSkill[]): NamespaceGroup[] {
  const byNs = new Map<string, StandaloneSkill[]>();
  for (const skill of skills) {
    if (!skill.namespace) continue;
    const list = byNs.get(skill.namespace) ?? [];
    list.push(skill);
    byNs.set(skill.namespace, list);
  }

  const skillCapableTools = new Set(
    getToolInstances()
      .filter((i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir)
      .map((i) => i.toolId),
  );

  return Array.from(byNs.entries())
    .map(([name, nsSkills]) => {
      const allToolIds = new Set<string>();
      let totalInstallations = 0;
      let missingCount = 0;
      let driftedCount = 0;
      let notInGitCount = 0;

      for (const skill of nsSkills) {
        for (const inst of skill.installations) {
          allToolIds.add(inst.toolId);
          totalInstallations++;
        }
        const installedTools = new Set(skill.installations.map((i) => i.toolId));
        if (installedTools.size < skillCapableTools.size) missingCount++;
        if (skill.drifted) driftedCount++;
        if (!skill.sourcePath) notInGitCount++;
      }

      return {
        name,
        skills: nsSkills,
        toolIds: Array.from(allToolIds),
        totalInstallations,
        missingCount,
        driftedCount,
        notInGitCount,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
    removeSkillInstallPath(inst.diskPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one on-disk skill installation. A derived-view entry (symlink into
 * `~/.agents/skills`) is unlinked — never followed — so removing a tool's view
 * of a skill can't destroy the shared store copy other tools still read.
 */
function removeSkillInstallPath(diskPath: string): void {
  let isLink: boolean;
  try {
    isLink = lstatSync(diskPath).isSymbolicLink();
  } catch {
    return; // already gone — match rmSync's force:true semantics
  }
  if (isLink) {
    unlinkSync(diskPath);
  } else {
    rmSync(diskPath, { recursive: true, force: true });
  }
}

/** Remove every installation of the skill. Returns the number successfully removed. */
export function uninstallSkillAllInstances(skill: StandaloneSkill): number {
  let removed = 0;
  for (const inst of skill.installations) {
    try {
      removeSkillInstallPath(inst.diskPath);
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
  /** Per-target removal failures, so callers can report partial success. */
  errors: string[];
  error?: string;
} {
  let targetsRemoved = 0;
  const errors: string[] = [];
  const totalTargets = file.instances.length;
  for (const inst of file.instances) {
    try {
      if (existsSync(inst.targetPath)) {
        rmSync(inst.targetPath, { force: true });
        targetsRemoved += 1;
      }
    } catch (e) {
      errors.push(`${inst.instanceName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Source-repo file removal.
  let sourceRemoved = false;
  const sourcePath = file.instances[0]?.sourcePath;
  if (sourcePath && existsSync(sourcePath)) {
    try {
      rmSync(sourcePath, { force: true });
      sourceRemoved = true;
    } catch (e) {
      errors.push(`source (${sourcePath}): ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, targets: targetsRemoved, source: false, config: false, errors, error: errors.join("; ") };
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
    errors.push(`config: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, targets: targetsRemoved, source: sourceRemoved, config: false, errors, error: errors.join("; ") };
  }

  // A partial target-removal failure is not fatal to source/config cleanup, but
  // it must still be surfaced so the caller can report "removed N of M".
  const ok = errors.length === 0;
  return {
    ok,
    targets: targetsRemoved,
    source: sourceRemoved,
    config: configRemoved,
    errors,
    ...(ok ? {} : { error: `deleted from ${targetsRemoved} of ${totalTargets} locations; ${errors.length} failed: ${errors.join("; ")}` }),
  };
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
      removeFromClaudeInstalledPluginsJson(instance, plugin.name, plugin.installedMarketplace ?? plugin.marketplace);
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

/** Remove a skill from all local tool installs only — source repo is untouched. */
export function removeSkillLocalInstalls(skill: StandaloneSkill): { ok: boolean; tools: number; error?: string } {
  let toolsRemoved = 0;
  for (const inst of skill.installations) {
    try {
      rmSync(inst.diskPath, { recursive: true, force: true });
      toolsRemoved += 1;
    } catch { /* skip */ }
  }
  return { ok: true, tools: toolsRemoved };
}

/** Delete a skill from the source repo only — local tool installs are untouched. */
export function deleteSkillSourceOnly(skill: StandaloneSkill): { ok: boolean; error?: string } {
  if (!skill.sourcePath || !existsSync(skill.sourcePath)) {
    return { ok: false, error: "No source path found for this skill" };
  }
  try {
    rmSync(skill.sourcePath, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Result of a source-repo commit+push. The local commit and filesystem changes
 * are non-fatal on failure, but a failed push must NOT be hidden: it leaves a
 * local-only commit the user needs to know about (and, until it is pushed, work
 * that only exists on this machine).
 */
export interface CommitAndPushResult {
  committed: boolean;
  pushed: boolean;
  /** Set when the commit succeeded locally but the push failed. */
  pushError?: string;
}

/**
 * Stage, commit, and push changes in the source repo.
 *
 * The commit is scoped to exactly `paths` (via a pathspec) so we never sweep in
 * unrelated modifications the user has in the repo. A failed commit (e.g. nothing
 * to commit) is treated as non-fatal, but a failed push is reported back so the
 * caller can surface "committed locally but push failed" rather than claiming
 * full success.
 */
export function commitAndPushSourceRepo(sourceRepo: string, paths: string[], message: string): CommitAndPushResult {
  if (!existsSync(join(sourceRepo, ".git"))) return { committed: false, pushed: false };
  try {
    for (const p of paths) {
      execFileSync("git", ["-C", sourceRepo, "add", p], { encoding: "utf-8", timeout: 10000 });
    }
    execFileSync("git", ["-C", sourceRepo, "commit", "-m", message, "--", ...paths], { encoding: "utf-8", timeout: 10000 });
  } catch {
    // Commit failed (e.g. nothing staged) — filesystem changes already succeeded,
    // and there is nothing to push. Non-fatal.
    return { committed: false, pushed: false };
  }
  try {
    execFileSync("git", ["-C", sourceRepo, "push"], { encoding: "utf-8", timeout: 30000 });
  } catch (e) {
    // Do NOT swallow: the commit exists locally but never reached origin.
    return { committed: true, pushed: false, pushError: e instanceof Error ? e.message : String(e) };
  }
  return { committed: true, pushed: true };
}

/**
 * Remove a file from the source repo only — leave tool targets untouched.
 * Removes the source file and the config.yaml entry from both local and
 * source-repo configs so the file won't reappear on next pull.
 */
export function removeFileFromGit(file: FileStatus): {
  ok: boolean;
  source: boolean;
  config: boolean;
  error?: string;
  /** Set when the removal was committed locally but the push to origin failed. */
  pushError?: string;
} {
  let sourceRemoved = false;
  const sourcePath = file.instances[0]?.sourcePath;
  if (sourcePath && existsSync(sourcePath)) {
    try {
      rmSync(sourcePath, { force: true });
      sourceRemoved = true;
    } catch (e) {
      return { ok: false, source: false, config: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let configRemoved = false;
  try {
    const { config, configPath } = loadYamlConfig();
    const before = config.files.length;
    config.files = config.files.filter((f) => f.name !== file.name);
    if (config.files.length < before) {
      saveYamlConfig(config, configPath);
      configRemoved = true;
    }
    // Also remove from source repo config to prevent reappearing on next pull.
    const sourceRepo = getConfigRepoPath();
    if (sourceRepo) {
      const srcCfgPath = join(expandPath(sourceRepo), "config", "blackbook", "config.yaml");
      if (existsSync(srcCfgPath) && srcCfgPath !== configPath) {
        try {
          const srcResult = loadYamlConfig(srcCfgPath);
          const srcBefore = srcResult.config.files.length;
          srcResult.config.files = srcResult.config.files.filter((f) => f.name !== file.name);
          if (srcResult.config.files.length < srcBefore) {
            saveYamlConfig(srcResult.config, srcCfgPath);
          }
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    return { ok: false, source: sourceRemoved, config: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Auto-commit and push so the user never needs to touch git.
  let pushError: string | undefined;
  const sourceRepo = getConfigRepoPath();
  if (sourceRepo) {
    const commitPaths: string[] = [];
    if (sourceRemoved && sourcePath) commitPaths.push(sourcePath);
    // Stage the config file regardless — even if the entry wasn't found locally,
    // the source-repo config edit may have changed it.
    const srcCfgPath2 = join(expandPath(sourceRepo), "config", "blackbook", "config.yaml");
    if (existsSync(srcCfgPath2)) commitPaths.push(srcCfgPath2);
    if (commitPaths.length > 0) {
      const gitResult = commitAndPushSourceRepo(sourceRepo, commitPaths, `remove: ${file.name} from git`);
      pushError = gitResult.pushError;
    }
  }

  return { ok: true, source: sourceRemoved, config: configRemoved, pushError };
}

/**
 * Remove a skill from the source repo only — leave tool installs untouched.
 * Auto-commits and pushes the deletion.
 */
export function removeSkillFromGit(skill: StandaloneSkill): {
  ok: boolean;
  source: boolean;
  error?: string;
  /** Set when the removal was committed locally but the push to origin failed. */
  pushError?: string;
} {
  if (!skill.sourcePath || !existsSync(skill.sourcePath)) return { ok: true, source: false };
  try {
    rmSync(skill.sourcePath, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, source: false, error: e instanceof Error ? e.message : String(e) };
  }
  let pushError: string | undefined;
  const sourceRepo = getConfigRepoPath();
  if (sourceRepo) {
    const gitResult = commitAndPushSourceRepo(sourceRepo, [skill.sourcePath], `remove: ${skill.name} from git`);
    pushError = gitResult.pushError;
  }
  return { ok: true, source: true, pushError };
}

/**
 * Remove all tracked skills in a namespace from the source repo only.
 * Auto-commits and pushes all deletions in one commit.
 */
export function removeNamespaceFromGit(group: NamespaceGroup): {
  removed: number;
  errors: string[];
} {
  let removed = 0;
  const errors: string[] = [];
  const removedPaths: string[] = [];

  for (const skill of group.skills) {
    if (!skill.sourcePath || !existsSync(skill.sourcePath)) continue;
    try {
      rmSync(skill.sourcePath, { recursive: true, force: true });
      removedPaths.push(skill.sourcePath);
      removed++;
    } catch (e) {
      errors.push(`${skill.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (removedPaths.length > 0) {
    const sourceRepo = getConfigRepoPath();
    if (sourceRepo) {
      const gitResult = commitAndPushSourceRepo(sourceRepo, removedPaths, `remove: ${group.name} namespace from git`);
      if (gitResult.pushError) {
        errors.push(`committed locally but push failed: ${gitResult.pushError}`);
      }
    }
  }

  return { removed, errors };
}

/** Pull the skill from a specific disk installation back to the source repo. */
export function pullbackSkillToSource(
  skill: StandaloneSkill,
  fromToolId: string,
  fromInstanceId: string,
): boolean {
  const inst = skill.installations.find(
    (i) => i.toolId === fromToolId && i.instanceId === fromInstanceId,
  );
  if (!inst) {
    // eslint-disable-next-line no-console
    console.error(`pullbackSkillToSource: skill ${skill.name} not installed in ${fromToolId}:${fromInstanceId}`);
    return false;
  }

  const sourceRepo = getConfigRepoPath();
  let targetPath = skill.sourcePath;
  if (!targetPath) {
    // No source-repo path yet — create the skill in the configured source repo
    // under skills/<name>/ (canonical layout). Use namespace subdir when known.
    if (!sourceRepo) {
      // eslint-disable-next-line no-console
      console.error(`pullbackSkillToSource: no source repo configured for ${skill.name}`);
      return false;
    }
    targetPath = skill.namespace
      ? join(sourceRepo, "skills", skill.namespace, skill.name)
      : join(sourceRepo, "skills", skill.name);
  }

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    // Back up the source-repo skill before removing it. Git recovers committed
    // content, but uncommitted local edits would otherwise be lost outright.
    if (existsSync(targetPath)) {
      createBackup(targetPath, `skill-source:${skill.name}`);
      pruneBackups(`skill-source:${skill.name}`);
    }
    rmSync(targetPath, { recursive: true, force: true });
    cpSync(inst.diskPath, targetPath, { recursive: true, dereference: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`pullbackSkillToSource: copy failed for ${skill.name} from ${inst.diskPath} to ${targetPath}:`, err);
    return false;
  }

  // Auto-commit and push so the user never needs to touch git.
  if (sourceRepo && existsSync(join(sourceRepo, ".git"))) {
    try {
      execFileSync("git", ["-C", sourceRepo, "add", targetPath], { encoding: "utf-8", timeout: 10000 });
      const verb = skill.sourcePath ? "update" : "track";
      execFileSync("git", ["-C", sourceRepo, "commit", "-m", `${verb}: ${skill.name}`], {
        encoding: "utf-8",
        timeout: 10000,
      });
      execFileSync("git", ["-C", sourceRepo, "push"], {
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch {
      // Copy succeeded even if commit/push fails.
    }
  }

  return true;
}

function getStandaloneSkillTargetDir(
  skill: Pick<StandaloneSkill, "name" | "namespace">,
  target: ToolInstance,
): string {
  if (!target.skillsSubdir) return "";
  // Claude/user-flat tools keep standalone skills flat — prefix with the
  // namespace (when known) to avoid two differently-namespaced skills of the
  // same bare name colliding on disk.
  if (target.pluginFlatInstall) {
    return resolveInstanceSubdirPath(
      target.configDir,
      target.skillsSubdir,
      flattenNamespacedName(skill.namespace, skill.name),
    );
  }
  // Non-flat tools prefer namespaced layout when namespace is known.
  if (skill.namespace) {
    return resolveInstanceSubdirPath(target.configDir, target.skillsSubdir, skill.namespace, skill.name);
  }
  // Backward-compat fallback for skills without a known namespace.
  return resolveInstanceSubdirPath(target.configDir, target.skillsSubdir, skill.name);
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
  const targetDir = getStandaloneSkillTargetDir(skill, target);
  if (!targetDir) return false;

  // Flat tools (Claude) get a derived view of the shared ~/.agents/skills
  // store: materialize the skill there if needed, then link the tool's flat
  // entry at that store path — never at the source repo or another tool's
  // copy. Applies regardless of skill_sync_mode.
  if (target.pluginFlatInstall) {
    try {
      const agentsTarget = agentsSkillsDir(skill.namespace, skill.name);
      if (!existsSync(agentsTarget)) {
        // Clear a dangling symlink so cpSync can't trip over it.
        if (isSymlink(agentsTarget)) unlinkSync(agentsTarget);
        mkdirSync(dirname(agentsTarget), { recursive: true });
        cpSync(sourcePath, agentsTarget, { recursive: true });
      }
      if (checkSymlinkSync({ sourcePath: agentsTarget, targetPath: targetDir }).status === "ok") {
        return true;
      }
      // Replace whatever sits at the flat entry with the derived-view link,
      // backing up real content first (a symlink carries none of its own).
      if (existsSync(targetDir) || isSymlink(targetDir)) {
        if (lstatSync(targetDir).isSymbolicLink()) {
          unlinkSync(targetDir);
        } else {
          createBackup(targetDir, `skill:${skill.name}`);
          pruneBackups(`skill:${skill.name}`);
          rmSync(targetDir, { recursive: true, force: true });
        }
      }
      mkdirSync(dirname(targetDir), { recursive: true });
      // Relative link: survives home-dir moves/renames (portability).
      symlinkSync(relative(dirname(targetDir), agentsTarget), targetDir);
      return true;
    } catch {
      return false;
    }
  }

  // Opt-in: symlink the whole skill directory instead of copying it. A
  // symlinked skill can't drift (the target IS the source) and needs no
  // resync. applySymlinkSync backs up any existing real content first, same
  // as the copy path below.
  if (getSkillSyncMode() === "symlink") {
    const result = applySymlinkSync({ sourcePath, targetPath: targetDir, owner: `skill:${skill.name}` });
    return !result.error;
  }

  try {
    // Back up any existing install before overwriting — this runs on the drifted
    // branch (overwrite disk with source), so the target may hold user edits.
    // Mirrors directory-sync/file-copy, which always back up first.
    if (existsSync(targetDir)) {
      createBackup(targetDir, `skill:${skill.name}`);
      pruneBackups(`skill:${skill.name}`);
    }
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourcePath, targetDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a skill to every enabled, skill-capable tool instance that doesn't
 * already have it. Returns counts of what happened.
 */
export function installSkillToAllMissing(skill: StandaloneSkill): { installed: number; skipped: number; failed: number } {
  const installedKeys = new Set(
    skill.installations.map((i) => `${i.toolId}:${i.instanceId}`),
  );
  const targets = getToolInstances().filter(
    (i) =>
      i.kind === "tool" &&
      i.enabled &&
      !!i.skillsSubdir &&
      !installedKeys.has(`${i.toolId}:${i.instanceId}`),
  );
  let installed = 0; let failed = 0;
  for (const t of targets) {
    if (installSkillToInstance(skill, t.toolId, t.instanceId)) installed += 1;
    else failed += 1;
  }
  return { installed, skipped: installedKeys.size, failed };
}

/**
 * Sync a skill from source to every enabled, skill-capable tool instance.
 * Covers both directions of "not in sync":
 *   - missing installations (file absent on tool disk)
 *   - drifted installations (file present but content differs from source)
 * Skips installs that are already synced. Returns counts.
 */
export function installSkillToAllNonSynced(skill: StandaloneSkill): { installed: number; resynced: number; skipped: number; failed: number } {
  const installedByKey = new Map(
    skill.installations.map((i) => [`${i.toolId}:${i.instanceId}`, i]),
  );
  const targets = getToolInstances().filter(
    (i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir,
  );
  let installed = 0; let resynced = 0; let skipped = 0; let failed = 0;
  for (const t of targets) {
    const key = `${t.toolId}:${t.instanceId}`;
    const existing = installedByKey.get(key);
    if (!existing) {
      // Missing — install fresh from source.
      if (installSkillToInstance(skill, t.toolId, t.instanceId)) installed += 1;
      else failed += 1;
      continue;
    }
    if (existing.drifted) {
      // Drifted — overwrite disk with source.
      if (installSkillToInstance(skill, t.toolId, t.instanceId)) resynced += 1;
      else failed += 1;
      continue;
    }
    skipped += 1;
  }
  return { installed, resynced, skipped, failed };
}

/**
 * Migrate legacy flat standalone skill installs on non-flat tools:
 *   skills/<skill>/SKILL.md -> skills/<namespace>/<skill>/SKILL.md
 * Namespace is derived from source-repo layout: skills/<namespace>/<skill>/SKILL.md.
 */
export function migrateLegacyStandaloneSkillLayout(): { moved: number; skipped: number; errors: string[] } {
  const sourceRepo = getConfigRepoPath();
  if (!sourceRepo || !existsSync(sourceRepo)) {
    return { moved: 0, skipped: 0, errors: [] };
  }

  const skillsRoot = join(sourceRepo, "skills");
  if (!existsSync(skillsRoot)) {
    return { moved: 0, skipped: 0, errors: [] };
  }

  const namespaceBySkill = new Map<string, string>();
  try {
    for (const nsEntry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!nsEntry.isDirectory() || nsEntry.name.startsWith(".")) continue;
      const nsDir = join(skillsRoot, nsEntry.name);
      for (const skillEntry of readdirSync(nsDir, { withFileTypes: true })) {
        if (!skillEntry.isDirectory() || skillEntry.name.startsWith(".")) continue;
        const skillDir = join(nsDir, skillEntry.name);
        if (!existsSync(join(skillDir, "SKILL.md"))) continue;
        // First match wins if duplicates exist.
        if (!namespaceBySkill.has(skillEntry.name)) {
          namespaceBySkill.set(skillEntry.name, nsEntry.name);
        }
      }
    }
  } catch {
    return { moved: 0, skipped: 0, errors: [] };
  }

  let moved = 0;
  let skipped = 0;
  const errors: string[] = [];

  const targets = getToolInstances().filter(
    (i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir && !i.pluginFlatInstall,
  );

  for (const target of targets) {
    const skillsDir = resolveInstanceSubdirPath(target.configDir, target.skillsSubdir!);
    if (!existsSync(skillsDir)) continue;

    for (const [skillName, namespace] of namespaceBySkill.entries()) {
      const flatDir = join(skillsDir, skillName);
      const nsDir = join(skillsDir, namespace, skillName);

      if (!existsSync(flatDir) || !existsSync(join(flatDir, "SKILL.md"))) continue;
      if (existsSync(nsDir)) {
        skipped += 1;
        continue;
      }

      try {
        mkdirSync(dirname(nsDir), { recursive: true });
        renameSync(flatDir, nsDir);
        moved += 1;
      } catch (e) {
        errors.push(`${target.toolId}:${target.instanceId}:${skillName} -> ${namespace}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { moved, skipped, errors };
}

// ── Namespace bulk operations ─────────────────────────────────────────────

/** Sync all skills in a namespace that are missing from at least one enabled tool. */
export function syncNamespaceToAllMissing(group: NamespaceGroup): { installed: number; failed: number } {
  let installed = 0; let failed = 0;
  for (const skill of group.skills) {
    const result = installSkillToAllMissing(skill);
    installed += result.installed;
    failed += result.failed;
  }
  return { installed, failed };
}

/** Re-sync all drifted skills in a namespace across all tools. */
export function resyncNamespaceDrifted(group: NamespaceGroup): { resynced: number; failed: number } {
  let resynced = 0; let failed = 0;
  for (const skill of group.skills) {
    if (!skill.drifted) continue;
    const result = installSkillToAllNonSynced(skill);
    resynced += result.resynced;
    failed += result.failed;
  }
  return { resynced, failed };
}

/** Delete every skill in a namespace from all tool disks and source repo. */
export function deleteNamespaceEverywhere(group: NamespaceGroup): { deleted: number; errors: string[] } {
  const errors: string[] = [];
  let deleted = 0;
  for (const skill of group.skills) {
    const result = deleteSkillEverywhere(skill);
    if (result.ok) deleted += 1;
    if (result.error) errors.push(result.error);
  }
  return { deleted, errors };
}

/** Remove all skills in a namespace from local tool installs only — source repo untouched. */
export function removeNamespaceLocalInstalls(group: NamespaceGroup): { removed: number; errors: string[] } {
  const errors: string[] = [];
  let removed = 0;
  for (const skill of group.skills) {
    const result = removeSkillLocalInstalls(skill);
    if (result.ok) removed += 1;
    if (result.error) errors.push(result.error);
  }
  return { removed, errors };
}

/** Delete all skills in a namespace from the source repo only — local installs untouched. */
export function deleteNamespaceSourceOnly(group: NamespaceGroup): { deleted: number; errors: string[] } {
  const errors: string[] = [];
  let deleted = 0;
  for (const skill of group.skills) {
    const result = deleteSkillSourceOnly(skill);
    if (result.ok) deleted += 1;
    if (result.error) errors.push(result.error);
  }
  return { deleted, errors };
}

/** Uninstall every skill in a namespace from all tools (does NOT delete source). */
export function uninstallNamespaceAll(group: NamespaceGroup): { uninstalled: number; errors: string[] } {
  const errors: string[] = [];
  let uninstalled = 0;
  for (const skill of group.skills) {
    try {
      uninstallSkillAllInstances(skill);
      uninstalled += 1;
    } catch (e) {
      errors.push(`${skill.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { uninstalled, errors };
}

/** Uninstall every skill in a namespace from a single tool instance. */
export function uninstallNamespaceFromInstance(group: NamespaceGroup, toolId: string, instanceId: string): { uninstalled: number; errors: string[] } {
  const errors: string[] = [];
  let uninstalled = 0;
  for (const skill of group.skills) {
    try {
      uninstallSkillFromInstance(skill, toolId, instanceId);
      uninstalled += 1;
    } catch (e) {
      errors.push(`${skill.name} from ${toolId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { uninstalled, errors };
}

/** Pull back every skill in a namespace from a single tool instance to source. */
export function pullbackNamespaceToSource(group: NamespaceGroup, toolId: string, instanceId: string): { pulled: number; errors: string[] } {
  const errors: string[] = [];
  let pulled = 0;
  for (const skill of group.skills) {
    try {
      pullbackSkillToSource(skill, toolId, instanceId);
      pulled += 1;
    } catch (e) {
      errors.push(`${skill.name} from ${toolId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { pulled, errors };
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
    // Sync (install) to all missing instances via each adapter's component
    // surface (Pi bridge install; everyone else file-copy).
    for (const instance of missingInstances) {
      try {
        const adapter = getAdapterForTool(instance.toolId);
        let { count, errors } = await adapter.installComponents(
          plugin,
          instance,
          sourcePath,
          marketplaceUrl,
        );

        // Fallback for standalone component source paths discovered from installed
        // directories (no package root with skills/commands/agents subdirs).
        if (count === 0 && errors.length === 0) {
          if (!stagedStandaloneRoot) {
            stagedStandaloneRoot = buildStandalonePluginRoot(plugin, sourcePath);
          }
          if (stagedStandaloneRoot) {
            const fallback = await adapter.installComponents(
              plugin,
              instance,
              stagedStandaloneRoot,
              marketplaceUrl,
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
  buildManifestItemKey,
  buildBackupPath,
  migrateManifestKeys,
} from "./plugin-helpers.js";
