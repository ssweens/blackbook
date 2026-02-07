import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { getToolRegistryEntry } from "./tool-registry.js";
import type { PackageManager } from "./types.js";

const execFileAsync = promisify(execFile);

export type ProgressEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "done"; exitCode: number }
  | { type: "timeout"; timeoutMs: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };

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

function buildInstallCommandForTool(
  toolId: string,
  packageManager: PackageManager,
  npmPackage: string
): { cmd: string; args: string[] } {
  if (toolId === "claude-code") {
    return { cmd: "bash", args: ["-lc", "curl -fsSL https://claude.ai/install.sh | bash"] };
  }
  return buildInstallCommand(packageManager, npmPackage);
}

function buildUpdateCommandForTool(
  toolId: string,
  packageManager: PackageManager,
  npmPackage: string
): { cmd: string; args: string[] } {
  if (toolId === "claude-code") {
    return { cmd: "claude", args: ["update"] };
  }
  if (toolId === "amp-code") {
    return { cmd: "amp", args: ["update"] };
  }
  if (toolId === "opencode") {
    return { cmd: "opencode", args: ["upgrade"] };
  }
  return buildUpdateCommand(packageManager, npmPackage);
}

async function runLifecycleCommand(
  command: { cmd: string; args: string[] },
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 300000;

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command.cmd, command.args, { stdio: ["ignore", "pipe", "pipe"] });
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

async function runToolCommand(
  toolId: string,
  packageManager: PackageManager,
  commandBuilder: (toolId: string, pm: PackageManager, pkg: string) => { cmd: string; args: string[] },
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  const registryEntry = getToolRegistryEntry(toolId);
  if (!registryEntry) {
    onProgress({ type: "error", message: `Unknown tool: ${toolId}` });
    return false;
  }

  const command = commandBuilder(toolId, packageManager, registryEntry.npmPackage);
  const commandAvailable = await ensureCommandAvailable(command.cmd);
  if (!commandAvailable) {
    onProgress({ type: "error", message: `Command not installed: ${command.cmd}` });
    return false;
  }

  return runLifecycleCommand(command, onProgress, options);
}

export async function installTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, (id, pm, pkg) => buildInstallCommandForTool(id, pm, pkg), onProgress, options);
}

export async function updateTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, (id, pm, pkg) => buildUpdateCommandForTool(id, pm, pkg), onProgress, options);
}

export async function uninstallTool(
  toolId: string,
  packageManager: PackageManager,
  onProgress: (event: ProgressEvent) => void,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean> {
  return runToolCommand(toolId, packageManager, (_toolId, pm, pkg) => buildUninstallCommand(pm, pkg), onProgress, options);
}
