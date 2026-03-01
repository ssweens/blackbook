import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadConfig } from "./config/loader.js";
import { saveConfig } from "./config/writer.js";
import { getCacheDir, getConfigDir, expandPath } from "./config/path.js";

const execFileAsync = promisify(execFile);


export interface SetupSourceResult {
  sourceRepo: string;
  cloned: boolean;
  importedConfig: boolean;
  importedConfigPath?: string;
}

function isLikelyGitSource(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.startsWith("git@") ||
    trimmed.startsWith("ssh://") ||
    trimmed.startsWith("git://") ||
    trimmed.endsWith(".git") ||
    /^https:\/\/github\.com\//.test(trimmed)
  );
}

function inferRepoName(input: string): string {
  const cleaned = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const tail = cleaned.split(/[/:]/).filter(Boolean).pop();
  return tail || "blackbook-source";
}

function defaultClonePath(repoName: string): string {
  return join(getCacheDir(), "source_repos", repoName);
}

function findSourceConfigPath(sourceDir: string): string | null {
  const candidates = [
    join(sourceDir, "config.yaml"),
    join(sourceDir, "blackbook", "config.yaml"),
    join(sourceDir, ".blackbook", "config.yaml"),
    join(sourceDir, "config", "blackbook", "config.yaml"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function ensureGitClone(source: string): Promise<{ path: string; cloned: boolean }> {
  const repoName = inferRepoName(source);
  const targetPath = defaultClonePath(repoName);

  if (existsSync(targetPath)) {
    const entries = readdirSync(targetPath);
    if (entries.length > 0) {
      // Pull latest changes
      await execFileAsync("git", ["pull"], { cwd: targetPath, timeout: 120000 }).catch(() => {
        // Pull failed (offline, etc.) — continue with existing checkout
      });
      return { path: targetPath, cloned: false };
    }
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await execFileAsync("git", ["clone", source, targetPath], { timeout: 120000 });
  return { path: targetPath, cloned: true };
}

function importConfigFromSource(sourceConfigPath: string, sourceRepo: string): void {
  const configDir = getConfigDir();
  const targetConfigPath = join(configDir, "config.yaml");
  mkdirSync(configDir, { recursive: true });

  const sourceContent = readFileSync(sourceConfigPath, "utf-8");
  writeFileSync(targetConfigPath, sourceContent);

  const { config } = loadConfig(targetConfigPath);
  let changed = false;

  if (!config.settings.source_repo) {
    config.settings.source_repo = sourceRepo;
    changed = true;
  }

  // Auto-detect marketplace.json in source repo and add if not already present
  if (ensureSourceRepoMarketplace(config, sourceRepo)) {
    changed = true;
  }

  if (changed) {
    saveConfig(config, targetConfigPath);
  }

  const sourceLocalPath = join(dirname(sourceConfigPath), "config.local.yaml");
  if (existsSync(sourceLocalPath)) {
    const targetLocalPath = join(configDir, "config.local.yaml");
    writeFileSync(targetLocalPath, readFileSync(sourceLocalPath, "utf-8"));
  }
}

/**
 * Check if the source repo has a marketplace.json and add it to the config
 * if not already present. Returns true if config was modified.
 */
function ensureSourceRepoMarketplace(config: ReturnType<typeof loadConfig>["config"], sourceRepo: string): boolean {
  // Look for marketplace.json in the source repo
  const candidates = [
    join(sourceRepo, ".claude-plugin", "marketplace.json"),
    join(sourceRepo, "marketplace.json"),
  ];

  let marketplacePath: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      marketplacePath = candidate;
      break;
    }
  }
  if (!marketplacePath) return false;

  // Try to read the marketplace name
  let marketplaceName = inferRepoName(sourceRepo);
  try {
    const content = JSON.parse(readFileSync(marketplacePath, "utf-8"));
    if (content.name) marketplaceName = content.name;
  } catch {
    // Use inferred name
  }

  // Check if this repo's marketplace is already in the config
  const repoUrl = getRepoRemoteUrl(sourceRepo);
  const existingUrls = Object.values(config.marketplaces);
  
  // Check by URL match (handles both raw github URLs and local paths)
  const alreadyPresent = existingUrls.some((url) => {
    if (repoUrl && url.includes(repoUrl)) return true;
    if (url.startsWith(sourceRepo) || url.includes(marketplaceName)) return true;
    return false;
  });

  if (alreadyPresent) return false;

  // Build the marketplace URL
  let marketplaceUrl: string;
  if (repoUrl) {
    // Convert git remote to raw GitHub URL
    const match = repoUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (match) {
      const relativePath = marketplacePath.replace(sourceRepo, "").replace(/^\//, "");
      marketplaceUrl = `https://raw.githubusercontent.com/${match[1]}/main/${relativePath}`;
    } else {
      marketplaceUrl = marketplacePath; // Local path fallback
    }
  } else {
    marketplaceUrl = marketplacePath; // Local path
  }

  config.marketplaces[marketplaceName] = marketplaceUrl;
  return true;
}

/**
 * Get the remote origin URL for a git repo, or null if not a git repo.
 */
function getRepoRemoteUrl(repoPath: string): string | null {
  try {
    const { execFileSync } = require("child_process");
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

function updateSourceRepoInConfig(sourceRepo: string): void {
  const { config, configPath } = loadConfig();
  config.settings.source_repo = sourceRepo;
  ensureSourceRepoMarketplace(config, sourceRepo);
  saveConfig(config, configPath);
}

export async function setupSourceRepository(sourceInput: string): Promise<SetupSourceResult> {
  const trimmed = sourceInput.trim();
  if (!trimmed) {
    throw new Error("Source path or URL is required");
  }

  let sourceRepoPath = "";
  let cloned = false;

  if (isLikelyGitSource(trimmed)) {
    const cloneResult = await ensureGitClone(trimmed);
    sourceRepoPath = cloneResult.path;
    cloned = cloneResult.cloned;
  } else {
    const expanded = expandPath(trimmed);
    sourceRepoPath = expanded.startsWith("/") ? expanded : resolve(process.cwd(), expanded);
    if (!existsSync(sourceRepoPath)) {
      throw new Error(`Directory not found: ${sourceRepoPath}`);
    }
  }

  const sourceConfigPath = findSourceConfigPath(sourceRepoPath);
  if (sourceConfigPath) {
    importConfigFromSource(sourceConfigPath, sourceRepoPath);
    return {
      sourceRepo: sourceRepoPath,
      cloned,
      importedConfig: true,
      importedConfigPath: sourceConfigPath,
    };
  }

  updateSourceRepoInConfig(sourceRepoPath);
  return {
    sourceRepo: sourceRepoPath,
    cloned,
    importedConfig: false,
  };
}

/**
 * Pull latest changes for the configured source repo (if it's a git repo).
 * Safe to call frequently — silently no-ops if not a git repo or offline.
 */
export async function pullSourceRepo(): Promise<void> {
  const { config, configPath } = loadConfig();
  const sourceRepo = config.settings.source_repo;
  if (!sourceRepo) return;

  const repoPath = expandPath(sourceRepo);
  if (!existsSync(join(repoPath, ".git"))) return;

  await execFileAsync("git", ["pull"], { cwd: repoPath, timeout: 120000 }).catch(() => {
    // Offline, not a git repo, etc. — silently continue
  });

  // After pull, ensure marketplace is registered if repo has one
  if (ensureSourceRepoMarketplace(config, repoPath)) {
    saveConfig(config, configPath);
  }
}

export function shouldShowSourceSetupWizard(): boolean {
  const { config } = loadConfig();
  return !config.settings.source_repo;
}
