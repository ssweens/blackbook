import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { createHash } from "crypto";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { getCacheDir } from "./config.js";
import { getGitHubToken, isGitHubHost } from "./github.js";
import type { Marketplace, Plugin } from "./types.js";

export const MARKETPLACE_CACHE_TTL_SECONDS = 600;

function getCachePath(key: string): string {
  const hash = createHash("md5").update(key).digest("hex");
  const cacheDir = join(getCacheDir(), "http_cache");
  mkdirSync(cacheDir, { recursive: true });
  return join(cacheDir, `${hash}.json`);
}

function cacheGet(key: string, maxAgeSeconds = 3600): unknown | null {
  const path = getCachePath(key);
  if (!existsSync(path)) return null;

  try {
    const stat = statSync(path);
    const age = (Date.now() - stat.mtimeMs) / 1000;
    if (age > maxAgeSeconds) return null;

    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    console.error(`Failed to read cache ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function cacheSet(key: string, value: unknown): void {
  const path = getCachePath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

interface MarketplaceJson {
  plugins?: Array<{
    name?: string;
    description?: string;
    source?: string | { source: string; url?: string; repo?: string; ref?: string };
    homepage?: string;
    lspServers?: Record<string, unknown>;
    mcpServers?: Record<string, unknown>;
  }>;
}

function parseGithubRepoFromUrl(url: string): [string, string] | null {
  const rawMatch = url.match(
    /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/
  );
  if (rawMatch) return [rawMatch[1], rawMatch[2]];

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (gitMatch) return [gitMatch[1], "main"];

  return null;
}

interface GitHubTreeItem {
  name: string;
  path: string;
  contentType: "file" | "directory";
}

interface GitHubTreeResponse {
  payload?: {
    tree?: {
      items?: GitHubTreeItem[];
    };
  };
}

function resolveLocalMarketplacePath(url: string, isLocal: boolean): string | null {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url);
    } catch {
      return null;
    }
  }

  const looksLocal =
    isLocal ||
    url.startsWith("/") ||
    url.startsWith("~") ||
    url.startsWith("./") ||
    url.startsWith("../");

  if (!looksLocal && url.includes("://")) return null;

  let normalized = url;
  if (normalized.startsWith("~")) {
    normalized = resolve(homedir(), normalized.slice(1));
  } else if (!normalized.startsWith("/")) {
    normalized = resolve(process.cwd(), normalized);
  }

  if (looksLocal || existsSync(normalized)) {
    return normalized;
  }

  return null;
}

async function fetchGitHubTree(repo: string, branch: string, path: string): Promise<GitHubTreeItem[]> {
  const url = `https://github.com/${repo}/tree/${branch}/${path}`;
  const cacheKey = `gh-tree:${url}`;
  
  const cached = cacheGet(cacheKey) as GitHubTreeItem[] | null;
  if (cached) return cached;

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getGitHubToken();
    if (token && isGitHubHost(url)) {
      headers.Authorization = `token ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`Failed to fetch GitHub tree ${url}: HTTP ${res.status}`);
      return [];
    }
    const data: GitHubTreeResponse = await res.json();
    const items = data.payload?.tree?.items || [];
    cacheSet(cacheKey, items);
    return items;
  } catch (error) {
    console.error(`Failed to fetch GitHub tree ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchPluginContents(
  repo: string,
  branch: string,
  path: string
): Promise<{
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  hasMcp: boolean;
}> {
  const cleanPath = path.replace(/^\.\//, "");

  try {
    const items = await fetchGitHubTree(repo, branch, cleanPath);

    // Collect directories that need sub-fetching
    const subFetches: Promise<void>[] = [];
    const result = { skills: [] as string[], commands: [] as string[], agents: [] as string[], hooks: [] as string[], hasMcp: false };

    for (const item of items) {
      const baseName = item.name.split("/")[0];
      
      if (item.contentType === "directory") {
        if (item.name === "skills") {
          subFetches.push(
            fetchGitHubTree(repo, branch, item.path).then((skillItems) => {
              result.skills = skillItems
                .filter((s) => s.contentType === "directory")
                .map((s) => s.name);
            })
          );
        } else if (baseName === "skills" && item.name.startsWith("skills/")) {
          const skillName = item.name.replace("skills/", "");
          if (!skillName.includes("/")) {
            result.skills.push(skillName);
          }
        } else if (item.name === "commands") {
          subFetches.push(
            fetchGitHubTree(repo, branch, item.path).then((cmdItems) => {
              result.commands = cmdItems
                .filter((c) => c.name.endsWith(".md"))
                .map((c) => c.name.replace(/\.md$/, ""));
            })
          );
        } else if (item.name === "agents") {
          subFetches.push(
            fetchGitHubTree(repo, branch, item.path).then((agentItems) => {
              result.agents = agentItems
                .filter((a) => a.name.endsWith(".md"))
                .map((a) => a.name.replace(/\.md$/, ""));
            })
          );
        } else if (item.name === "hooks") {
          subFetches.push(
            fetchGitHubTree(repo, branch, item.path).then((hookItems) => {
              result.hooks = hookItems
                .filter((h) => h.name.endsWith(".md") || h.name.endsWith(".json"))
                .map((h) => h.name.replace(/\.(md|json)$/, ""));
            })
          );
        }
      }
      
      if (item.contentType === "file") {
        if (baseName === "commands" && item.name.endsWith(".md")) {
          const cmdName = item.name.replace("commands/", "").replace(/\.md$/, "");
          if (!cmdName.includes("/")) {
            result.commands.push(cmdName);
          }
        } else if (baseName === "agents" && item.name.endsWith(".md")) {
          const agentName = item.name.replace("agents/", "").replace(/\.md$/, "");
          if (!agentName.includes("/")) {
            result.agents.push(agentName);
          }
        } else if (baseName === "hooks" && (item.name.endsWith(".md") || item.name.endsWith(".json"))) {
          const hookName = item.name.replace("hooks/", "").replace(/\.(md|json)$/, "");
          if (!hookName.includes("/")) {
            result.hooks.push(hookName);
          }
        }
      }
      
      if (item.name === "mcp.json" || item.name === ".mcp.json" ||
          item.name.endsWith("/mcp.json") || item.name.endsWith("/.mcp.json")) {
        result.hasMcp = true;
      }
    }

    await Promise.all(subFetches);
    return result;
  } catch (error) {
    console.error(`Failed to fetch plugin contents for ${repo}@${branch}/${path}: ${error instanceof Error ? error.message : String(error)}`);
    return { skills: [], commands: [], agents: [], hooks: [], hasMcp: false };
  }
}

/**
 * Scan a local plugin directory for skills, commands, agents, hooks, and MCP.
 */
function scanLocalPluginContents(pluginDir: string): {
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  hasMcp: boolean;
} {
  const result = { skills: [] as string[], commands: [] as string[], agents: [] as string[], hooks: [] as string[], hasMcp: false };

  if (!existsSync(pluginDir)) return result;

  try {
    const skillsDir = join(pluginDir, "skills");
    if (existsSync(skillsDir)) {
      for (const item of readdirSync(skillsDir)) {
        const itemPath = join(skillsDir, item);
        if (statSync(itemPath).isDirectory() && existsSync(join(itemPath, "SKILL.md"))) {
          result.skills.push(item);
        }
      }
    }

    const commandsDir = join(pluginDir, "commands");
    if (existsSync(commandsDir)) {
      for (const item of readdirSync(commandsDir)) {
        if (item.endsWith(".md")) {
          result.commands.push(item.replace(/\.md$/, ""));
        }
      }
    }

    const agentsDir = join(pluginDir, "agents");
    if (existsSync(agentsDir)) {
      for (const item of readdirSync(agentsDir)) {
        if (item.endsWith(".md")) {
          result.agents.push(item.replace(/\.md$/, ""));
        }
      }
    }

    const hooksDir = join(pluginDir, "hooks");
    if (existsSync(hooksDir)) {
      for (const item of readdirSync(hooksDir)) {
        if (item.endsWith(".md") || item.endsWith(".json")) {
          result.hooks.push(item.replace(/\.(md|json)$/, ""));
        }
      }
    }

    if (existsSync(join(pluginDir, "mcp.json")) || existsSync(join(pluginDir, ".mcp.json"))) {
      result.hasMcp = true;
    }
  } catch (error) {
    console.error(`Failed to scan local plugin ${pluginDir}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

export async function fetchMarketplace(
  marketplace: Marketplace,
  options?: { forceRefresh?: boolean }
): Promise<Plugin[]> {
  const cacheKey = `marketplace:${marketplace.url}`;
  const forceRefresh = options?.forceRefresh ?? false;

  // Local marketplaces: always read fresh from disk, never cache
  const localPath = resolveLocalMarketplacePath(marketplace.url, marketplace.isLocal);
  let data: MarketplaceJson | null = null;

  if (localPath) {
    try {
      let targetPath = localPath;
      if (existsSync(localPath) && statSync(localPath).isDirectory()) {
        const candidate = join(localPath, "marketplace.json");
        const fallback = join(localPath, ".claude-plugin", "marketplace.json");
        if (existsSync(candidate)) {
          targetPath = candidate;
        } else if (existsSync(fallback)) {
          targetPath = fallback;
        } else {
          console.error(`Local marketplace directory missing marketplace.json: ${localPath}`);
          return [];
        }
      }
      if (!existsSync(targetPath)) {
        console.error(`Local marketplace path not found: ${targetPath}`);
        return [];
      }
      data = JSON.parse(readFileSync(targetPath, "utf-8"));
    } catch (error) {
      console.error(`Failed to read local marketplace ${marketplace.url}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  } else {
    // Remote marketplaces: use HTTP cache
    data = forceRefresh
      ? null
      : (cacheGet(cacheKey, MARKETPLACE_CACHE_TTL_SECONDS) as MarketplaceJson | null);

    if (!data) {
      try {
        const headers: Record<string, string> = {};
        const token = getGitHubToken();
        if (token && isGitHubHost(marketplace.url)) {
          headers.Authorization = `token ${token}`;
        }
        const res = await fetch(marketplace.url, { headers });
        if (!res.ok) {
          console.error(`Failed to fetch marketplace ${marketplace.url}: HTTP ${res.status}`);
          return [];
        }
        data = await res.json();
        cacheSet(cacheKey, data);
      } catch (error) {
        console.error(`Failed to fetch marketplace ${marketplace.url}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }
  }

  const repoInfo = parseGithubRepoFromUrl(marketplace.url);
  const localMarketplacePath = resolveLocalMarketplacePath(marketplace.url, marketplace.isLocal);

  // For local marketplaces, determine the base directory for resolving relative plugin sources
  // If the path is a directory, use it directly; if it's a file (marketplace.json), use its parent
  let localBaseDir: string | null = null;
  if (localMarketplacePath) {
    try {
      localBaseDir = statSync(localMarketplacePath).isDirectory()
        ? localMarketplacePath
        : dirname(localMarketplacePath);
    } catch {
      localBaseDir = dirname(localMarketplacePath);
    }
  }

  // Fetch all plugin contents in parallel
  const pluginPromises = (data?.plugins || []).map(async (p) => {
    let skills: string[] = [];
    let commands: string[] = [];
    let agents: string[] = [];
    let hooks: string[] = [];
    let hasMcp = false;

    const source = p.source || "";

    // Local marketplace: scan plugin directory for contents
    if (localBaseDir && typeof source === "string" && source.startsWith("./")) {
      const pluginDir = resolve(localBaseDir, source);
      const contents = scanLocalPluginContents(pluginDir);
      skills = contents.skills;
      commands = contents.commands;
      agents = contents.agents;
      hooks = contents.hooks;
      hasMcp = contents.hasMcp;
    } else if (repoInfo && typeof source === "string" && source.startsWith("./")) {
      const [repo, branch] = repoInfo;
      const contents = await fetchPluginContents(repo, branch, source);
      skills = contents.skills;
      commands = contents.commands;
      agents = contents.agents;
      hooks = contents.hooks;
      hasMcp = contents.hasMcp;
    } else if (typeof source === "object" && source.source === "github" && source.repo) {
      const contents = await fetchPluginContents(
        source.repo,
        source.ref || "main",
        ""
      );
      skills = contents.skills;
      commands = contents.commands;
      agents = contents.agents;
      hooks = contents.hooks;
      hasMcp = contents.hasMcp;
    } else if (typeof source === "object" && source.source === "url" && source.url) {
      const urlRepoInfo = parseGithubRepoFromUrl(source.url);
      if (urlRepoInfo) {
        const [repo, branch] = urlRepoInfo;
        const contents = await fetchPluginContents(repo, branch, "");
        skills = contents.skills;
        commands = contents.commands;
        agents = contents.agents;
        hooks = contents.hooks;
        hasMcp = contents.hasMcp;
      }
    }

    let homepage = p.homepage || "";
    if (!homepage && typeof source === "object") {
      if (source.source === "url" && source.url) {
        homepage = source.url;
      } else if (source.source === "github" && source.repo) {
        homepage = `https://github.com/${source.repo}`;
      }
    }

    const hasLspFromManifest = p.lspServers && Object.keys(p.lspServers).length > 0;
    const hasMcpFromManifest = p.mcpServers && Object.keys(p.mcpServers).length > 0;

    return {
      name: p.name || "",
      marketplace: marketplace.name,
      description: p.description || "",
      source,
      skills,
      commands,
      agents,
      hooks,
      hasMcp: hasMcp || Boolean(hasMcpFromManifest),
      hasLsp: Boolean(hasLspFromManifest),
      homepage,
      installed: false,
      scope: "user" as const,
    };
  });

  return Promise.all(pluginPromises);
}

export async function fetchAllMarketplaces(
  marketplaces: Marketplace[]
): Promise<Map<string, Plugin[]>> {
  const results = new Map<string, Plugin[]>();

  await Promise.all(
    marketplaces.map(async (m) => {
      const plugins = await fetchMarketplace(m);
      results.set(m.name, plugins);
    })
  );

  return results;
}
