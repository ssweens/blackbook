/**
 * Pi adapter. Composes `managedAdapter` (same file-copy engine as
 * OpenCode/Amp/Codex — the plugin bridge that used to give Pi its own
 * install path was removed) and layers in MCP server install/uninstall,
 * which OpenCode/Amp/Codex don't get here (Amp/OpenCode instead get a
 * plugin's `mcp.json` copied alongside its skill — see managed.ts; Codex has
 * no shared-file MCP convention at all).
 *
 * `update` isn't overridden: `managedAdapter.update` calls `this.install(...)`,
 * so overriding `install` alone already covers it.
 */

import type { Plugin, ToolInstance } from "../types.js";
import { installPluginItemsToInstance, uninstallPluginItemsFromInstance, managedAdapter } from "./managed.js";
import { installMcpServersToInstance, uninstallMcpServersFromInstance } from "./mcp.js";
import type { ToolAdapter, PerInstanceResult } from "./types.js";

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
