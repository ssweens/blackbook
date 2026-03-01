import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, mkdirSync, lstatSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { PiPackage, PiMarketplace, PiSettings, PiPackageSourceType } from "./types.js";
import { getPiMarketplaces, getDisabledPiMarketplaces, getCacheDir } from "./config.js";

const execFileAsync = promisify(execFile);

// Synchronous execFile for initial load
import { execFileSync as execSync } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Pi Settings (installed packages)
// ─────────────────────────────────────────────────────────────────────────────

const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export function loadPiSettings(): PiSettings {
  const packages: string[] = [];

  // Read from Pi settings.json (packages array)
  try {
    if (existsSync(PI_SETTINGS_PATH)) {
      const content = readFileSync(PI_SETTINGS_PATH, "utf-8");
      const settings = JSON.parse(content);
      if (Array.isArray(settings.packages)) {
        packages.push(...settings.packages);
      }
    }
  } catch {
    // Ignore errors
  }

  // Scan global node_modules for npm-installed Pi packages
  const npmPackages = scanGlobalNpmForPiPackages();
  for (const pkgName of npmPackages) {
    const source = `npm:${pkgName}`;
    if (!packages.includes(source)) {
      packages.push(source);
    }
  }

  return { packages };
}

/**
 * Scan global node_modules for packages that are Pi extensions.
 * A package is a Pi extension if it has:
 * - `pi.extensions` in package.json, OR
 * - `keywords` containing "pi-package"
 */
function scanGlobalNpmForPiPackages(): string[] {
  const packages: string[] = [];

  // Get global node_modules path via npm root -g
  let globalNodeModules: string;
  try {
    const result = execSync("npm", ["root", "-g"], { encoding: "utf-8", timeout: 5000 });
    globalNodeModules = result.trim();
    if (!existsSync(globalNodeModules)) return [];
  } catch {
    return [];
  }

  try {
    const entries = readdirSync(globalNodeModules);
    for (const entry of entries) {
      // Skip hidden dirs and node_modules itself
      if (entry.startsWith(".")) continue;
      if (entry === "node_modules") continue;

      const entryPath = join(globalNodeModules, entry);

      // Handle scoped packages (@scope/package)
      if (entry.startsWith("@")) {
        try {
          const scopedEntries = readdirSync(entryPath);
          for (const scopedPkg of scopedEntries) {
            const pkgPath = join(entryPath, scopedPkg);
            if (isPiPackageDir(pkgPath)) {
              packages.push(`${entry}/${scopedPkg}`);
            }
          }
        } catch {
          // Ignore errors reading scoped dir
        }
        continue;
      }

      // Regular package
      if (isPiPackageDir(entryPath)) {
        packages.push(entry);
      }
    }
  } catch {
    // Ignore errors
  }

  return packages;
}

/**
 * Check if a directory is a Pi package by examining its package.json.
 */
function isPiPackageDir(pkgPath: string): boolean {
  const pkgJsonPath = join(pkgPath, "package.json");
  if (!existsSync(pkgJsonPath)) return false;

  try {
    const content = readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    // Check for pi.extensions
    if (pkg.pi?.extensions && Array.isArray(pkg.pi.extensions) && pkg.pi.extensions.length > 0) {
      return true;
    }

    // Check for pi-package keyword
    if (Array.isArray(pkg.keywords) && pkg.keywords.includes("pi-package")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve a package path to absolute path for comparison.
 * Handles relative paths (relative to PI_SETTINGS_PATH dir) and absolute paths.
 */
function resolvePackagePath(source: string): string {
  // Only resolve local paths (not npm: or git: sources)
  if (source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("https://")) {
    return source;
  }
  
  // If already absolute, return as-is
  if (source.startsWith("/")) {
    try {
      return realpathSync(source);
    } catch {
      return source;
    }
  }
  
  // Relative path - resolve from Pi agent directory
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
  return settings.packages.some((pkg) => {
    const normalizedPkg = resolvePackagePath(pkg).toLowerCase();
    return normalizedPkg === normalizedSource;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Type Detection
// ─────────────────────────────────────────────────────────────────────────────

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
  } catch (error) {
    console.error(`Failed to cache Pi git marketplace ${source}:`, error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// npm Marketplace (via Registry API for popularity data)
// ─────────────────────────────────────────────────────────────────────────────

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
    // Use npm registry API directly for more results and popularity data
    const response = await fetch(
      "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250",
      { signal: AbortSignal.timeout(30000) }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: NpmRegistryResult = await response.json();
    const settings = loadPiSettings();

    return data.objects.map((item): PiPackage => {
      const pkg = item.package;
      const source = `npm:${pkg.name}`;
      return {
        name: pkg.name,
        description: pkg.description ?? "",
        version: pkg.version ?? "unknown",
        source,
        sourceType: "npm",
        marketplace: "npm",
        installed: isPackageInstalled(source, settings),
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
  } catch (error) {
    console.error("Failed to fetch npm packages:", error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Marketplace
// ─────────────────────────────────────────────────────────────────────────────

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
  // Has pi manifest
  if (pkg.pi) return true;
  // Has pi-package keyword
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
      const files = readdirSync(dir);
      manifest[key] = files;
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

  // Expand ~ to home directory
  const expandedPath = dirPath.startsWith("~")
    ? join(homedir(), dirPath.slice(1))
    : resolve(dirPath);

  if (!existsSync(expandedPath)) {
    return packages;
  }

  try {
    const entries = readdirSync(expandedPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pkgDir = join(expandedPath, entry.name);
      const pkgJsonPath = join(pkgDir, "package.json");

      if (!existsSync(pkgJsonPath)) continue;

      try {
        const content = readFileSync(pkgJsonPath, "utf-8");
        const pkg: PackageJson = JSON.parse(content);

        if (!isPiPackage(pkg)) continue;

        // Get pi manifest or scan convention dirs
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

// ─────────────────────────────────────────────────────────────────────────────
// Load All Marketplaces
// ─────────────────────────────────────────────────────────────────────────────

export async function loadAllPiMarketplaces(): Promise<PiMarketplace[]> {
  const marketplaces: PiMarketplace[] = [];
  const disabledList = getDisabledPiMarketplaces();
  const isDisabled = (name: string) => disabledList.includes(name);

  // Always include npm marketplace (built-in, but can be disabled)
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

  // Load configured marketplaces
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

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Full Package Details (for detail view)
// ─────────────────────────────────────────────────────────────────────────────

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
    // Strip npm: prefix if present
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

    // Only include fields that have values (don't overwrite existing data with undefined)
    const result: Partial<PiPackage> = {};
    
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
    
    // Always include pi manifest arrays (empty is valid info)
    result.extensions = piManifest?.extensions ?? [];
    result.skills = piManifest?.skills ?? [];
    result.prompts = piManifest?.prompts ?? [];
    result.themes = piManifest?.themes ?? [];

    return result;
  } catch (error) {
    console.error(`Failed to fetch details for ${packageName}:`, error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Package Stats
// ─────────────────────────────────────────────────────────────────────────────

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
