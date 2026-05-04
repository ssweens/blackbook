/**
 * Claude bundle ownership — read installed_plugins.json and walk each plugin's
 * installPath to discover which skills/commands/agents it contributed.
 *
 * Claude v2+ installs plugins into a cache:
 *   ~/.claude/plugins/installed_plugins.json  — registry
 *   entry.installPath                          — where the plugin's files live
 *
 * Each installPath may contain skills/, commands/, agents/ directories.
 * We walk those to build the ownership map.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverMarkdownDir, discoverSkillsDir } from "../base.js";
import type { BundleOwnershipMap } from "../scanner.js";
import { ownershipKey, readJsonSafe } from "../scanner.js";

interface InstalledPluginsManifest {
  version?: number;
  plugins?: Record<
    string,
    Array<{
      scope?: string;
      installPath?: string;
      version?: string;
    }>
  >;
}

export function buildClaudeOwnership(configDir: string): BundleOwnershipMap {
  const ownership: BundleOwnershipMap = new Map();

  const manifestPath = join(configDir, "plugins", "installed_plugins.json");
  const manifest = readJsonSafe<InstalledPluginsManifest>(manifestPath);
  if (!manifest?.plugins) return ownership;

  for (const [pluginKey, entries] of Object.entries(manifest.plugins)) {
    if (!entries?.length) continue;

    // Plugin key format: "name@marketplace" — use the short name for display.
    const pluginName = pluginKey.split("@")[0] ?? pluginKey;

    for (const entry of entries) {
      if (!entry.installPath) continue;
      const installPath = resolve(entry.installPath);
      if (!existsSync(installPath) || !statSync(installPath).isDirectory()) continue;

      recordContributions(installPath, pluginName, ownership);
    }
  }

  // Also walk the legacy plugin dirs (plugins/<name>/skills etc.)
  // in case any older-format plugins are present.
  const legacyPluginsDir = join(configDir, "plugins");
  if (existsSync(legacyPluginsDir) && statSync(legacyPluginsDir).isDirectory()) {
    for (const entry of readdirSync(legacyPluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const pluginRoot = join(legacyPluginsDir, entry.name);
      recordContributions(pluginRoot, entry.name, ownership);
    }
  }

  return ownership;
}

function recordContributions(
  root: string,
  pluginName: string,
  ownership: BundleOwnershipMap,
): void {
  for (const e of discoverSkillsDir(join(root, "skills"))) {
    ownership.set(ownershipKey("skill", e.name), pluginName);
  }
  for (const e of discoverMarkdownDir(join(root, "commands"))) {
    ownership.set(ownershipKey("command", e.name), pluginName);
  }
  for (const e of discoverMarkdownDir(join(root, "agents"))) {
    ownership.set(ownershipKey("agent", e.name), pluginName);
  }
}
