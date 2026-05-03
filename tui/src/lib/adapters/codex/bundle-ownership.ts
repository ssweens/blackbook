/**
 * Codex bundle ownership — read .codex-plugin/plugin.json manifests.
 *
 * Plugins live under <config_dir>/plugins/<name>/.codex-plugin/plugin.json.
 * Manifest declares paths to skills/, hooks/, mcpServers, apps, assets.
 *
 * Like Claude, we walk plugin folders and tag (artifactType, name) → pluginName.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverMarkdownDir, discoverSkillsDir } from "../base.js";
import type { BundleOwnershipMap } from "../scanner.js";
import { ownershipKey, readJsonSafe } from "../scanner.js";

interface CodexPluginManifest {
  name?: string;
  skills?: string;
  hooks?: string;
  mcpServers?: string;
  apps?: string;
}

export function buildCodexOwnership(configDir: string): BundleOwnershipMap {
  const ownership: BundleOwnershipMap = new Map();
  const pluginsDir = join(configDir, "plugins");
  if (!existsSync(pluginsDir) || !statSync(pluginsDir).isDirectory()) return ownership;

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const pluginRoot = join(pluginsDir, entry.name);
    const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
    const manifest = readJsonSafe<CodexPluginManifest>(manifestPath);
    if (!manifest?.name) continue;

    // Skills
    const skillsRel = manifest.skills ?? "./skills/";
    const skillsDir = resolve(pluginRoot, skillsRel);
    for (const e of discoverSkillsDir(skillsDir)) {
      ownership.set(ownershipKey("skill", e.name), manifest.name);
    }
    // Commands and agents — codex plugins don't standardize these, but
    // discover them if present (mirrors Claude pattern)
    for (const e of discoverMarkdownDir(join(pluginRoot, "commands"))) {
      ownership.set(ownershipKey("command", e.name), manifest.name);
    }
    for (const e of discoverMarkdownDir(join(pluginRoot, "agents"))) {
      ownership.set(ownershipKey("agent", e.name), manifest.name);
    }
  }
  return ownership;
}
