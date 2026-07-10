import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { getGlobalPiPackageInstallInfo } from "./marketplace.js";
import type { PackageManager, PiPackage } from "./types.js";

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

function isNoMatchingPiPackageError(message: string): boolean {
  return /No matching package found/i.test(message);
}

function getNpmPackageName(pkg: PiPackage): string {
  if (pkg.name) return pkg.name;
  const source = pkg.source.startsWith("npm:") ? pkg.source.slice(4) : pkg.source;
  if (source.startsWith("@")) {
    const lastAt = source.lastIndexOf("@");
    return lastAt > source.indexOf("/") ? source.slice(0, lastAt) : source;
  }
  const firstAt = source.indexOf("@");
  return firstAt > 0 ? source.slice(0, firstAt) : source;
}

function getUninstallCommand(manager: PackageManager, packageName: string): { command: string; args: string[] } {
  if (manager === "bun") return { command: "bun", args: ["remove", "-g", packageName] };
  if (manager === "pnpm") return { command: "pnpm", args: ["remove", "--global", packageName] };
  if (manager === "pi") return { command: "pi", args: ["remove", packageName] };
  return { command: "npm", args: ["uninstall", "-g", packageName] };
}

async function removeNpmPackageFromDetectedManagers(packageName: string): Promise<string[]> {
  const errors: string[] = [];
  const detected = getGlobalPiPackageInstallInfo().get(packageName);
  const managers = detected?.viaManagers ?? [];

  for (const manager of managers) {
    const { command, args } = getUninstallCommand(manager, packageName);
    try {
      await execFileAsync(command, args, { timeout: 60000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${manager}: ${message}`);
    }
  }

  return errors;
}

export async function removePiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  const source = getPiSource(pkg);

  if (pkg.sourceType !== "npm") {
    try {
      await execFileAsync("pi", ["remove", source], { timeout: 30000 });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  const packageName = getNpmPackageName(pkg);
  let piRemoveError: string | undefined;

  try {
    await execFileAsync("pi", ["remove", source], { timeout: 30000 });
  } catch (error) {
    piRemoveError = error instanceof Error ? error.message : String(error);
  }

  const managerErrors = await removeNpmPackageFromDetectedManagers(packageName);
  const stillDetected = getGlobalPiPackageInstallInfo().get(packageName);
  if (stillDetected) {
    const via = stillDetected.viaManagers.join(", ");
    const details = managerErrors.length > 0 ? ` (${managerErrors.join("; ")})` : "";
    return { success: false, error: `Package still appears installed via ${via}${details}` };
  }

  if (piRemoveError && !isNoMatchingPiPackageError(piRemoveError) && managerErrors.length > 0) {
    return { success: false, error: `${piRemoveError}; ${managerErrors.join("; ")}` };
  }

  if (piRemoveError && !isNoMatchingPiPackageError(piRemoveError) && managerErrors.length === 0) {
    return { success: false, error: piRemoveError };
  }

  if (managerErrors.length > 0) {
    return { success: false, error: managerErrors.join("; ") };
  }

  return { success: true };
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

/**
 * Re-install a Pi package, potentially switching package managers.
 */
export async function repairPiPackageManager(
  pkg: PiPackage,
  _opts: { from: string; to: string },
): Promise<PiInstallResult> {
  try {
    const source = getPiSource(pkg);
    await execFileAsync("pi", ["install", source], { timeout: 120000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
