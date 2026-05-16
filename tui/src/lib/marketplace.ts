import { execFile, execFileSync as execSync } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, realpathSync, lstatSync } from "fs";
import { join, dirname, basename, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { getCacheDir, getPiMarketplaces, getDisabledPiMarketplaces, getPackageManager } from "./config.js";
import { getGitHubToken, isGitHubHost } from "./github.js";
import { expandTilde } from "./path-utils.js";
import type { Marketplace, Plugin, PiPackage, PiMarketplace, PiSettings, PiPackageSourceType, PackageManager } from "./types.js";

export const MARKETPLACE_CACHE_TTL_SECONDS = 600;
const execFileAsync = promisify(execFile);
const repoTreeMemoryCache = new Map<string, string[]>();

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
    version?: string;
    skills?: unknown;
    commands?: unknown;
    agents?: unknown;
    hooks?: unknown;
    lspServers?: Record<string, unknown>;
    mcpServers?: Record<string, unknown>;
  }>;
}

function parseGithubRepoFromUrl(url: string): [string, string] | null {
  const rawMatch = url.match(
    /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/
  );
  if (rawMatch) return [rawMatch[1], rawMatch[2]];

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (gitMatch) return [gitMatch[1], "main"];

  return null;
}

interface GitHubTreeItem {
  name: string;
  path: string;
  contentType: "file" | "directory";
}

interface GitHubContentsItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
}

// ── GitHub API Throttle ────────────────────────────────────────────────────
// GitHub's API rate-limits unauthenticated requests to 60/hour and
// authenticated to 5000/hour.  Without throttling, a marketplace with
// many GitHub-hosted plugins fires off dozens of concurrent requests
// and immediately hits HTTP 429.

const GITHUB_CONCURRENCY = 3;
let activeGitHubRequests = 0;
const ghQueue: Array<() => void> = [];

function enqueueGitHubRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeGitHubRequests++;
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeGitHubRequests--;
        const next = ghQueue.shift();
        if (next) next();
      }
    };
    if (activeGitHubRequests < GITHUB_CONCURRENCY) {
      void run();
    } else {
      ghQueue.push(run);
    }
  });
}

async function fetchGitHubTree(repo: string, branch: string, path: string): Promise<GitHubTreeItem[]> {
  return enqueueGitHubRequest(() => _fetchGitHubTree(repo, branch, path));
}

async function _fetchGitHubTree(repo: string, branch: string, path: string, attempt = 1): Promise<GitHubTreeItem[]> {
  const cleanPath = path.replace(/^\.\//, "").replace(/\/$/, "");
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${cleanPath}?ref=${branch}`;
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    const token = getGitHubToken();
    if (token) headers.Authorization = `token ${token}`;

    const res = await fetch(apiUrl, { headers });
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(2000 * attempt, 10000);
      if (attempt <= 3) {
        await new Promise((r) => setTimeout(r, delayMs));
        return _fetchGitHubTree(repo, branch, path, attempt + 1);
      }
      return [];
    }
    if (!res.ok) {
      if (res.status !== 404) {
        console.error(`Failed to fetch GitHub contents ${apiUrl}: HTTP ${res.status}`);
      }
      return [];
    }
    const data: GitHubContentsItem[] = await res.json();
    if (!Array.isArray(data)) return [];

    const items: GitHubTreeItem[] = data.map((item) => ({
      name: item.name,
      path: item.path,
      contentType: item.type === "dir" ? "directory" : "file",
    }));

    return items;
  } catch (error) {
    return [];
  }
}

function resolveLocalMarketplacePath(url: string, isLocal: boolean): string | null {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try { return fileURLToPath(url); } catch { return null; }
  }

  const looksLocal = isLocal || url.startsWith("/") || url.startsWith("~") ||
    url.startsWith("./") || url.startsWith("../");

  if (!looksLocal && url.includes("://")) return null;

  let normalized = expandTilde(url);
  if (!normalized.startsWith("/")) normalized = resolve(process.cwd(), normalized);

  return (looksLocal || existsSync(normalized)) ? normalized : null;
}

function normalizeDeclaredItem(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const unix = trimmed.replace(/\\/g, "/");
  const base = unix.split("/").filter(Boolean).pop() || "";
  if (!base || base === "." || base === "..") return null;

  return base.replace(/\.(md|json)$/i, "");
}

function normalizeDeclaredList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const normalized = normalizeDeclaredItem(entry);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function fetchRemotePluginMetadata(
  repo: string,
  branch: string,
  sourcePath: string,
): Promise<{ version?: string; description?: string; homepage?: string }> {
  const cleanPath = sourcePath.replace(/^\.\//, "").replace(/\/$/, "");
  const metadataUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${cleanPath}/.claude-plugin/plugin.json`;
  try {
    const headers: Record<string, string> = {};
    const token = getGitHubToken();
    if (token) headers.Authorization = `token ${token}`;
    let json: string;
    try {
      const res = await fetch(metadataUrl, { headers });
      if (!res.ok) return {};
      json = await res.text();
    } catch {
      // Fallback to curl when Node fetch fails.
      try {
        const curlArgs = ["-fsSL", "--max-time", "15"];
        if (headers.Authorization) curlArgs.push("-H", `Authorization: ${headers.Authorization}`);
        curlArgs.push(metadataUrl);
        const { stdout } = await execFileAsync("curl", curlArgs, { timeout: 30000 });
        json = stdout;
      } catch { return {}; }
    }
    const metadata = JSON.parse(json);
    return {
      version: typeof metadata.version === "string" ? metadata.version : undefined,
      description: typeof metadata.description === "string" ? metadata.description : undefined,
      homepage: typeof metadata.homepage === "string" ? metadata.homepage : undefined,
    };
  } catch {
    return {};
  }
}

async function fetchRepoTreePaths(repo: string, branch: string): Promise<string[]> {
  const key = `${repo}@${branch}`;
  const cached = repoTreeMemoryCache.get(key);
  if (cached) return cached;

  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", `curl -fsSL ${JSON.stringify(url)} | tar -tzf -`], {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const paths = stdout.split("\n").filter(Boolean).map((line) => {
      const slash = line.indexOf("/");
      return slash === -1 ? "" : line.slice(slash + 1);
    }).filter(Boolean);
    repoTreeMemoryCache.set(key, paths);
    return paths;
  } catch (error) {
    console.error(`Failed to fetch repository tree for ${repo}@${branch}: ${error instanceof Error ? error.message : String(error)}`);
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
  const cleanPath = path.replace(/^\.\//, "").replace(/\/$/, "");
  const prefix = `${cleanPath}/`;
  const result = { skills: [] as string[], commands: [] as string[], agents: [] as string[], hooks: [] as string[], hasMcp: false };
  const paths = await fetchRepoTreePaths(repo, branch);
  const add = (list: string[], value: string) => {
    if (value && !value.includes("/") && !list.includes(value)) list.push(value);
  };

  for (const fullPath of paths) {
    if (!fullPath.startsWith(prefix)) continue;
    const rel = fullPath.slice(prefix.length);

    const skillMatch = rel.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (skillMatch) add(result.skills, skillMatch[1]);

    const commandMatch = rel.match(/^commands\/([^/]+)\.md$/);
    if (commandMatch) add(result.commands, commandMatch[1]);

    const agentMatch = rel.match(/^agents\/([^/]+)\.md$/);
    if (agentMatch) add(result.agents, agentMatch[1]);

    const hookMatch = rel.match(/^hooks\/([^/]+)\.(md|json)$/);
    if (hookMatch) add(result.hooks, hookMatch[1]);

    if (rel === "mcp.json" || rel === ".mcp.json") result.hasMcp = true;
  }

  result.skills.sort();
  result.commands.sort();
  result.agents.sort();
  result.hooks.sort();
  return result;
}

export async function fetchMarketplace(
  marketplace: Marketplace,
  options?: { forceRefresh?: boolean }
): Promise<Plugin[]> {
  const cacheKey = `marketplace:${marketplace.url}`;
  const forceRefresh = options?.forceRefresh ?? false;

  const localPath = resolveLocalMarketplacePath(marketplace.url, marketplace.isLocal);

  if (localPath) {
    // Local marketplace paths are not supported. Marketplaces are remote URLs.
    return [];
  }

  let data: MarketplaceJson | null = null;

  {
    // Remote marketplace: use HTTP cache.
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
      } catch {
        // Node's built-in fetch can fail on some network configurations where
        // curl works fine (undici connect timeout, DNS issues, etc.). Fall back
        // to curl as a last resort.
        try {
          const curlArgs = ["-fsSL", "--max-time", "30"];
          const token = getGitHubToken();
          if (token && isGitHubHost(marketplace.url)) {
            curlArgs.push("-H", `Authorization: token ${token}`);
          }
          curlArgs.push(marketplace.url);
          const { stdout } = await execFileAsync("curl", curlArgs, { timeout: 60000 });
          data = JSON.parse(stdout);
          cacheSet(cacheKey, data);
        } catch (curlError) {
          console.error(`Failed to fetch marketplace ${marketplace.url}: ${curlError instanceof Error ? curlError.message : String(curlError)}`);
          return [];
        }
      }
    }
  }

  const repoInfo = parseGithubRepoFromUrl(marketplace.url);

  // Build plugins from the configured marketplace URL and, when the remote
  // marketplace declares a relative plugin source, the corresponding remote
  // source path in that same repo. Never use local marketplace JSON/checkouts.
  const plugins: Plugin[] = await Promise.all((data?.plugins || []).map(async (p) => {
    const source = p.source || "";
    const declaredVersion = typeof p.version === "string" ? p.version : undefined;
    const declaresSkills = Array.isArray(p.skills);
    const declaresCommands = Array.isArray(p.commands);
    const declaresAgents = Array.isArray(p.agents);
    const declaresHooks = Array.isArray(p.hooks);
    let skills = normalizeDeclaredList(p.skills);
    let commands = normalizeDeclaredList(p.commands);
    let agents = normalizeDeclaredList(p.agents);
    let hooks = normalizeDeclaredList(p.hooks);
    let hasMcp = Object.keys(p.mcpServers ?? {}).length > 0;
    let version = declaredVersion;
    let description = p.description || "";
    let homepage = p.homepage || "";

    if (repoInfo && typeof source === "string" && source.startsWith("./")) {
      const [repo, branch] = repoInfo;
      const remoteMetadata = await fetchRemotePluginMetadata(repo, branch, source);
      version = remoteMetadata.version ?? version;
      description = remoteMetadata.description || description;
      homepage = remoteMetadata.homepage || homepage;

      if (!declaresSkills || !declaresCommands || !declaresAgents || !declaresHooks) {
        const remoteContents = await fetchPluginContents(repo, branch, source);
        if (!declaresSkills) skills = remoteContents.skills;
        if (!declaresCommands) commands = remoteContents.commands;
        if (!declaresAgents) agents = remoteContents.agents;
        if (!declaresHooks) hooks = remoteContents.hooks;
        hasMcp = hasMcp || remoteContents.hasMcp;
      }
    }

    if (!homepage && typeof source === "object") {
      if (source.source === "url" && source.url) homepage = source.url;
      else if (source.source === "github" && source.repo) homepage = `https://github.com/${source.repo}`;
    }

    return {
      name: p.name || "",
      description,
      version,
      latestVersion: version,
      source,
      skills,
      commands,
      agents,
      hooks,
      hasMcp,
      hasLsp: Object.keys(p.lspServers ?? {}).length > 0,
      lspServers: p.lspServers,
      mcpServers: p.mcpServers,
      scope: "user" as const,
      marketplace: marketplace.name,
      installed: false,
      homepage,
    };
  }));

  return plugins;
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

// ─────────────────────────────────────────────────────────────────────────────
// Pi Package Marketplace support (merged from pi-marketplace.ts)
// ─────────────────────────────────────────────────────────────────────────────

const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export function loadPiSettings(): PiSettings {
  const packages: string[] = [];

  try {
    if (existsSync(PI_SETTINGS_PATH)) {
      const content = readFileSync(PI_SETTINGS_PATH, "utf-8");
      const settings = JSON.parse(content);
      if (Array.isArray(settings.packages)) {
        for (const entry of settings.packages) {
          if (typeof entry === "string") packages.push(entry);
          else if (entry && typeof entry === "object" && typeof entry.source === "string") {
            packages.push(entry.source);
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  const pmPackages = getGlobalPiPackageVersions();
  for (const pkgName of pmPackages.keys()) {
    const source = `npm:${pkgName}`;
    if (!packages.includes(source)) packages.push(source);
  }

  return { packages };
}

function getGlobalNodeModulesPath(manager: PackageManager): string | null {
  try {
    if (manager === "bun") {
      const bunPath = join(homedir(), ".bun", "install", "global", "node_modules");
      if (!existsSync(bunPath)) return null;
      return bunPath;
    }

    if (manager === "pnpm") {
      const result = execSync("pnpm", ["root", "-g"], { encoding: "utf-8", timeout: 5000 });
      const globalNodeModules = result.trim();
      if (!existsSync(globalNodeModules)) return null;
      return globalNodeModules;
    }

    const result = execSync("npm", ["root", "-g"], { encoding: "utf-8", timeout: 5000 });
    const globalNodeModules = result.trim();
    if (!existsSync(globalNodeModules)) return null;
    return globalNodeModules;
  } catch {
    return null;
  }
}

function parsePiPackageVersion(pkgPath: string): { isPiPackage: boolean; version: string | null } {
  const pkgJsonPath = join(pkgPath, "package.json");
  if (!existsSync(pkgJsonPath)) return { isPiPackage: false, version: null };

  try {
    const content = readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    const isPiPackage =
      (pkg.pi?.extensions && Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0) ||
      (Array.isArray(pkg.keywords) && pkg.keywords.includes("pi-package"));

    return {
      isPiPackage,
      version: typeof pkg.version === "string" ? pkg.version : null,
    };
  } catch {
    return { isPiPackage: false, version: null };
  }
}

function scanGlobalPmForPiPackagesWithVersions(manager: PackageManager): Map<string, string | null> {
  const packages = new Map<string, string | null>();

  const globalNodeModules = getGlobalNodeModulesPath(manager);
  if (!globalNodeModules) return packages;

  try {
    const entries = readdirSync(globalNodeModules);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      if (entry === "node_modules") continue;

      const entryPath = join(globalNodeModules, entry);

      if (entry.startsWith("@")) {
        try {
          const scopedEntries = readdirSync(entryPath);
          for (const scopedPkg of scopedEntries) {
            const name = `${entry}/${scopedPkg}`;
            const pkgPath = join(entryPath, scopedPkg);
            const { isPiPackage, version } = parsePiPackageVersion(pkgPath);
            if (isPiPackage) {
              packages.set(name, version);
            }
          }
        } catch {
          // Ignore errors reading scoped dir
        }
        continue;
      }

      const { isPiPackage, version } = parsePiPackageVersion(entryPath);
      if (isPiPackage) packages.set(entry, version);
    }
  } catch {
    // Ignore errors
  }

  return packages;
}

export interface PiPackageInstallInfo {
  version: string | null;
  via: PackageManager;
  viaManagers: PackageManager[];
  managerMismatch: boolean;
}

export function getGlobalPiPackageInstallInfo(preferredManager: PackageManager = getPackageManager()): Map<string, PiPackageInstallInfo> {
  const order: PackageManager[] = [preferredManager, "npm", "pnpm", "bun"].filter(
    (m, i, arr): m is PackageManager => arr.indexOf(m as PackageManager) === i,
  ) as PackageManager[];

  const byManager = new Map<PackageManager, Map<string, string | null>>();
  for (const manager of order) {
    byManager.set(manager, scanGlobalPmForPiPackagesWithVersions(manager));
  }

  const allNames = new Set<string>();
  for (const found of byManager.values()) {
    for (const name of found.keys()) allNames.add(name);
  }

  const result = new Map<string, PiPackageInstallInfo>();
  for (const name of allNames) {
    const viaManagers = order.filter((manager) => byManager.get(manager)?.has(name));
    if (viaManagers.length === 0) continue;

    const preferredHas = viaManagers.includes(preferredManager);
    const via = preferredHas ? preferredManager : viaManagers[0]!;
    const version = byManager.get(via)?.get(name) ?? null;

    result.set(name, {
      version,
      via,
      viaManagers,
      managerMismatch: !preferredHas,
    });
  }

  return result;
}

export function getGlobalPiPackageVersions(preferredManager: PackageManager = getPackageManager()): Map<string, string | null> {
  const info = getGlobalPiPackageInstallInfo(preferredManager);
  const versions = new Map<string, string | null>();
  for (const [name, value] of info.entries()) {
    versions.set(name, value.version);
  }
  return versions;
}

function resolvePackagePath(source: string): string {
  if (source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("https://")) {
    return source;
  }

  if (source.startsWith("/")) {
    try {
      return realpathSync(source);
    } catch {
      return source;
    }
  }

  const piAgentDir = dirname(PI_SETTINGS_PATH);
  const resolved = resolve(piAgentDir, source);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function isPackageInstalled(source: string, settings: PiSettings): boolean {
  const normalizedSource = resolvePackagePath(source).toLowerCase();
  return settings.packages.some((pkg) => resolvePackagePath(pkg).toLowerCase() === normalizedSource);
}

export function getSourceType(source: string): PiPackageSourceType {
  const trimmed = source.trim();
  if (trimmed.startsWith("npm:")) return "npm";
  if (
    trimmed.startsWith("git:") ||
    trimmed.startsWith("git@") ||
    trimmed.startsWith("https://github.com") ||
    trimmed.endsWith(".git")
  ) {
    return "git";
  }
  return "local";
}

function normalizeGitSource(source: string): string {
  const trimmed = source.trim();

  if (trimmed.startsWith("git:")) {
    const raw = trimmed.slice(4);
    if (raw.startsWith("github.com/")) {
      return `https://${raw.replace(/\.git$/, "")}.git`;
    }
    return raw;
  }

  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }

  if (trimmed.startsWith("https://github.com/")) {
    return `${trimmed.replace(/\.git$/, "")}.git`;
  }

  return trimmed;
}

function getGitMarketplaceCachePath(source: string): string {
  const cacheRoot = join(getCacheDir(), "pi_marketplaces");
  const hash = createHash("md5").update(source).digest("hex");
  return join(cacheRoot, hash);
}

async function ensureGitMarketplaceCached(source: string): Promise<string | null> {
  const normalizedSource = normalizeGitSource(source);
  const cachePath = getGitMarketplaceCachePath(normalizedSource);
  mkdirSync(dirname(cachePath), { recursive: true });

  try {
    if (!existsSync(join(cachePath, ".git"))) {
      await execFileAsync("git", ["clone", "--depth", "1", normalizedSource, cachePath], { timeout: 60000 });
      return cachePath;
    }

    try {
      await execFileAsync("git", ["-C", cachePath, "pull", "--ff-only"], { timeout: 30000 });
    } catch {
      // Keep stale cache when pull fails.
    }

    return cachePath;
  } catch {
    return null;
  }
}

interface NpmRegistryResult {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      version?: string;
      keywords?: string[];
      links?: {
        homepage?: string;
        repository?: string;
        npm?: string;
      };
      publisher?: {
        username?: string;
      };
      license?: string;
    };
    downloads?: {
      weekly?: number;
      monthly?: number;
    };
    score?: {
      detail?: {
        popularity?: number;
      };
    };
  }>;
  total: number;
}

export async function fetchNpmPackages(): Promise<PiPackage[]> {
  try {
    const PAGE_SIZE = 250;
    const allObjects: NpmRegistryResult["objects"] = [];

    const firstResponse = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=${PAGE_SIZE}`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!firstResponse.ok) {
      throw new Error(`HTTP ${firstResponse.status}: ${firstResponse.statusText}`);
    }

    const firstData: NpmRegistryResult = await firstResponse.json();
    allObjects.push(...firstData.objects);

    const total = firstData.total;
    const remaining = Math.ceil((total - PAGE_SIZE) / PAGE_SIZE);
    for (let page = 1; page <= remaining; page++) {
      const from = page * PAGE_SIZE;
      const response = await fetch(
        `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=${PAGE_SIZE}&from=${from}`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (!response.ok) break;
      const data: NpmRegistryResult = await response.json();
      if (data.objects.length === 0) break;
      allObjects.push(...data.objects);
    }

    const settings = loadPiSettings();
    const installInfo = getGlobalPiPackageInstallInfo();

    return allObjects.map((item): PiPackage => {
      const pkg = item.package;
      const source = `npm:${pkg.name}`;
      const installed = isPackageInstalled(source, settings);
      const latestVersion = pkg.version ?? "unknown";
      const detected = installInfo.get(pkg.name);
      const installedVersion = detected?.version ?? undefined;
      const hasUpdate = Boolean(
        installed &&
        installedVersion &&
        latestVersion !== "unknown" &&
        installedVersion !== latestVersion,
      );

      return {
        name: pkg.name,
        description: pkg.description ?? "",
        version: latestVersion,
        source,
        sourceType: "npm",
        marketplace: "npm",
        installed,
        installedVersion,
        hasUpdate,
        installedVia: detected?.via,
        installedViaManagers: detected?.viaManagers,
        managerMismatch: Boolean(installed && detected?.managerMismatch),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
        homepage: pkg.links?.homepage ?? pkg.links?.npm,
        repository: pkg.links?.repository,
        author: pkg.publisher?.username,
        license: pkg.license,
        weeklyDownloads: item.downloads?.weekly,
        monthlyDownloads: item.downloads?.monthly,
        popularity: item.score?.detail?.popularity,
      };
    });
  } catch {
    return [];
  }
}

interface PiManifest {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

interface PackageJson {
  name?: string;
  description?: string;
  version?: string;
  keywords?: string[];
  homepage?: string;
  repository?: string | { url?: string };
  author?: string | { name?: string };
  license?: string;
  pi?: PiManifest;
}

function isPiPackage(pkg: PackageJson): boolean {
  if (pkg.pi) return true;
  if (pkg.keywords?.includes("pi-package")) return true;
  return false;
}

function scanConventionDirs(pkgDir: string): PiManifest {
  const manifest: PiManifest = {
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };

  const checkDir = (subdir: string, key: keyof PiManifest) => {
    const dir = join(pkgDir, subdir);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      manifest[key] = readdirSync(dir);
    }
  };

  checkDir("extensions", "extensions");
  checkDir("skills", "skills");
  checkDir("prompts", "prompts");
  checkDir("themes", "themes");

  return manifest;
}

export function scanLocalMarketplace(marketplaceName: string, dirPath: string): PiPackage[] {
  const packages: PiPackage[] = [];
  const settings = loadPiSettings();

  const expandedPath = expandTilde(dirPath);
  const resolvedPath = resolve(expandedPath);

  if (!existsSync(resolvedPath)) {
    return packages;
  }

  try {
    const entries = readdirSync(resolvedPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pkgDir = join(resolvedPath, entry.name);
      const pkgJsonPath = join(pkgDir, "package.json");

      if (!existsSync(pkgJsonPath)) continue;

      try {
        const content = readFileSync(pkgJsonPath, "utf-8");
        const pkg: PackageJson = JSON.parse(content);

        if (!isPiPackage(pkg)) continue;

        const manifest = pkg.pi ?? scanConventionDirs(pkgDir);
        const source = pkgDir;

        packages.push({
          name: pkg.name ?? entry.name,
          description: pkg.description ?? "",
          version: pkg.version ?? "0.0.0",
          source,
          sourceType: "local",
          marketplace: marketplaceName,
          installed: isPackageInstalled(source, settings),
          extensions: manifest.extensions ?? [],
          skills: manifest.skills ?? [],
          prompts: manifest.prompts ?? [],
          themes: manifest.themes ?? [],
          homepage: pkg.homepage,
          repository: typeof pkg.repository === "string"
            ? pkg.repository
            : pkg.repository?.url,
          author: typeof pkg.author === "string"
            ? pkg.author
            : pkg.author?.name,
          license: pkg.license,
        });
      } catch {
        // Skip invalid package.json
      }
    }
  } catch {
    // Directory read error
  }

  return packages;
}

export async function loadAllPiMarketplaces(): Promise<PiMarketplace[]> {
  const marketplaces: PiMarketplace[] = [];
  const disabledList = getDisabledPiMarketplaces();
  const isDisabled = (name: string) => disabledList.includes(name);

  const npmEnabled = !isDisabled("npm");
  const npmPackages = npmEnabled ? await fetchNpmPackages() : [];
  marketplaces.push({
    name: "npm",
    source: "https://www.npmjs.com",
    sourceType: "npm",
    packages: npmPackages,
    enabled: npmEnabled,
    builtIn: true,
  });

  const configured = getPiMarketplaces();
  for (const [name, source] of Object.entries(configured)) {
    const sourceType = getSourceType(source);
    const enabled = !isDisabled(name);

    if (sourceType === "local") {
      const packages = enabled ? scanLocalMarketplace(name, source) : [];
      marketplaces.push({
        name,
        source,
        sourceType,
        packages,
        enabled,
        builtIn: false,
      });
      continue;
    }

    if (sourceType === "git") {
      const cachePath = enabled ? await ensureGitMarketplaceCached(source) : null;
      const scanned = enabled && cachePath ? scanLocalMarketplace(name, cachePath) : [];
      const packages = scanned.map((pkg) => ({
        ...pkg,
        sourceType: "git" as const,
      }));

      marketplaces.push({
        name,
        source,
        sourceType,
        packages,
        enabled,
        builtIn: false,
      });
    }
  }

  return marketplaces;
}

export function getAllPiPackages(marketplaces: PiMarketplace[]): PiPackage[] {
  const allPackages: PiPackage[] = [];
  for (const marketplace of marketplaces) {
    allPackages.push(...marketplace.packages);
  }
  return allPackages;
}

interface NpmPackageDetail {
  name: string;
  description?: string;
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, {
    description?: string;
    keywords?: string[];
    homepage?: string;
    repository?: string | { url?: string };
    author?: string | { name?: string };
    license?: string;
    pi?: {
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };
  }>;
  readme?: string;
}

export async function fetchNpmPackageDetails(packageName: string): Promise<Partial<PiPackage> | null> {
  try {
    const name = packageName.startsWith("npm:") ? packageName.slice(4) : packageName;

    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      return null;
    }

    const data: NpmPackageDetail = await response.json();
    const latestVersion = data["dist-tags"]?.latest;
    const versionData = latestVersion ? data.versions?.[latestVersion] : undefined;
    const piManifest = versionData?.pi;

    const result: Partial<PiPackage> = {};

    if (latestVersion) result.version = latestVersion;

    const description = data.description || versionData?.description;
    if (description) result.description = description;

    if (versionData?.homepage) result.homepage = versionData.homepage;

    const repository = typeof versionData?.repository === "string"
      ? versionData.repository
      : versionData?.repository?.url;
    if (repository) result.repository = repository;

    const author = typeof versionData?.author === "string"
      ? versionData.author
      : versionData?.author?.name;
    if (author) result.author = author;

    if (versionData?.license) result.license = versionData.license;

    result.extensions = piManifest?.extensions ?? [];
    result.skills = piManifest?.skills ?? [];
    result.prompts = piManifest?.prompts ?? [];
    result.themes = piManifest?.themes ?? [];

    return result;
  } catch {
    return null;
  }
}

export interface PiPackageStats {
  total: number;
  installed: number;
  notInstalled: number;
  hasUpdate: number;
}

export function getPiPackageStats(packages: PiPackage[]): PiPackageStats {
  return {
    total: packages.length,
    installed: packages.filter((p) => p.installed).length,
    notInstalled: packages.filter((p) => !p.installed).length,
    hasUpdate: packages.filter((p) => p.hasUpdate).length,
  };
}
