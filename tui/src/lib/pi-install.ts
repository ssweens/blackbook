import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import type { PiPackage } from "./types.js";

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
