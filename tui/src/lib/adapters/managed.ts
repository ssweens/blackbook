/**
 * Managed (file-copy / symlink) adapter — the generic tool family used by
 * OpenCode and Amp, and the shared file-copy engine that Codex composes on top
 * of. Install materializes a plugin's skills/commands/agents into the tool's
 * config dir with backups; uninstall reverses it and restores backups.
 *
 * OpenCode/Amp are currently gated OFF from being "supported" by a deliberate
 * product decision; that gating lives in `supports()` here.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  unlinkSync,
  rmSync,
  renameSync,
  realpathSync,
  copyFileSync,
  cpSync,
  symlinkSync,
} from "fs";
import { basename, join, dirname, relative } from "path";
import { agentsSkillsDir, flattenNamespacedName, resolveInstanceSubdirPath } from "../path-utils.js";
import type { Plugin, InstalledItem, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import { loadManifest, saveManifest } from "../manifest.js";
import {
  getPluginsCacheDir,
  instanceKey,
  buildBackupPath,
  buildManifestItemKey,
  migrateManifestKeys,
  createSymlink,
  isSymlink,
} from "../plugin-helpers.js";
import { renameOrCopy } from "../fs-utils.js";
import {
  safePath,
  validateItemName,
  validatePluginName,
  logError,
} from "../validation.js";
import { getPluginComponentConfig, getSkillSyncMode } from "../config.js";
import type {
  ToolAdapter,
  PerInstanceResult,
  SupportInput,
  InstalledContext,
} from "./types.js";

function loadMigratedManifest(): Manifest {
  const manifest = loadManifest();
  migrateManifestKeys(manifest);
  return manifest;
}

/**
 * Find another instance's manifest entry for this plugin item that already
 * points at `dest`. Several playbooks (Codex/OpenCode/Amp/Pi's `skills`
 * component) share one physical `~/.agents/skills` location, so installing
 * the same plugin to a second sharer sees the first sharer's just-written
 * file as "pre-existing" — backing it up would create a self-referential
 * backup that uninstall later "restores", resurrecting content that was
 * meant to be deleted. Detecting the sibling install lets the caller skip
 * that spurious backup instead.
 */
function findSiblingInstall(
  manifest: Manifest,
  dest: string,
  pluginName: string,
): InstalledItem | null {
  for (const toolManifest of Object.values(manifest.tools)) {
    for (const item of Object.values(toolManifest.items)) {
      if (item.dest === dest && (item.owner || "") === pluginName) return item;
    }
  }
  return null;
}

/**
 * Whether commands should install flat + plugin-prefixed (see
 * flattenNamespacedName) rather than namespaced under a `<plugin>/` subdir.
 * `pluginFlatInstall` covers fully-flat tools (Claude); Pi is a special
 * case — its skills stay namespaced (its skill loader is recursive-safe,
 * confirmed from source), but its prompt loader only reads flat *.md files
 * directly under prompts/ (also confirmed from source, non-recursive), so
 * commands need flattening there even though skills don't.
 */
function usesFlatCommands(instance: ToolInstance): boolean {
  return instance.pluginFlatInstall || instance.toolId === "pi";
}

// Amp reads a skill-bundled `mcp.json` colocated with the skill directory
// natively; OpenCode supports the identical convention via a common
// (non-core) plugin. Neither reads a plugin-root mcp.json directly, so a
// plugin's MCP servers need copying alongside each skill it installs.
const SKILL_BUNDLED_MCP_TOOL_IDS = new Set(["amp-code", "opencode"]);

/**
 * Copy a plugin's root `mcp.json`/`.mcp.json` (if it has one) into a
 * just-installed skill's own directory, for tools that read MCP servers
 * bundled with the skill rather than from a shared file (see
 * SKILL_BUNDLED_MCP_TOOL_IDS). A plugin with multiple skills gets the same
 * file copied into each of them — redundant if more than one is installed,
 * but harmless (both readers dedupe by server name).
 *
 * No manifest tracking needed: this rides along with the skill's own
 * InstalledItem — uninstalling the skill removes its directory, mcp.json
 * included, for free.
 */
function copyPluginMcpJsonIntoSkill(instance: ToolInstance, sourcePath: string, skillDest: string): void {
  if (!SKILL_BUNDLED_MCP_TOOL_IDS.has(instance.toolId)) return;
  for (const relPath of ["mcp.json", ".mcp.json"]) {
    const src = join(sourcePath, relPath);
    if (existsSync(src)) {
      try {
        copyFileSync(src, join(skillDest, "mcp.json"));
      } catch (error) {
        logError(`Failed to copy ${relPath} into ${skillDest}`, error);
      }
      return;
    }
  }
}

/**
 * Extract marketplace and plugin name from a source path.
 * Handles multiple cache formats:
 * - Blackbook cache: ~/.cache/blackbook/plugins/{marketplace}/{plugin}/...
 * - Claude cache: ~/.claude/plugins/cache/{marketplace}/{plugin}/...
 * - Claude cache with hash: ~/.claude/plugins/cache/{marketplace}/{plugin}/{hash}/...
 * Returns null if the path doesn't match any expected pattern.
 */
export function extractPluginInfoFromSource(
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

/**
 * Move any pre-existing dest (real file/dir or symlink) into the per-item
 * backup slot. Returns the backup path, or null when dest was absent. Shared
 * by the copy, symlink, and derived-view install paths so every one of them
 * preserves user content identically.
 */
function backupExistingDest(
  dest: string,
  instanceScope: string,
  pluginName: string,
  itemKind: string,
  itemName: string,
): string | null {
  if (!existsSync(dest) && !isSymlink(dest)) return null;
  const backupPath = buildBackupPath(instanceScope, pluginName, itemKind, itemName);
  const tempBackup = `${backupPath}.new.${Date.now()}`;
  // dest lives in the tool's config dir; tempBackup under the cache dir — a
  // cross-device move on setups where those trees are separate mounts.
  renameOrCopy(dest, tempBackup);
  if (existsSync(backupPath) || isSymlink(backupPath)) {
    rmSync(backupPath, { recursive: true, force: true });
  }
  renameSync(tempBackup, backupPath);
  return backupPath;
}

/**
 * Ensure a plugin skill exists in the shared `~/.agents/skills/<ns>/<name>`
 * store, materializing it from the plugin cache copy when no sibling `.agents`
 * tool (Codex/OpenCode/Amp/Pi) has installed it yet — instance ordering within
 * an install run isn't guaranteed, and the user may only have Claude enabled.
 * Returns the store path plus whether this call created it (so a failed
 * install can roll the materialization back).
 */
export function ensureAgentsSkillMaterialized(
  src: string,
  namespace: string,
  skillName: string,
): { agentsPath: string; materialized: boolean } {
  const agentsPath = agentsSkillsDir(namespace, skillName);
  if (existsSync(agentsPath)) return { agentsPath, materialized: false };
  // A dangling symlink passes lstat but fails existsSync — clear it so cpSync
  // can't write through or trip over it.
  if (isSymlink(agentsPath)) unlinkSync(agentsPath);
  mkdirSync(dirname(agentsPath), { recursive: true });
  cpSync(src, agentsPath, { recursive: true });
  return { agentsPath, materialized: true };
}

function copyWithBackup(
  src: string,
  dest: string,
  instanceScope: string,
  pluginName: string,
  itemKind: string,
  itemName: string,
): { dest: string; backup: string | null } {
  const backupPath = backupExistingDest(dest, instanceScope, pluginName, itemKind, itemName);

  mkdirSync(dirname(dest), { recursive: true });

  // Opt-in: symlink instead of copy. The backup step above already moved any
  // existing dest out of the way (a rename, not a copy), so dest is guaranteed
  // absent here — a plain symlinkSync is all that's needed, for a directory
  // (skill) or a single file (command/agent) alike; unlike cpSync/copyFileSync,
  // symlinkSync doesn't care which. A symlinked item can't drift and never
  // needs a resync.
  if (getSkillSyncMode() === "symlink") {
    symlinkSync(src, dest);
    return { dest, backup: backupPath };
  }

  const srcStat = lstatSync(src);
  if (srcStat.isDirectory()) {
    cpSync(src, dest, { recursive: true });
  } else {
    copyFileSync(src, dest);
  }

  return { dest, backup: backupPath };
}

/**
 * Materialize a plugin's skills/commands/agents into a single tool instance,
 * backing up any pre-existing user files and persisting the manifest after each
 * item so a crash can never strand a backup. Rolls back on error.
 */
export function installPluginItemsToInstance(
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

  const manifest = loadMigratedManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }
  const toolManifest = manifest.tools[key];

  // `.agents` store copies THIS run materialized (vs found already present).
  // Rollback removes only these — a store entry that predates this install
  // belongs to a sibling tool and must survive our failure.
  const materializedAgentsPaths: string[] = [];

  const rollback = () => {
    for (const materialized of materializedAgentsPaths.reverse()) {
      try {
        rmSync(materialized, { recursive: true, force: true });
      } catch (error) {
        logError(`Failed to rollback materialized skill ${materialized}`, error);
      }
    }
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
          // Restoring from cache dir back into the tool's config dir — may cross
          // filesystems.
          renameOrCopy(item.backup, item.dest);
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
    /**
     * When set (flat-install skills only), dest becomes a symlink into the
     * shared `~/.agents/skills` store at this path — the "derived view" —
     * instead of an independent copy of the plugin cache.
     */
    agentsStoreTarget?: string,
  ) => {
    validateItemName(kind, name);
    const key = buildManifestItemKey(pluginName, kind, name);
    const previous = toolManifest.items[key] || null;
    const sibling = findSiblingInstall(manifest, dest, pluginName);
    let item: InstalledItem;
    if (sibling) {
      item = { kind, name, source: src, dest, backup: null, owner: pluginName, previous, sharedInstall: true };
    } else if (agentsStoreTarget) {
      const { materialized } = ensureAgentsSkillMaterialized(src, pluginName, name);
      if (materialized) materializedAgentsPaths.push(agentsStoreTarget);
      const backup = backupExistingDest(dest, instanceKey(instance), pluginName, kind, name);
      mkdirSync(dirname(dest), { recursive: true });
      // Relative link: survives home-dir moves/renames (portability).
      symlinkSync(relative(dirname(dest), agentsStoreTarget), dest);
      item = { kind, name, source: src, dest, backup, owner: pluginName, previous };
    } else {
      const result = copyWithBackup(src, dest, instanceKey(instance), pluginName, kind, name);
      item = { kind, name, source: src, dest: result.dest, backup: result.backup, owner: pluginName, previous };
    }
    toolManifest.items[key] = item;
    items.push(item);
    appliedKeys.push(key);
    // Persist immediately: copyWithBackup has already moved the user's original
    // file into the backup cache and copied plugin content into place. If we
    // deferred the manifest write to the end of the loop, a crash here would
    // strand that backup with no manifest record — uninstall could never find
    // it to restore. saveManifest is a small atomic local JSON write, cheap
    // enough to call per item.
    saveManifest(manifest);
  };

  try {
    if (instance.skillsSubdir) {
      const skillsDir = join(sourcePath, "skills");
      if (existsSync(skillsDir)) {
        for (const entry of readdirSync(skillsDir)) {
          const src = safePath(skillsDir, entry);
          if (existsSync(join(src, "SKILL.md"))) {
            if (componentConfig?.disabledSkills.includes(entry)) continue;
            const baseDest = instance.pluginFlatInstall
              ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir)
              : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, pluginName);
            const destName = instance.pluginFlatInstall ? flattenNamespacedName(pluginName, entry) : entry;
            const dest = safePath(baseDest, destName);
            // Flat tools (Claude) get a derived view: their skill entry is a
            // symlink into the shared ~/.agents/skills store rather than a
            // copy, so all tools serve one physical skill.
            const agentsStoreTarget = instance.pluginFlatInstall
              ? agentsSkillsDir(pluginName, entry)
              : undefined;
            installItem("skill", entry, src, dest, agentsStoreTarget);
            copyPluginMcpJsonIntoSkill(instance, sourcePath, dest);
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
            const flatCommands = usesFlatCommands(instance);
            const baseDest = flatCommands
              ? resolveInstanceSubdirPath(instance.configDir, instance.commandsSubdir)
              : resolveInstanceSubdirPath(instance.configDir, instance.commandsSubdir, pluginName);
            const destName = flatCommands ? `${flattenNamespacedName(pluginName, name)}.md` : entry;
            const dest = safePath(baseDest, destName);
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
            const baseDest = instance.pluginFlatInstall
              ? resolveInstanceSubdirPath(instance.configDir, instance.agentsSubdir)
              : resolveInstanceSubdirPath(instance.configDir, instance.agentsSubdir, pluginName);
            const destName = instance.pluginFlatInstall ? `${flattenNamespacedName(pluginName, name)}.md` : entry;
            const dest = safePath(baseDest, destName);
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
    // Persist the rolled-back state: earlier items were already saved to disk
    // per-item above, and rollback has reverted them in memory + restored the
    // files, so the on-disk manifest must reflect the reverted state too.
    saveManifest(manifest);
    return { count: 0, items: [], errors };
  }

  // Manifest is already persisted per-item inside installItem; this final save
  // is a no-op safety net for the success path.
  if (items.length > 0) {
    saveManifest(manifest);
  }

  return { count: items.length, items, errors };
}

/** Remove a plugin's items from a single instance, restoring any backups. */
export function uninstallPluginItemsFromInstance(
  pluginName: string,
  instance: ToolInstance,
): number {
  validatePluginName(pluginName);
  let manifest: Manifest;
  try {
    manifest = loadMigratedManifest();
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
  // Namespaced installs live at <skillsRoot>/<namespace>/<skill>; removing the
  // last skill leaves an empty <namespace> shell. Collect the parents of every
  // removed dest and prune the ones that end up empty (below).
  const parentDirs = new Set<string>();
  // The tool's own component roots — never prune these even if they go empty.
  const rootDirs = new Set<string>();
  for (const subdir of [instance.skillsSubdir, instance.commandsSubdir, instance.agentsSubdir]) {
    if (subdir) rootDirs.add(resolveInstanceSubdirPath(instance.configDir, subdir));
  }

  for (const [entryKey, item] of Object.entries(toolManifest.items)) {
    const owner = item.owner || "";
    if (owner === pluginName || (!owner && item.source.includes(pluginName))) {
      const dest = item.dest;
      const backup = item.backup;

      // A shared-install entry (see InstalledItem.sharedInstall) never made
      // its own backup — the instance that owns dest's real backup/absence
      // is responsible for its filesystem lifecycle. Touching it here would
      // race with that owner's own uninstall: deleting content it just
      // restored, or restoring content it correctly deleted.
      if (item.sharedInstall) {
        if (item.previous) {
          toolManifest.items[entryKey] = item.previous;
        } else {
          keysToRemove.push(entryKey);
        }
        continue;
      }

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
            // Cache dir -> tool config dir restore; may cross filesystems.
            renameOrCopy(backup, dest);
          } else {
            // No backup restored — the dest is gone for good, so its namespace
            // parent may now be an empty shell worth pruning.
            parentDirs.add(dirname(dest));
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

  // Prune empty namespace-parent shells left behind by removing the last skill
  // in a namespace. Never touch the tool's own component roots (skills/,
  // commands/, agents/) even if a tool legitimately has zero installs.
  for (const parent of parentDirs) {
    if (rootDirs.has(parent)) continue;
    try {
      if (existsSync(parent) && !isSymlink(parent) && readdirSync(parent).length === 0) {
        rmSync(parent, { recursive: true });
      }
    } catch (error) {
      logError(`Failed to prune empty namespace dir ${parent}`, error);
    }
  }

  return removed;
}

/**
 * Scan a file-copy tool instance's config dir + manifest and reconstruct the
 * installed plugins. Used for OpenCode/Amp/Codex (Claude and Pi have their own
 * native listings).
 */
export function listInstalledForManagedInstance(instance: ToolInstance): Plugin[] {
  // Load manifest to get authoritative source paths
  // Manifest may have items under both "toolId" and "toolId:instanceId" keys
  const manifest = loadMigratedManifest();
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
    const skillsDir = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir);
    try {
      if (lstatSync(skillsDir).isDirectory()) {
        if (instance.pluginFlatInstall) {
          for (const item of readdirSync(skillsDir)) {
            const itemPath = join(skillsDir, item);
            try {
              const stat = lstatSync(itemPath);
              if (stat.isDirectory() || stat.isSymbolicLink()) {
                if (existsSync(join(itemPath, "SKILL.md"))) {
                  const source = getSource(itemPath);
                  // Flat installs may carry a flattened, plugin-prefixed disk
                  // name (see flattenNamespacedName) — recover the true skill
                  // name from its source path rather than reporting the
                  // prefixed one.
                  components.push({ type: "skill", name: basename(source), source });
                }
              }
            } catch (error) {
              logError(`Failed to stat skill entry ${itemPath}`, error);
            }
          }
        } else {
          // Namespaced: skills/<plugin>/<skill>/SKILL.md
          for (const pluginDirName of readdirSync(skillsDir)) {
            const pluginDir = join(skillsDir, pluginDirName);
            try {
              const pluginStat = lstatSync(pluginDir);
              if (!pluginStat.isDirectory() && !pluginStat.isSymbolicLink()) continue;
              for (const skillName of readdirSync(pluginDir)) {
                const skillPath = join(pluginDir, skillName);
                try {
                  const stat = lstatSync(skillPath);
                  if (stat.isDirectory() || stat.isSymbolicLink()) {
                    if (existsSync(join(skillPath, "SKILL.md"))) {
                      const source = getSource(skillPath);
                      components.push({ type: "skill", name: skillName, source });
                    }
                  }
                } catch (error) {
                  logError(`Failed to stat skill entry ${skillPath}`, error);
                }
              }
            } catch (error) {
              logError(`Failed to stat plugin dir ${pluginDir}`, error);
            }
          }
        }
      }
    } catch {
      // Ignore if skills directory doesn't exist
    }
  }

  // Scan commands
  if (instance.commandsSubdir) {
    const commandsDir = resolveInstanceSubdirPath(instance.configDir, instance.commandsSubdir);
    try {
      if (lstatSync(commandsDir).isDirectory()) {
        if (usesFlatCommands(instance)) {
          for (const item of readdirSync(commandsDir)) {
            if (item.endsWith(".md")) {
              const itemPath = join(commandsDir, item);
              const source = getSource(itemPath);
              // Recover the true command name from its source path — the
              // disk name may be flattened/plugin-prefixed (see
              // flattenNamespacedName).
              const name = basename(source).replace(/\.md$/, "");
              components.push({ type: "command", name, source });
            }
          }
        } else {
          // Namespaced: commands/<plugin>/<command>.md
          for (const pluginDirName of readdirSync(commandsDir)) {
            const pluginDir = join(commandsDir, pluginDirName);
            try {
              const pluginStat = lstatSync(pluginDir);
              if (!pluginStat.isDirectory() && !pluginStat.isSymbolicLink()) continue;
              for (const item of readdirSync(pluginDir)) {
                if (item.endsWith(".md")) {
                  const name = item.replace(/\.md$/, "");
                  const itemPath = join(pluginDir, item);
                  const source = getSource(itemPath);
                  components.push({ type: "command", name, source });
                }
              }
            } catch (error) {
              logError(`Failed to stat plugin dir ${pluginDir}`, error);
            }
          }
        }
      }
    } catch {
      // Ignore if commands directory doesn't exist
    }
  }

  // Scan agents
  if (instance.agentsSubdir) {
    const agentsDir = resolveInstanceSubdirPath(instance.configDir, instance.agentsSubdir);
    try {
      if (lstatSync(agentsDir).isDirectory()) {
        if (instance.pluginFlatInstall) {
          for (const item of readdirSync(agentsDir)) {
            if (item.endsWith(".md")) {
              const itemPath = join(agentsDir, item);
              const source = getSource(itemPath);
              // Recover the true agent name from its source path — the disk
              // name may be flattened/plugin-prefixed (see
              // flattenNamespacedName).
              const name = basename(source).replace(/\.md$/, "");
              components.push({ type: "agent", name, source });
            }
          }
        } else {
          // Namespaced: agents/<plugin>/<agent>.md
          for (const pluginDirName of readdirSync(agentsDir)) {
            const pluginDir = join(agentsDir, pluginDirName);
            try {
              const pluginStat = lstatSync(pluginDir);
              if (!pluginStat.isDirectory() && !pluginStat.isSymbolicLink()) continue;
              for (const item of readdirSync(pluginDir)) {
                if (item.endsWith(".md")) {
                  const name = item.replace(/\.md$/, "");
                  const itemPath = join(pluginDir, item);
                  const source = getSource(itemPath);
                  components.push({ type: "agent", name, source });
                }
              }
            } catch (error) {
              logError(`Failed to stat plugin dir ${pluginDir}`, error);
            }
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

/**
 * The generic file-copy adapter. `install`/`update` and their component
 * equivalents are the same operation (materialize files); this is the base that
 * Codex extends, overriding only `supports`/`isInstalled`.
 */
export const managedAdapter: ToolAdapter = {
  toolId: "managed",
  usesSource: true,

  supports(_input: SupportInput): { supported: boolean; reason?: string } {
    // OpenCode/Amp are gated off from plugin support by product decision.
    return {
      supported: false,
      reason:
        "Plugin support is blocked for this tool until native plugin checks are implemented",
    };
  },

  isInstalled(): boolean {
    // supported === false, so the status check never reaches here for managed
    // tools; return false to match the pre-refactor `installed` default.
    return false;
  },

  listInstalled(instance: ToolInstance): Plugin[] {
    return listInstalledForManagedInstance(instance);
  },

  async install(
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
    return { count, errors };
  },

  async uninstall(plugin: Plugin, instance: ToolInstance): Promise<PerInstanceResult> {
    const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
    return { count: removed, errors: [] };
  },

  async update(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
  ): Promise<PerInstanceResult> {
    return this.install(plugin, instance, sourcePath, "");
  },

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
    return { count, errors };
  },

  async removeComponents(plugin: Plugin, instance: ToolInstance): Promise<number> {
    return uninstallPluginItemsFromInstance(plugin.name, instance);
  },
};
