/**
 * OpenCode bundle operations.
 *
 * OpenCode plugins are npm packages listed in the `plugin` array of
 * opencode.json. They are auto-installed by Bun when OpenCode starts.
 * There is no imperative CLI install command.
 *
 * "Install" here means: add the package name to opencode.json `plugin` array.
 * "Uninstall" means: remove from the array.
 * The actual download/execution happens on the next OpenCode startup.
 *
 * Config file mutation is atomic (read → update → tmp+rename write).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BundleEntry, ToolInstance } from "../../playbook/index.js";
import { atomicWriteFile, resolveConfigDir } from "../base.js";

function configPath(instance: ToolInstance): string {
  return join(resolveConfigDir(instance), "opencode.json");
}

function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return { $schema: "https://opencode.ai/config.json" };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`opencode.json at ${path} is not valid JSON; cannot modify.`);
  }
}

function writeConfig(path: string, cfg: Record<string, unknown>): void {
  atomicWriteFile(path, JSON.stringify(cfg, null, 2) + "\n");
}

function getPackageName(ref: BundleEntry): string {
  if (ref.source.type === "npm") return ref.source.package;
  if (ref.source.type === "local") return ref.source.path;
  throw new Error(
    `OpenCode plugin source type "${ref.source.type}" is not supported; ` +
      `only npm and local sources are valid for OpenCode plugins.`,
  );
}

export async function installOpenCodeBundle(
  ref: BundleEntry,
  instance: ToolInstance,
): Promise<void> {
  const path = configPath(instance);
  const cfg = readConfig(path);
  const plugins: string[] = Array.isArray(cfg.plugin)
    ? (cfg.plugin as string[]).slice()
    : [];
  const pkg = getPackageName(ref);
  if (!plugins.includes(pkg)) {
    plugins.push(pkg);
    cfg.plugin = plugins;
    writeConfig(path, cfg);
  }
}

export async function updateOpenCodeBundle(
  _name: string,
  _instance: ToolInstance,
): Promise<void> {
  // Updates are handled by OpenCode at startup (bun cache refresh).
  // Nothing to do here; opencode.json entry stays the same.
}

export async function uninstallOpenCodeBundle(
  name: string,
  instance: ToolInstance,
): Promise<void> {
  const path = configPath(instance);
  if (!existsSync(path)) return; // nothing to remove
  const cfg = readConfig(path);
  if (!Array.isArray(cfg.plugin)) return;
  const before = cfg.plugin as string[];
  const after = before.filter((p) => p !== name && !p.startsWith(`${name}@`));
  if (after.length !== before.length) {
    cfg.plugin = after;
    writeConfig(path, cfg);
  }
}
