/**
 * skills.sh (vercel-labs/skills) discovery integration.
 *
 * skills.sh is a separate, actively-maintained skill installer/registry that
 * happens to target the same shared `~/.agents/skills` convention Blackbook
 * owns. Per a 2026-07 decision, Blackbook does not run alongside it — it
 * absorbs skills.sh-managed content (see the Adopt flow) and, here, treats
 * skills.sh purely as a DISCOVERY source: search results are surfaced as
 * ordinary Blackbook plugins and installed through Blackbook's own pipeline
 * (namespaced by GitHub owner, tracked in Blackbook's manifest, source-repo
 * indexed like everything else). Nothing is ever installed via their CLI or
 * written to their lockfile.
 *
 * Endpoints below are the unauthenticated surface the official `npx skills`
 * CLI itself calls (verified against vercel-labs/skills source, commit
 * 777599e, 2026-07-18) — undocumented, no publicly published OpenAPI spec,
 * and could change without notice. Every caller must degrade to an empty
 * result on any failure; this is a nice-to-have discovery channel, never a
 * dependency the rest of the app can break on.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { getCacheDir } from "./config.js";
import type { Plugin } from "./types.js";

const SEARCH_URL = "https://skills.sh/api/search";
const SEARCH_CACHE_TTL_SECONDS = 300;

export interface SkillsShResult {
  /** "{owner}/{repo}/{skillId}" */
  id: string;
  /** Slug used in the download API and skills.sh detail page URL. */
  skillId: string;
  name: string;
  installs: number;
  /** "{owner}/{repo}" */
  source: string;
}

interface SearchApiResponse {
  query: string;
  searchType?: string;
  skills?: Array<{ id?: string; skillId?: string; name?: string; installs?: number; source?: string }>;
  count?: number;
}

function cachePath(key: string): string {
  const hash = createHash("md5").update(key).digest("hex");
  return join(getCacheDir(), "http_cache", `skillssh-${hash}.json`);
}

function cacheGet(key: string, maxAgeSeconds: number): SkillsShResult[] | null {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { savedAt: number; results: SkillsShResult[] };
    if (Date.now() / 1000 - raw.savedAt > maxAgeSeconds) return null;
    return raw.results;
  } catch {
    return null;
  }
}

function cacheSet(key: string, results: SkillsShResult[]): void {
  try {
    const path = cachePath(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ savedAt: Date.now() / 1000, results }));
  } catch {
    // Best-effort — a cache write failure must not break search.
  }
}

/**
 * Search skills.sh for skills matching `query`. Returns [] on any network or
 * parse failure — callers must treat this as "no results right now", not an
 * error condition worth surfacing to the user.
 */
export async function searchSkillsSh(query: string, limit = 25): Promise<SkillsShResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cacheKey = `search:${trimmed}:${limit}`;
  const cached = cacheGet(cacheKey, SEARCH_CACHE_TTL_SECONDS);
  if (cached) return cached;

  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as SearchApiResponse;
    const results: SkillsShResult[] = (data.skills ?? [])
      .filter((s): s is Required<typeof s> => !!(s.id && s.skillId && s.name && s.source))
      .map((s) => ({ id: s.id, skillId: s.skillId, name: s.name, installs: s.installs ?? 0, source: s.source }));
    cacheSet(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}

/**
 * Synthesize a skills.sh search result as a Blackbook Plugin so it can flow
 * through the existing Discover/install pipeline unmodified.
 *
 * `Plugin.name` must be globally unique: it's both the React list key
 * (`ItemList.tsx`) and Blackbook's plugin-identity match key (`p.name ===
 * plugin.name` in the store) and, via `installPluginItemsToInstance` in
 * adapters/managed.ts, the on-disk namespace directory. A single skills.sh
 * repo can ship many skills, so `owner-repo` alone collides across them —
 * confirmed live (React duplicate-key warnings, dropped rows) when a search
 * surfaced multiple skills from `vercel-labs/claude-skills`. Using their own
 * `id` field (`owner/repo/skillId`, already globally unique in their schema)
 * guarantees no collision, at the cost of a verbose on-disk namespace dir.
 * Never adopts skills.sh's own flat, unnamespaced convention.
 */
export function skillsShResultToPlugin(result: SkillsShResult): Plugin {
  const [owner, repo] = result.source.split("/");
  return {
    name: result.id.replace(/\//g, "-"),
    marketplace: "skills.sh",
    description: `${result.name} — ${result.installs.toLocaleString()} installs · github.com/${result.source}`,
    source: { source: "github", repo: result.source },
    skills: [result.skillId],
    commands: [],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: `https://skills.sh/${owner}/${repo}/${result.skillId}`,
    installed: false,
    scope: "user",
  };
}
