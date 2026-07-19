/**
 * Shared-store-aware install/support checks for file-copy tools
 * (OpenCode/Amp/Codex/Pi — the managedAdapter family).
 *
 * Since skills consolidated onto the shared `~/.agents/skills` store (read by
 * every file-copy tool, with `~/.claude/skills` a derived symlink overlay for
 * Claude), a skills-only plugin lands ONCE in the store and is read by every
 * tool — it does NOT get a per-tool manifest entry under each reading tool's
 * key. So the old "is there a manifest item owned by this plugin under THIS
 * tool's key" check (manifestHasPluginForInstance) reports "not installed" for
 * any tool that only reads the shared skill and installs no per-tool
 * components (commands/agents into its own dir).
 *
 * These helpers judge installed-ness by whether the plugin's components are
 * actually present where the instance reads them: skills in the shared store,
 * commands/agents in the tool's own dirs.
 */
import { existsSync } from "fs";
import { join } from "path";
import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import {
  agentsSkillsDir,
  flattenNamespacedName,
  resolveInstanceSubdirPath,
} from "../path-utils.js";

/**
 * True when the plugin's SKILL component is present at the location `instance`
 * reads it from. Flat-install tools (Claude) read the derived overlay symlink
 * `<skillsSubdir>/<flattened>`; every other tool reads the shared namespaced
 * store `~/.agents/skills/<plugin>/<skill>`, so any one enabled tool sharing
 * the store sees the same physical copy.
 */
export function pluginSkillPresentForInstance(plugin: Plugin, instance: ToolInstance): boolean {
  if (plugin.skills.length === 0 || !instance.skillsSubdir) return false;
  const hasSkillMd = (dir: string) => existsSync(join(dir, "SKILL.md"));
  return plugin.skills.every((skill) => {
    if (instance.pluginFlatInstall) {
      // Claude reads the derived overlay symlink at either the plugin-prefixed
      // flat name or the bare skill name (a standalone install of the same skill).
      const base = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!);
      return (
        hasSkillMd(join(base, flattenNamespacedName(plugin.name, skill))) ||
        hasSkillMd(join(base, skill))
      );
    }
    // Shared store — a skill can be present either namespaced under the plugin
    // (`~/.agents/skills/<plugin>/<skill>`, a plugin-component install) or flat
    // at the top level (`~/.agents/skills/<skill>`, a standalone install of the
    // same skill). Either satisfies "this tool can read the skill".
    return (
      hasSkillMd(agentsSkillsDir(plugin.name, skill)) ||
      hasSkillMd(agentsSkillsDir(null, skill))
    );
  });
}

/**
 * Whether a file-copy tool instance counts as having the plugin installed.
 * True when the plugin's shared skill component is present for this instance,
 * OR a per-tool manifest entry records a component installed under this
 * instance's key (commands/agents into the tool's own dir). Skills-only
 * plugins are therefore "installed" on every store-sharing tool with no
 * per-tool manifest key required.
 */
export function pluginInstalledForManagedInstance(
  plugin: Plugin,
  instance: ToolInstance,
  manifest: Manifest,
): boolean {
  if (pluginSkillPresentForInstance(plugin, instance)) return true;
  return manifestHasOwnedItemForInstance(manifest, instance, plugin.name);
}

/**
 * Absolute path to a plugin's skill in the shared store, or null if absent.
 * Checks the namespaced plugin-component layout first
 * (`~/.agents/skills/<plugin>/<skill>`), then the flat/standalone layout
 * (`~/.agents/skills/<skill>`, for a self-named skill installed standalone).
 */
export function pluginSkillStorePath(pluginName: string, skill: string): string | null {
  const namespaced = agentsSkillsDir(pluginName, skill);
  if (existsSync(join(namespaced, "SKILL.md"))) return namespaced;
  const flat = agentsSkillsDir(null, skill);
  if (existsSync(join(flat, "SKILL.md"))) return flat;
  return null;
}

/** True when the manifest records any item owned by `pluginName` under this instance's key. */
export function manifestHasOwnedItemForInstance(
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
