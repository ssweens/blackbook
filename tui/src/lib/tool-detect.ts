import { execFile } from "child_process";
import { promisify } from "util";
import { TOOL_REGISTRY, type ToolRegistryEntry } from "./tool-registry.js";
import type { PackageManager, ToolDetectionResult } from "./types.js";

const execFileAsync = promisify(execFile);

function parseVersion(raw: string): string | null {
  const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

export function isNewerVersion(installed: string, latest: string): boolean {
  const left = parseSemver(installed);
  const right = parseSemver(latest);
  if (!left || !right) return false;

  if (right[0] !== left[0]) return right[0] > left[0];
  if (right[1] !== left[1]) return right[1] > left[1];
  return right[2] > left[2];
}

export async function detectToolBinary(
  entry: ToolRegistryEntry
): Promise<{ installed: boolean; version: string | null; path: string | null; error: string | null }> {
  try {
    const whichResult = await execFileAsync("which", [entry.binaryName], { timeout: 5000 });
    const binaryPath = (whichResult.stdout || "").trim();
    if (!binaryPath) {
      return { installed: false, version: null, path: null, error: null };
    }

    try {
      const versionResult = await execFileAsync(entry.binaryName, entry.versionArgs, { timeout: 20000 });
      const combined = `${versionResult.stdout || ""} ${versionResult.stderr || ""}`.trim();
      return {
        installed: true,
        version: parseVersion(combined),
        path: binaryPath,
        error: null,
      };
    } catch {
      return {
        installed: true,
        version: null,
        path: binaryPath,
        error: null,
      };
    }
  } catch {
    return { installed: false, version: null, path: null, error: null };
  }
}

function getViewCommand(pm: PackageManager): { cmd: string; argsPrefix: string[] } {
  if (pm === "pnpm") return { cmd: "pnpm", argsPrefix: ["view"] };
  return { cmd: "npm", argsPrefix: ["view"] };
}

export async function fetchLatestVersion(
  npmPackage: string,
  packageManager: PackageManager
): Promise<string | null> {
  const { cmd, argsPrefix } = getViewCommand(packageManager);

  try {
    await execFileAsync("which", [cmd], { timeout: 5000 });
  } catch {
    return null;
  }

  try {
    const result = await execFileAsync(cmd, [...argsPrefix, npmPackage, "version"], { timeout: 15000 });
    const version = parseVersion((result.stdout || "").trim()) || (result.stdout || "").trim();
    return version || null;
  } catch {
    return null;
  }
}

export async function detectTool(
  entry: ToolRegistryEntry,
  packageManager: PackageManager
): Promise<ToolDetectionResult> {
  const binaryResult = await detectToolBinary(entry);
  const latestVersion = await fetchLatestVersion(entry.npmPackage, packageManager);

  const hasUpdate = Boolean(
    binaryResult.version && latestVersion && isNewerVersion(binaryResult.version, latestVersion)
  );

  return {
    toolId: entry.toolId,
    installed: binaryResult.installed,
    binaryPath: binaryResult.path,
    installedVersion: binaryResult.version,
    latestVersion,
    hasUpdate,
    error: binaryResult.error,
  };
}

export async function detectAllTools(
  packageManager: PackageManager
): Promise<Record<string, ToolDetectionResult>> {
  const entries = Object.values(TOOL_REGISTRY);
  const results = await Promise.all(entries.map((entry) => detectTool(entry, packageManager)));
  const byToolId: Record<string, ToolDetectionResult> = {};

  for (const result of results) {
    byToolId[result.toolId] = result;
  }

  return byToolId;
}
