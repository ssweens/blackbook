/**
 * Codex adapter. Codex installs are file-copy based (identical to the managed
 * adapter), so it composes managedAdapter for install/uninstall/update/list.
 * Status is determined solely by filesystem checks — no Codex CLI is ever called.
 */

import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import type {
  ToolAdapter,
  InstalledContext,
} from "./types.js";
import { managedAdapter } from "./managed.js";
import { pluginInstalledForManagedInstance } from "./shared.js";

/**
 * Whether Blackbook's own manifest records a file-copy install of `pluginName`
 * for this instance. Codex is materialized via file-copy (like OpenCode/Amp),
 * so the status check recognizes them. Checks both the bare toolId key and the
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

  isInstalled(plugin: Plugin, instance: ToolInstance, ctx: InstalledContext): boolean {
    return pluginInstalledForManagedInstance(plugin, instance, ctx.getManifest());
  },
};
