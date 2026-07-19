/**
 * Pi adapter. Composes `managedAdapter` (same file-copy engine as
 * OpenCode/Amp/Codex — the plugin bridge that used to give Pi its own
 * install path was removed) and layers in MCP server install/uninstall,
 * which OpenCode/Amp/Codex don't get here (Amp/OpenCode instead get a
 * plugin's `mcp.json` copied alongside its skill — see managed.ts; Codex has
 * no shared-file MCP convention at all).
 *
 * `supports`/`isInstalled` are also overridden, not inherited from
 * `managedAdapter`. `managedAdapter`'s versions are a hardcoded "always
 * false, always blocked" stub — a deliberate product decision specific to
 * OpenCode/Amp (see managed.ts). Pi isn't in that position: it used to have
 * real detection via the bridge, and losing that when the bridge was
 * removed was a regression, not a "matching existing tools" consistency —
 * it left Pi's plugins permanently reporting as not-installed/unsupported
 * regardless of real state. Pi has no native CLI list to check (unlike
 * Codex), so `isInstalled` is manifest-only, reusing the same
 * `manifestHasPluginForInstance` helper Codex's manifest fallback uses.
 *
 * `update` isn't overridden: `managedAdapter.update` calls `this.install(...)`,
 * so overriding `install` alone already covers it.
 */

import type { Plugin, ToolInstance } from "../types.js";
import { installPluginItemsToInstance, uninstallPluginItemsFromInstance, managedAdapter } from "./managed.js";
import { installMcpServersToInstance, uninstallMcpServersFromInstance } from "./mcp.js";
import { pluginInstalledForManagedInstance } from "./shared.js";
import type { ToolAdapter, PerInstanceResult, SupportInput, InstalledContext } from "./types.js";

async function installComponentsAndMcp(
  plugin: Plugin,
  instance: ToolInstance,
  sourcePath: string | null,
): Promise<PerInstanceResult> {
  if (!sourcePath) return { count: 0, errors: [] };
  const { count, errors } = installPluginItemsToInstance(plugin.name, sourcePath, instance, plugin.marketplace);
  const mcp = await installMcpServersToInstance(plugin.name, sourcePath, instance);
  return { count: count + mcp.count, errors: [...errors, ...mcp.errors] };
}

async function removeComponentsAndMcp(plugin: Plugin, instance: ToolInstance): Promise<number> {
  const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
  const mcpRemoved = await uninstallMcpServersFromInstance(plugin.name, instance);
  return removed + mcpRemoved;
}

export const piAdapter: ToolAdapter = {
  ...managedAdapter,
  toolId: "pi",

  supports(input: SupportInput): { supported: boolean; reason?: string } {
    const { canInstallSkills, canInstallCommands } = input;
    // No agentsSubdir for Pi (see playbooks/pi.yaml) — no agents component
    // to check here.
    return { supported: canInstallSkills || canInstallCommands };
  },

  isInstalled(plugin: Plugin, instance: ToolInstance, ctx: InstalledContext): boolean {
    // Shared-store aware: Pi reads skills from ~/.agents/skills too, so a
    // skills-only plugin is installed for Pi via the store even with no
    // per-tool manifest entry.
    return pluginInstalledForManagedInstance(plugin, instance, ctx.getManifest());
  },

  async install(plugin: Plugin, instance: ToolInstance, sourcePath: string | null): Promise<PerInstanceResult> {
    return installComponentsAndMcp(plugin, instance, sourcePath);
  },

  async uninstall(plugin: Plugin, instance: ToolInstance): Promise<PerInstanceResult> {
    return { count: await removeComponentsAndMcp(plugin, instance), errors: [] };
  },

  async installComponents(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
  ): Promise<PerInstanceResult> {
    return installComponentsAndMcp(plugin, instance, sourcePath);
  },

  async removeComponents(plugin: Plugin, instance: ToolInstance): Promise<number> {
    return removeComponentsAndMcp(plugin, instance);
  },
};
