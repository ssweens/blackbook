import type { Module, CheckResult, ApplyResult } from "./types.js";
import type { Plugin } from "../types.js";
import { installPlugin as legacyInstall, syncPluginInstances } from "../install.js";
import { getPluginToolStatus } from "../plugin-status.js";

export interface PluginInstallParams {
  plugin: Plugin;
  marketplaceUrl?: string;
}

/**
 * Module wrapper around the existing plugin install logic.
 * check() determines if the plugin needs installation across instances.
 * apply() delegates to the existing installPlugin/syncPluginInstances.
 */
export const pluginInstallModule: Module<PluginInstallParams> = {
  name: "plugin-install",

  async check(params): Promise<CheckResult> {
    const { plugin } = params;

    const statuses = getPluginToolStatus(plugin);
    const missing = statuses.filter((s) => s.enabled && s.supported && !s.installed);

    if (missing.length === 0) {
      return { status: "ok", message: `${plugin.name} installed on all enabled instances` };
    }

    const names = missing.map((s) => s.name).join(", ");
    return {
      status: "missing",
      message: `${plugin.name} missing on: ${names}`,
    };
  },

  async apply(params): Promise<ApplyResult> {
    const { plugin, marketplaceUrl } = params;

    const statuses = getPluginToolStatus(plugin);
    const missing = statuses.filter((s) => s.enabled && s.supported && !s.installed);

    if (missing.length === 0) {
      return { changed: false, message: "Already installed on all instances" };
    }

    if (!plugin.installed && marketplaceUrl) {
      // Fresh install
      const result = await legacyInstall(plugin, marketplaceUrl);
      if (result.errors.length > 0) {
        return { changed: false, message: result.errors.join("; "), error: result.errors[0] };
      }
      return { changed: true, message: `Installed ${plugin.name}` };
    }

    // Sync to missing instances
    const result = await syncPluginInstances(plugin, marketplaceUrl, missing);
    if (!result.success) {
      return { changed: false, message: result.errors.join("; "), error: result.errors[0] };
    }

    return { changed: true, message: `Synced ${plugin.name} to ${missing.length} instance(s)` };
  },
};
