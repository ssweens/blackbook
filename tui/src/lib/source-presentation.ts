/**
 * Universal helpers for rendering source-repo paths in the UI.
 *
 * The local source-repo checkout lives under `~/.cache/blackbook/source_repos/<name>/`
 * — that's an internal cache directory managed by blackbook, NOT a path the user
 * should be aware of. Anywhere we display a path that lives under the source repo,
 * we should:
 *   1. Show it RELATIVE to the source-repo root (e.g. `skills/gbrain/ask-user`),
 *      not the absolute cache path.
 *   2. Optionally prefix it with a short repo identity derived from the git remote.
 *
 * This module centralizes that logic so every detail view, list row, and metadata
 * panel renders source paths consistently.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { expandPath, getConfigRepoPath } from "./config.js";

let cachedRemoteUrl: { repoPath: string; url: string | null } | null = null;
let cachedRepoShortName: { repoPath: string; name: string | null } | null = null;

/**
 * Get the git remote URL ("origin") of the source repo, or null if unavailable.
 * Cached per repoPath; call invalidateSourceRepoCache() to refresh.
 */
export function getSourceRepoRemoteUrl(): string | null {
  const repoPath = getConfigRepoPath();
  if (!repoPath) return null;
  const absRepo = expandPath(repoPath);
  if (cachedRemoteUrl?.repoPath === absRepo) return cachedRemoteUrl.url;
  if (!existsSync(join(absRepo, ".git"))) {
    cachedRemoteUrl = { repoPath: absRepo, url: null };
    return null;
  }
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: absRepo,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    cachedRemoteUrl = { repoPath: absRepo, url: out || null };
    return out || null;
  } catch {
    cachedRemoteUrl = { repoPath: absRepo, url: null };
    return null;
  }
}

/**
 * Get a short identity for the source repo, e.g. "ssweens/playbook" extracted
 * from "git@github.com:ssweens/playbook.git" or "https://github.com/ssweens/playbook".
 * Falls back to the repo dir name. Returns null only when there's no source repo.
 */
export function getSourceRepoShortName(): string | null {
  const repoPath = getConfigRepoPath();
  if (!repoPath) return null;
  const absRepo = expandPath(repoPath);
  if (cachedRepoShortName?.repoPath === absRepo) return cachedRepoShortName.name;
  const url = getSourceRepoRemoteUrl();
  let name: string | null = null;
  if (url) {
    // git@github.com:owner/repo.git  -> owner/repo
    // https://github.com/owner/repo(.git)? -> owner/repo
    const m = url.match(/(?:[:/])([^:/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (m) name = m[1];
  }
  if (!name) {
    // Fall back to the trailing dir name.
    const parts = absRepo.split("/").filter(Boolean);
    name = parts[parts.length - 1] ?? null;
  }
  cachedRepoShortName = { repoPath: absRepo, name };
  return name;
}

/**
 * Convert an absolute path that lives under the source repo into a path
 * relative to the source-repo root. Returns the original path unchanged if
 * it isn't under the source repo (e.g. tool-disk install paths).
 *
 * Example:
 *   ~/.cache/blackbook/source_repos/playbook/skills/gbrain/ask-user
 *     -> "skills/gbrain/ask-user"
 *   /Users/ssweens/.claude/skills/foo
 *     -> "/Users/ssweens/.claude/skills/foo" (unchanged)
 */
export function relativizeSourcePath(absolutePath: string): string {
  const repoPath = getConfigRepoPath();
  if (!repoPath) return absolutePath;
  const absRepo = expandPath(repoPath);
  if (!absolutePath.startsWith(absRepo)) return absolutePath;
  let rel = absolutePath.slice(absRepo.length);
  if (rel.startsWith("/")) rel = rel.slice(1);
  return rel || ".";
}

/**
 * Format a source-repo path for display, e.g. "ssweens/playbook · skills/gbrain/ask-user".
 * If the path isn't under the source repo, returns the absolute path unchanged.
 * If the repo has no remote, falls back to just the relative path.
 */
export function formatSourcePath(absolutePath: string): string {
  const repoPath = getConfigRepoPath();
  if (!repoPath) return absolutePath;
  const absRepo = expandPath(repoPath);
  if (!absolutePath.startsWith(absRepo)) return absolutePath;
  const rel = relativizeSourcePath(absolutePath);
  const shortName = getSourceRepoShortName();
  return shortName ? `${shortName} · ${rel}` : rel;
}

/** Invalidate cached remote/shortname lookups. Call after source repo changes. */
export function invalidateSourcePresentationCache(): void {
  cachedRemoteUrl = null;
  cachedRepoShortName = null;
}
