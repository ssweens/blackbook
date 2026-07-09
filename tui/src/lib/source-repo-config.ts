import { existsSync, mkdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type BlackbookConfig } from "./config/schema.js";
import { loadConfig as loadYamlConfig } from "./config/loader.js";
import { getCacheDir } from "./config.js";
import { expandPath as expandConfigPath } from "./config/path.js";
import { normalizePiPackageSource } from "./marketplace.js";
import type { PiPackageSpec } from "./types.js";

const execFileAsync = promisify(execFile);

export function isRemoteSourceRepo(sourceRepo: string): boolean {
  const s = sourceRepo.trim();
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("git@") ||
    s.startsWith("ssh://") ||
    s.startsWith("git://")
  );
}

export type SourceRepoConfigLoad = {
  config: BlackbookConfig;
  configPath: string;
  isRemote: boolean;
};

const sourceRepoPiPackagesMemoryCache = new Map<string, PiPackageSpec[]>();

/** Drop a cached remote pi_packages entry so the next read re-fetches. */
export function invalidateSourceRepoPiPackagesCache(sourceRepo: string): void {
  sourceRepoPiPackagesMemoryCache.delete(sourceRepo);
}

function githubRawConfigCandidates(sourceRepo: string): string[] {
  const trimmed = sourceRepo.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/);
  const owner = sshMatch?.[1] ?? httpsMatch?.[1];
  const repo = sshMatch?.[2] ?? httpsMatch?.[2];
  if (!owner || !repo) return [];
  return [
    `https://raw.githubusercontent.com/${owner}/${repo}/main/config/blackbook/config.yaml`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/config/blackbook/config.yaml`,
  ];
}

async function fetchRemoteSourceRepoPiPackages(sourceRepo: string): Promise<PiPackageSpec[]> {
  if (sourceRepoPiPackagesMemoryCache.has(sourceRepo)) {
    return sourceRepoPiPackagesMemoryCache.get(sourceRepo)!;
  }

  const candidates = githubRawConfigCandidates(sourceRepo);
  if (candidates.length === 0) {
    throw new Error(`Unsupported remote source_repo for pi_packages reads: ${sourceRepo}`);
  }

  let lastError: string | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = `${res.status} ${res.statusText}`;
        continue;
      }
      const text = await res.text();
      const parsed = parseYaml(text);
      const validated = ConfigSchema.safeParse(parsed ?? {});
      if (!validated.success) {
        lastError = validated.error.issues[0]?.message ?? "invalid config schema";
        continue;
      }
      const specs = validated.data.pi_packages;
      sourceRepoPiPackagesMemoryCache.set(sourceRepo, specs);
      return specs;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Failed to fetch remote pi_packages from ${sourceRepo}: ${lastError ?? "unknown error"}`);
}

export async function loadDesiredPiPackageSpecs(): Promise<PiPackageSpec[]> {
  const result = loadYamlConfig();
  if (result.errors.length > 0) return [];
  const sourceRepo = result.config.settings.source_repo;
  if (!sourceRepo) return [];

  if (!isRemoteSourceRepo(sourceRepo)) {
    const sourceRepoConfigPath = getSourceRepoBlackbookConfigPath(result.config);
    if (!sourceRepoConfigPath || !existsSync(sourceRepoConfigPath)) {
      return [];
    }

    const sourceRepoResult = loadYamlConfig(sourceRepoConfigPath);
    if (sourceRepoResult.errors.length > 0) return [];
    return sourceRepoResult.config.pi_packages;
  }

  try {
    return await fetchRemoteSourceRepoPiPackages(sourceRepo);
  } catch {
    return [];
  }
}

export function getSourceRepoBlackbookConfigPath(config: ReturnType<typeof loadYamlConfig>["config"]): string | null {
  const sourceRepo = config.settings.source_repo;
  if (!sourceRepo || isRemoteSourceRepo(sourceRepo)) return null;
  return join(expandConfigPath(sourceRepo), "config", "blackbook", "config.yaml");
}

export async function prepareWritableSourceRepoConfig(config: ReturnType<typeof loadYamlConfig>["config"]): Promise<SourceRepoConfigLoad | null> {
  const sourceRepo = config.settings.source_repo;
  if (!sourceRepo) return null;

  if (!isRemoteSourceRepo(sourceRepo)) {
    const localPath = join(expandConfigPath(sourceRepo), "config", "blackbook", "config.yaml");
    if (!existsSync(localPath)) return null;
    const localResult = loadYamlConfig(localPath);
    if (localResult.errors.length > 0) return null;
    return { config: localResult.config, configPath: localResult.configPath, isRemote: false };
  }

  const workspace = join(getCacheDir(), "source_repo_writes", normalizePiPackageSource(sourceRepo).replace(/[^a-z0-9-]+/gi, "-"));
  // Async git so the Ink TUI keeps rendering/handling input during clone/pull
  // (these can each block for up to two minutes on a slow network).
  if (!existsSync(workspace)) {
    mkdirSync(dirname(workspace), { recursive: true });
    await execFileAsync("git", ["clone", sourceRepo, workspace], { encoding: "utf-8", timeout: 120000 });
  } else {
    await execFileAsync("git", ["-C", workspace, "pull", "--rebase"], { encoding: "utf-8", timeout: 120000 });
  }

  const configPath = join(workspace, "config", "blackbook", "config.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Remote source_repo missing config/blackbook/config.yaml: ${sourceRepo}`);
  }
  const loaded = loadYamlConfig(configPath);
  if (loaded.errors.length > 0) {
    throw new Error(`Remote source_repo config invalid: ${loaded.errors[0].message}`);
  }
  return { config: loaded.config, configPath, isRemote: true };
}

export async function commitAndPushWritableSourceRepo(sourceConfigPath: string, message: string): Promise<void> {
  const sourceRepo = sourceConfigPath.replace(/\/config\/blackbook\/config\.yaml$/, "");
  await execFileAsync("git", ["-C", sourceRepo, "add", sourceConfigPath], { encoding: "utf-8", timeout: 10000 });
  try {
    await execFileAsync("git", ["-C", sourceRepo, "commit", "-m", message], { encoding: "utf-8", timeout: 15000 });
  } catch {
    // no-op if nothing changed
  }
  await execFileAsync("git", ["-C", sourceRepo, "push"], { encoding: "utf-8", timeout: 45000 });
}

export function removePiPackageSpec(source: string, specs: PiPackageSpec[]): { specs: PiPackageSpec[]; removed: boolean } {
  const sourceKey = normalizePiPackageSource(source);
  const specsAfterDelete = specs.filter((entry) => normalizePiPackageSource(entry.source) !== sourceKey);
  return { specs: specsAfterDelete, removed: specsAfterDelete.length < specs.length };
}
