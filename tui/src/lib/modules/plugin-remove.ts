import type { Module, CheckResult, ApplyResult } from "./types.js";
import type { Plugin } from "../types.js";
import { uninstallPlugin as legacyUninstall } from "../install.js";
import { getPluginToolStatus } from "../plugin-status.js";

export interface PluginRemoveParams {
  plugin: Plugin;
}

/**
 * Module wrapper around the existing plugin uninstall logic.
 * check() determines if plugin artifacts exist that should be removed.
 * apply() delegates to the existing uninstallPlugin.
 */
export const pluginRemoveModule: Module<PluginRemoveParams> = {
  name: "plugin-remove",

  async check(params): Promise<CheckResult> {
    const { plugin } = params;

    const statuses = getPluginToolStatus(plugin);
    const installed = statuses.filter((s) => s.installed);

    if (installed.length === 0) {
      return { status: "ok", message: `${plugin.name} not installed anywhere` };
    }

    const names = installed.map((s) => s.name).join(", ");
    return {
      status: "drifted",
      message: `${plugin.name} installed on: ${names}`,
    };
  },

  async apply(params): Promise<ApplyResult> {
    const { plugin } = params;

    const success = await legacyUninstall(plugin);

    if (!success) {
      return { changed: false, message: `Failed to uninstall ${plugin.name}`, error: `Uninstall failed for ${plugin.name}` };
    }

    return { changed: true, message: `Removed ${plugin.name}` };
  },
};
