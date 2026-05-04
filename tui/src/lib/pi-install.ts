import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import type { PiPackage, PackageManager } from "./types.js";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Pi CLI Detection
// ─────────────────────────────────────────────────────────────────────────────

export async function isPiCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("pi", ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Install/Remove/Update
// ─────────────────────────────────────────────────────────────────────────────

export interface PiInstallResult {
  success: boolean;
  error?: string;
}

function npmPackageNameFromSource(source: string): string | null {
  if (!source.startsWith("npm:")) return null;
  const name = source.slice(4).trim();
  return name.length > 0 ? name : null;
}

async function removeGlobalPackage(manager: PackageManager, packageName: string): Promise<void> {
  if (manager === "bun") {
    await execFileAsync("bun", ["remove", "-g", packageName], { timeout: 60000 });
    return;
  }
  if (manager === "pnpm") {
    await execFileAsync("pnpm", ["remove", "-g", packageName], { timeout: 60000 });
    return;
  }
  await execFileAsync("npm", ["uninstall", "-g", packageName], { timeout: 60000 });
}

async function installGlobalLatestPackage(manager: PackageManager, packageName: string): Promise<void> {
  if (manager === "bun") {
    await execFileAsync("bun", ["add", "-g", `${packageName}@latest`], { timeout: 60000 });
    return;
  }
  if (manager === "pnpm") {
    await execFileAsync("pnpm", ["add", "-g", `${packageName}@latest`], { timeout: 60000 });
    return;
  }
  await execFileAsync("npm", ["install", "-g", `${packageName}@latest`], { timeout: 60000 });
}

/**
 * Get the source to pass to Pi CLI.
 * For local packages, returns an absolute path so Pi stores absolute paths in settings.json.
 */
function getPiSource(pkg: PiPackage): string {
  // For local packages (not npm: or git:), use absolute path
  if (
    pkg.sourceType === "local" &&
    !pkg.source.startsWith("npm:") &&
    !pkg.source.startsWith("git:") &&
    !pkg.source.startsWith("https://")
  ) {
    return resolve(pkg.source);
  }
  return pkg.source;
}

export async function installPiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    const source = getPiSource(pkg);
    await execFileAsync("pi", ["install", source], { timeout: 60000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function removePiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    const source = getPiSource(pkg);
    await execFileAsync("pi", ["remove", source], { timeout: 30000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function updatePiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    const source = getPiSource(pkg);
    await execFileAsync("pi", ["update", source], { timeout: 60000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function repairPiPackageManager(
  pkg: PiPackage,
  options: { from: PackageManager; to: PackageManager },
): Promise<PiInstallResult> {
  try {
    const packageName = npmPackageNameFromSource(pkg.source);
    if (!packageName) {
      return { success: false, error: "Repair is only supported for npm: sources" };
    }

    if (options.from !== options.to) {
      await removeGlobalPackage(options.from, packageName);
    }
    await installGlobalLatestPackage(options.to, packageName);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
