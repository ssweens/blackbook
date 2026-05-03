/**
 * Claude bundle ownership — read installed_plugins.json + plugin folder contents.
 *
 * Claude installs each plugin under <config_dir>/plugins/<name>/ and registers
 * it in <config_dir>/plugins/installed_plugins.json. Each plugin folder may
 * contain skills/, commands/, agents/, hooks/, .mcp.json — all of which
 * contribute to the user-facing list when the plugin is enabled.
 *
 * For provenance we walk each registered plugin's folder and record:
 *   (artifactType, name) → pluginName
 *
 * If the live <config_dir>/skills/<name>/ is a copy or symlink of a plugin's
 * contributed skill, the same name appears here, so the scanner will tag it
 * as bundle-owned. Standalone names (not in any plugin) stay standalone.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { discoverMarkdownDir, discoverSkillsDir } from "../base.js";
import type { BundleOwnershipMap } from "../scanner.js";
import { ownershipKey, readJsonSafe } from "../scanner.js";

interface InstalledPluginsManifest {
  plugins?: Record<
    string,
    {
      version?: string;
      enabled?: boolean;
      source?: unknown;
    }
  >;
}

export function buildClaudeOwnership(configDir: string): BundleOwnershipMap {
  const ownership: BundleOwnershipMap = new Map();
  const pluginsDir = join(configDir, "plugins");
  if (!existsSync(pluginsDir) || !statSync(pluginsDir).isDirectory()) return ownership;

  // Read registry to know which plugins are "installed" (vs orphan dirs).
  const registry = readJsonSafe<InstalledPluginsManifest>(
    join(pluginsDir, "installed_plugins.json"),
  );
  const registered = new Set<string>(Object.keys(registry?.plugins ?? {}));

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    // Walk plugin contents regardless of registration — orphaned plugin dirs
    // still own files on disk; better to attribute correctly than treat as
    // standalone.
    const pluginRoot = join(pluginsDir, entry.name);
    const pluginName = entry.name;

    for (const e of discoverSkillsDir(join(pluginRoot, "skills"))) {
      ownership.set(ownershipKey("skill", e.name), pluginName);
    }
    for (const e of discoverMarkdownDir(join(pluginRoot, "commands"))) {
      ownership.set(ownershipKey("command", e.name), pluginName);
    }
    for (const e of discoverMarkdownDir(join(pluginRoot, "agents"))) {
      ownership.set(ownershipKey("agent", e.name), pluginName);
    }
    // hooks are tool-specific; they're attributed in the hook scanner if needed
  }

  // Use `registered` later to mark unregistered plugin dirs as orphan in UI.
  // For ownership, presence is enough.
  void registered;

  return ownership;
}
