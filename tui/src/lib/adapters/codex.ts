/**
 * Codex adapter. Codex installs are file-copy based (identical to the managed
 * adapter), so it composes managedAdapter for install/uninstall/update/list.
 * What is unique to Codex is its STATUS check: a plugin counts as installed if
 * EITHER Codex's native plugin manager (`codex plugin list`) knows about it OR
 * Blackbook's own file-copy manifest records it for this instance. And unlike
 * OpenCode/Amp, Codex is always "supported".
 */

import { execFileSync } from "child_process";
import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import type {
  ToolAdapter,
  SupportInput,
  InstalledContext,
} from "./types.js";
import { managedAdapter } from "./managed.js";

/**
 * Parse `codex plugin list` output into the set of installed `plugin@marketplace`
 * ids. Returns an empty set if Codex is unavailable or the command fails.
 */
export function fetchCodexInstalledPluginIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const output = execFileSync("codex", ["plugin", "list"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("Marketplace ") || trimmed.startsWith("PLUGIN ")) continue;
      const match = trimmed.match(/^([^\s]+)\s+(.+)$/);
      if (!match) continue;
      const pluginId = match[1];
      const statusCell = match[2].toLowerCase();
      if (!pluginId.includes("@")) continue;
      if (statusCell.startsWith("installed") || statusCell.includes("installed,")) {
        ids.add(pluginId);
      }
    }
  } catch {
    // If codex isn't available or list fails, treat as empty.
  }
  return ids;
}

/**
 * Whether Blackbook's own manifest records a file-copy install of `pluginName`
 * for this instance. Codex is materialized via file-copy (like OpenCode/Amp),
 * so `codex plugin list` alone never sees Blackbook-installed plugins; this
 * lets the status check recognize them. Checks both the bare toolId key and the
 * `toolId:instanceId` key, matching listInstalledForManagedInstance().
 */
export function manifestHasPluginForInstance(
  manifest: Manifest,
  instance: ToolInstance,
  pluginName: string,
): boolean {
  const keys = [instance.toolId, `${instance.toolId}:${instance.instanceId}`];
  for (const key of keys) {
    const items = manifest.tools[key]?.items;
    if (!items) continue;
    for (const item of Object.values(items)) {
      if ((item.owner || "") === pluginName) return true;
    }
  }
  return false;
}

export const codexAdapter: ToolAdapter = {
  ...managedAdapter,
  toolId: "openai-codex",

  supports(_input: SupportInput): { supported: boolean; reason?: string } {
    return { supported: true };
  },

  isInstalled(plugin: Plugin, instance: ToolInstance, ctx: InstalledContext): boolean {
    const ids = ctx.getCodexInstalledIds();
    const id1 = `${plugin.name}@${plugin.marketplace}`;
    const id2 = plugin.installedMarketplace ? `${plugin.name}@${plugin.installedMarketplace}` : "";
    const nativeInstalled = ids.has(id1) || (id2 ? ids.has(id2) : false);
    if (nativeInstalled) return true;
    return manifestHasPluginForInstance(ctx.getManifest(), instance, plugin.name);
  },
};
