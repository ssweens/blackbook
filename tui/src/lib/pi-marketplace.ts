import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import type { PiPackage, PiMarketplace, PiSettings, PiPackageSourceType } from "./types.js";
import { getPiMarketplaces, getDisabledPiMarketplaces } from "./config.js";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Pi Settings (installed packages)
// ─────────────────────────────────────────────────────────────────────────────

const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export function loadPiSettings(): PiSettings {
  try {
    if (!existsSync(PI_SETTINGS_PATH)) {
      return { packages: [] };
    }
    const content = readFileSync(PI_SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(content);
    return {
      packages: Array.isArray(settings.packages) ? settings.packages : [],
    };
  } catch {
    return { packages: [] };
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
  if (source.startsWith("npm:")) return "npm";
  if (source.startsWith("git:") || source.startsWith("https://github.com")) return "git";
  return "local";
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
    }
    // TODO: git marketplace support
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
