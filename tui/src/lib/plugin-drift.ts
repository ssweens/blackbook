/**
 * Plugin drift detection using git.
 *
 * Two signals:
 *   source-changed  — the plugin directory in the source repo has uncommitted
 *                     changes (git status --porcelain)
 *   target-changed  — the installed copy differs from the source repo copy
 *                     (git diff --no-index, works even without a tracked repo)
 *
 * Never checks the Blackbook plugin download cache as a comparison point.
 */

import { existsSync, lstatSync, readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { basename, dirname, join, resolve } from "path";
import type { Plugin } from "./types.js";
import { loadManifest } from "./manifest.js";
import { buildManifestItemKey, instanceKey } from "./plugin-helpers.js";
import { getToolInstances, parseMarketplaces } from "./config.js";
import { resolveLocalPathRaw } from "./path-utils.js";
import { resolveInstalledPluginComponentPath } from "./pi-bridge.js";

const execFileAsync = promisify(execFile);

export type ComponentDriftStatus =
  | "source-changed"
  | "target-changed"
  | "both-changed"
  | "in-sync";

/** key: "kind:name" → drift status */
export type PluginDrift = Record<string, ComponentDriftStatus>;

// ─────────────────────────────────────────────────────────────────────────────
// Git primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a path has uncommitted changes in its git repo.
 * `repoDir` must be inside a git working tree.
 * `relPath` is relative to `repoDir` (or an absolute path).
 */
async function isRepoDirty(repoDir: string, relPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--", relPath],
      { cwd: repoDir, timeout: 5000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Compare two paths using git diff --no-index.
 * Works on any two paths — no git repo required.
 * Returns true if they differ.
 */
async function hasDiff(pathA: string, pathB: string): Promise<boolean> {
  if (!existsSync(pathA) || !existsSync(pathB)) return true;
  try {
    await execFileAsync(
      "git",
      ["diff", "--no-index", "--quiet", "--", pathA, pathB],
      { timeout: 10000 }
    );
    return false; // exit 0 = identical
  } catch {
    return true; // exit 1 = differs (or error)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source path resolution
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedPluginSource {
  /** Absolute path to the plugin root dir in the source repo. */
  pluginDir: string;
  /** Absolute path to the repo root (for git status calls). */
  repoRoot: string;
  /** Plugin dir path relative to repoRoot (for git status). */
  relPluginPath: string;
}

interface MarketplaceJson {
  plugins?: Array<{ name?: string; source?: string | object }>;
}

/**
 * Find the plugin directory in a local source repo by reading each local
 * marketplace's JSON directly from disk — does NOT depend on the store's
 * marketplaces state, which may have empty `plugins` arrays at call time.
 */
function resolvePluginSource(
  pluginName: string,
  marketplaces: Array<{ url: string }>
): ResolvedPluginSource | null {
  // Use the raw config marketplaces (always populated with URLs), falling back
  // to the passed-in list so callers don't have to worry about which they pass.
  const sources: Array<{ url: string }> = [
    ...parseMarketplaces(),
    ...marketplaces,
  ];
  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  for (const mp of uniqueSources) {
    const mpUrl = mp.url;
    // Only local marketplaces have a source repo we can inspect — matches
    // /, ~, ./, ../, and file:// (raw: doesn't collapse a file target to its
    // directory, since the directory-vs-file branch below needs the raw
    // target to try alternate filenames when it's a directory).
    const normalizedUrl = resolveLocalPathRaw(mpUrl);
    if (normalizedUrl === null) continue;

    // Determine the marketplace JSON file path.
    let marketplaceFile: string;
    const stat = existsSync(normalizedUrl) ? lstatSync(normalizedUrl) : null;
    if (stat?.isDirectory()) {
      const candidate1 = join(normalizedUrl, "marketplace.json");
      const candidate2 = join(normalizedUrl, ".claude-plugin", "marketplace.json");
      if (existsSync(candidate1)) marketplaceFile = candidate1;
      else if (existsSync(candidate2)) marketplaceFile = candidate2;
      else continue;
    } else if (stat?.isFile()) {
      marketplaceFile = normalizedUrl;
    } else {
      continue;
    }

    // Derive the repo root (base dir for resolving relative plugin sources).
    let baseDir = dirname(marketplaceFile);
    if (basename(baseDir) === ".claude-plugin") {
      baseDir = dirname(baseDir);
    }

    // Read the marketplace JSON to find the plugin's source path.
    let data: MarketplaceJson;
    try {
      data = JSON.parse(readFileSync(marketplaceFile, "utf-8")) as MarketplaceJson;
    } catch {
      continue;
    }

    const entry = data.plugins?.find((p) => p.name === pluginName);
    if (!entry) continue;

    const src = entry.source;
    if (typeof src !== "string") continue;
    if (!src.startsWith("./") && !src.startsWith("../")) continue;

    const pluginDir = resolve(baseDir, src);
    if (!existsSync(pluginDir)) continue;

    return {
      pluginDir,
      repoRoot: baseDir,
      relPluginPath: src.replace(/^\.\//, ""),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main drift computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the source repo path for a plugin (for building DiffTargets).
 * Returns null if the plugin source can't be resolved.
 */
export function resolvePluginSourcePaths(
  plugin: Plugin,
): { pluginDir: string; repoRoot: string } | null {
  const resolved = resolvePluginSource(plugin.name, []);
  if (!resolved) return null;
  return { pluginDir: resolved.pluginDir, repoRoot: resolved.repoRoot };
}

/**
 * Run async tasks with a bounded concurrency so we don't saturate libuv's
 * child_process event queue. Plugin drift fires off git status / git diff
 * subprocesses for every component × enabled tool; without this guard a
 * plugin with many components can stall stdin readable events long enough
 * that the next user keypress (most commonly Esc) appears unresponsive.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function computePluginDrift(
  plugin: Plugin,
): Promise<PluginDrift> {
  const drift: PluginDrift = {};

  const pluginSource = resolvePluginSource(plugin.name, []);
  const toolInstances = getToolInstances();
  const manifest = loadManifest();

  const allComponents: Array<{
    kind: "skill" | "command" | "agent";
    name: string;
  }> = [
    ...plugin.skills.map((name) => ({ kind: "skill" as const, name })),
    ...plugin.commands.map((name) => ({ kind: "command" as const, name })),
    ...plugin.agents.map((name) => ({ kind: "agent" as const, name })),
  ];

  await mapLimit(allComponents, 4, async ({ kind, name }) => {
      const key = `${kind}:${name}`;

      // ── Source side ───────────────────────────────────────────────────────
      // Does the plugin directory in the source repo have uncommitted changes?
      let sourceDirty = false;
      if (pluginSource) {
        const componentRelPath = kind === "skill"
          ? `${pluginSource.relPluginPath}/skills/${name}`
          : `${pluginSource.relPluginPath}/${kind}s/${name}.md`;
        sourceDirty = await isRepoDirty(pluginSource.repoRoot, componentRelPath);
      }

      // ── Target side ───────────────────────────────────────────────────────
      // Has the installed copy diverged from the source repo copy?
      let targetDirty = false;
      if (pluginSource) {
        const srcSuffix = kind === "skill" ? name : `${name}.md`;
        const srcPath = join(pluginSource.pluginDir, `${kind}s`, srcSuffix);

        await mapLimit(
          toolInstances.filter((inst) => inst.enabled),
          2,
          async (inst) => {
              if (targetDirty) return;

              const subdir =
                kind === "skill"
                  ? inst.skillsSubdir
                  : kind === "command"
                    ? inst.commandsSubdir
                    : inst.agentsSubdir;
              if (!subdir) return;

              // Try manifest first for the exact dest path, then fall back to
              // the tool-native install location. Pi plugins are bridge-managed
              // and resolve to the staged `resolvedSource`, not ~/.pi/agent/skills.
              const ikey = instanceKey(inst);
              const manifestKey = buildManifestItemKey(plugin.name, kind, name);
              const manifestItem = manifest.tools[ikey]?.items[manifestKey];
              const destPath = resolveInstalledPluginComponentPath(inst, plugin, kind, name, manifestItem?.dest);
              if (!destPath || !existsSync(destPath)) return;

              if (await hasDiff(srcPath, destPath)) {
                targetDirty = true;
              }
            },
        );
      }

      // ── Combine ───────────────────────────────────────────────────────────
      let status: ComponentDriftStatus = "in-sync";
      if (sourceDirty && targetDirty) status = "both-changed";
      else if (sourceDirty) status = "source-changed";
      else if (targetDirty) status = "target-changed";

      drift[key] = status;
    });

  return drift;
}

/**
 * Batch drift computation for every installed plugin (list-view "changed"
 * badges). `computePluginDrift` already bounds concurrency *within* one
 * plugin (4 components × 2 tool-instances = up to 8 concurrent git
 * subprocesses), but that bound does nothing to stop N plugins from all
 * running at once — for 10 installed plugins that's up to 80 concurrent
 * spawns, which is what previously stalled stdin responsiveness badly enough
 * that background computation was disabled outright. `concurrency` bounds
 * how many plugins' drift is computed at once, capping the worst case at
 * `concurrency * 8` regardless of how many plugins are installed.
 */
export async function computeAllPluginsDrift(
  plugins: Plugin[],
  concurrency = 2,
): Promise<Record<string, PluginDrift>> {
  const entries = await mapLimit(
    plugins,
    concurrency,
    async (plugin): Promise<[string, PluginDrift]> => [plugin.name, await computePluginDrift(plugin)],
  );
  return Object.fromEntries(entries);
}
