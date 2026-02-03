import { execFile } from "child_process";
import { promisify } from "util";
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

export async function installPiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    await execFileAsync("pi", ["install", pkg.source], { timeout: 60000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function removePiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    await execFileAsync("pi", ["remove", pkg.source], { timeout: 30000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function updatePiPackage(pkg: PiPackage): Promise<PiInstallResult> {
  try {
    await execFileAsync("pi", ["update", pkg.source], { timeout: 60000 });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
