import { spawn } from "child_process";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { getToolRegistryEntry, type ToolRegistryEntry } from "./tool-registry.js";
import type { PackageManager } from "./types.js";

const execFileAsync = promisify(execFile);

export type ProgressEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "done"; exitCode: number }
  | { type: "timeout"; timeoutMs: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export type ToolLifecycleAction = "install" | "update" | "uninstall";

export function buildInstallCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] } {
  if (pm === "npm") return { cmd: "npm", args: ["install", "-g", pkg] };
  if (pm === "pnpm") return { cmd: "pnpm", args: ["add", "-g", pkg] };
  return { cmd: "bun", args: ["add", "-g", pkg] };
}

export function buildUpdateCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] } {
  if (pm === "npm") return { cmd: "npm", args: ["update", "-g", pkg] };
  if (pm === "pnpm") return { cmd: "pnpm", args: ["update", "-g", pkg] };
  return { cmd: "bun", args: ["update", "-g", pkg] };
}

export function buildUninstallCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] } {
  if (pm === "npm") return { cmd: "npm", args: ["uninstall", "-g", pkg] };
  if (pm === "pnpm") return { cmd: "pnpm", args: ["remove", "-g", pkg] };
  return { cmd: "bun", args: ["remove", "-g", pkg] };
}

async function ensureCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function resolveLifecycleCommand(
  entry: ToolRegistryEntry,
  action: ToolLifecycleAction,
  packageManager: PackageManager
): { cmd: string; args: string[] } {
  const lifecycleAction = entry.lifecycle?.[action];

  if (lifecycleAction?.strategy === "native") {
    if (!lifecycleAction.command) {
      throw new Error(`${entry.toolId} lifecycle.${action} is native but no command is configured`);
    }
    return {
      cmd: lifecycleAction.command.cmd,
      args: lifecycleAction.command.args,
    };
  }

  if (action === "install") {
    return buildInstallCommand(packageManager, entry.npmPackage);
  }
  if (action === "update") {
    return buildUpdateCommand(packageManager, entry.npmPackage);
  }
  return buildUninstallCommand(packageManager, entry.npmPackage);
}

export function getToolLifecycleCommand(
  toolId: string,
  action: ToolLifecycleAction,
  packageManager: PackageManager
): { cmd: string; args: string[] } | null {
  const registryEntry = getToolRegistryEntry(toolId);
  if (!registryEntry) return null;
  try {
    return resolveLifecycleCommand(registryEntry, action, packageManager);
  } catch {
    return null;
  }
}

export type InstallMethod = PackageManager | "brew" | "unknown";

export interface InstallMethodMismatch {
  preferred: PackageManager;
  detectedMethods: InstallMethod[];
  message: string;
}

async function isInstalledWithNpm(pkg: string): Promise<boolean> {
  try {
    const result = await execFileAsync("npm", ["ls", "-g", pkg, "--depth=0", "--parseable"], { timeout: 15000 });
    return (result.stdout || "").trim().length > 0;
  } catch {
    return false;
  }
}

async function isInstalledWithPnpm(pkg: string): Promise<boolean> {
  try {
    const result = await execFileAsync("pnpm", ["ls", "-g", pkg, "--depth=0", "--parseable"], { timeout: 15000 });
    return (result.stdout || "").trim().length > 0;
  } catch {
    return false;
  }
}

function isInstalledWithBun(pkg: string): boolean {
  const packagePath = join(homedir(), ".bun", "install", "global", "node_modules", ...pkg.split("/"));
  return existsSync(packagePath);
}

async function detectPackageManagersForTool(entry: ToolRegistryEntry): Promise<PackageManager[]> {
  const checks = await Promise.all([
    isInstalledWithNpm(entry.npmPackage),
    isInstalledWithPnpm(entry.npmPackage),
  ]);

  const managers: PackageManager[] = [];
  if (checks[0]) managers.push("npm");
  if (checks[1]) managers.push("pnpm");
  if (isInstalledWithBun(entry.npmPackage)) managers.push("bun");
  return managers;
}

function detectBinaryInstallMethod(binaryPath: string | null | undefined): InstallMethod | null {
  if (!binaryPath) return null;
  if (binaryPath.startsWith("/opt/homebrew/") || binaryPath.startsWith("/usr/local/")) {
    return "brew";
  }
  return "unknown";
}

export async function detectInstallMethodMismatch(
  toolId: string,
  preferredPackageManager: PackageManager,
  binaryPath: string | null | undefined
): Promise<InstallMethodMismatch | null> {
  const entry = getToolRegistryEntry(toolId);
  if (!entry) return null;

  const installStrategy = entry.lifecycle?.install?.strategy ?? "package-manager";
  if (installStrategy !== "package-manager") {
    return null;
  }

  const detectedPackageManagers = await detectPackageManagersForTool(entry);
  const binaryMethod = detectBinaryInstallMethod(binaryPath);

  const detectedMethods: InstallMethod[] = [
    ...(binaryMethod ? [binaryMethod] : []),
    ...detectedPackageManagers,
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  if (detectedMethods.length === 0) {
    return null;
  }

  if (detectedMethods.length === 1 && detectedMethods[0] === preferredPackageManager) {
    return null;
  }

  return {
    preferred: preferredPackageManager,
    detectedMethods,
    message: `Detected current install method: ${detectedMethods.join(", ")}. Preferred method is ${preferredPackageManager}. Press m to migrate methods, or Enter to continue without migration.`,
  };
}

async function runLifecycleCommand(
  command: { cmd: string; args: string[] },
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 300000;

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command.cmd, command.args, { stdio: ["inherit", "pipe", "pipe"] });
    let finished = false;
    let timedOut = false;
    let cancelled = false;

    const timeoutId = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      onProgress({ type: "timeout", timeoutMs });
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 1500);
    }, timeoutMs);

    const onAbort = () => {
      if (finished) return;
      cancelled = true;
      onProgress({ type: "cancelled" });
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 1500);
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        onProgress({ type: "cancelled" });
        resolve(false);
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      onProgress({ type: "stdout", data: String(chunk) });
    });

    child.stderr.on("data", (chunk) => {
      onProgress({ type: "stderr", data: String(chunk) });
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      onProgress({ type: "error", message: error.message });
      resolve(false);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      onProgress({ type: "done", exitCode: code ?? 1 });
      resolve(!timedOut && !cancelled && code === 0);
    });
  });
}

export interface ToolLifecycleOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function runToolCommand(
  toolId: string,
  packageManager: PackageManager,
  action: ToolLifecycleAction,
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<boolean> {
  const registryEntry = getToolRegistryEntry(toolId);
  if (!registryEntry) {
    onProgress({ type: "error", message: `Unknown tool: ${toolId}` });
    return false;
  }

  let command: { cmd: string; args: string[] };
  try {
    command = resolveLifecycleCommand(registryEntry, action, packageManager);
  } catch (error) {
    onProgress({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return false;
  }

  const commandAvailable = await ensureCommandAvailable(command.cmd);
  if (!commandAvailable) {
    onProgress({ type: "error", message: `Command not installed: ${command.cmd}` });
    return false;
  }

  return runLifecycleCommand(command, onProgress, options);
}

async function runBestEffortCommand(
  command: { cmd: string; args: string[] },
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<void> {
  const available = await ensureCommandAvailable(command.cmd);
  if (!available) {
    return;
  }

  onProgress({ type: "stdout", data: `cleanup: ${command.cmd} ${command.args.join(" ")}` });
  await runLifecycleCommand(command, onProgress, options);
}

export async function reinstallTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<boolean> {
  const registryEntry = getToolRegistryEntry(toolId);
  if (!registryEntry) {
    onProgress({ type: "error", message: `Unknown tool: ${toolId}` });
    return false;
  }

  const cleanupCommands = registryEntry.lifecycle?.migration_cleanup ?? [];
  for (const cleanupCommand of cleanupCommands) {
    await runBestEffortCommand(cleanupCommand, onProgress, options);
  }

  await runToolCommand(toolId, packageManager, "uninstall", onProgress, options);
  return runToolCommand(toolId, packageManager, "install", onProgress, options);
}

export async function installTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, "install", onProgress, options);
}

export async function updateTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, "update", onProgress, options);
}

export async function uninstallTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: ToolLifecycleOptions
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, "uninstall", onProgress, options);
}
