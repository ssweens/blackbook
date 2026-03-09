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
import { homedir } from "os";
import type { Plugin } from "./types.js";
import { loadManifest } from "./manifest.js";
import { instanceKey } from "./plugin-helpers.js";
import { getToolInstances, parseMarketplaces } from "./config.js";

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
    // Only local marketplaces have a source repo we can inspect.
    if (!mpUrl.startsWith("/") && !mpUrl.startsWith("~") && !mpUrl.startsWith("./") && !mpUrl.startsWith("../")) {
      continue;
    }

    // Resolve the marketplace file path.
    let normalizedUrl = mpUrl;
    if (normalizedUrl.startsWith("~")) {
      normalizedUrl = resolve(homedir(), normalizedUrl.slice(1));
    }

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

  await Promise.all(
    allComponents.map(async ({ kind, name }) => {
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

        await Promise.all(
          toolInstances
            .filter((inst) => inst.enabled)
            .map(async (inst) => {
              if (targetDirty) return;

              const subdir =
                kind === "skill"
                  ? inst.skillsSubdir
                  : kind === "command"
                    ? inst.commandsSubdir
                    : inst.agentsSubdir;
              if (!subdir) return;

              // Try manifest first for the exact dest path.
              const ikey = instanceKey(inst);
              const manifestItem = manifest.tools[ikey]?.items[key];
              let destPath: string;

              if (manifestItem?.dest) {
                destPath = manifestItem.dest.startsWith("/")
                  ? manifestItem.dest
                  : join(inst.configDir, manifestItem.dest);
              } else {
                const suffix = kind === "skill" ? name : `${name}.md`;
                destPath = join(inst.configDir, subdir, suffix);
              }

              if (!existsSync(destPath)) return;

              if (await hasDiff(srcPath, destPath)) {
                targetDirty = true;
              }
            })
        );
      }

      // ── Combine ───────────────────────────────────────────────────────────
      let status: ComponentDriftStatus = "in-sync";
      if (sourceDirty && targetDirty) status = "both-changed";
      else if (sourceDirty) status = "source-changed";
      else if (targetDirty) status = "target-changed";

      drift[key] = status;
    })
  );

  return drift;
}
