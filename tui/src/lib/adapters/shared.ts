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
  isSharedSubdirPath,
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
  return plugin.skills.every((skill) => skillPresentForInstance(plugin.name, skill, instance));
}

/**
 * True when ONE named skill of a plugin is present at the location `instance`
 * reads it from. Flat-install tools (Claude) read the derived overlay symlink
 * `<skillsSubdir>/<flattened|bare>`; every other tool reads the shared
 * namespaced store `~/.agents/skills/<plugin>/<skill>` (or the flat/standalone
 * `~/.agents/skills/<skill>`). Per-skill so callers can count exactly which
 * skills are missing without over/under-counting.
 */
export function skillPresentForInstance(pluginName: string, skill: string, instance: ToolInstance): boolean {
  if (!instance.skillsSubdir) return false;
  const hasSkillMd = (dir: string) => existsSync(join(dir, "SKILL.md"));
  if (instance.pluginFlatInstall) {
    const base = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir);
    return (
      hasSkillMd(join(base, flattenNamespacedName(pluginName, skill))) ||
      hasSkillMd(join(base, skill))
    );
  }
  return (
    hasSkillMd(agentsSkillsDir(pluginName, skill)) ||
    hasSkillMd(agentsSkillsDir(null, skill))
  );
}

/**
 * Read-side location of a plugin's command/agent file for one instance —
 * mirrors exactly where installPluginItemsToInstance writes it. Commands/agents
 * install to the shared `~/.agents/{commands,agents}/<plugin>/<name>.md` store
 * (namespaced) for every tool; only a genuinely non-shared (tool-own-dir)
 * destination flattens to `<flattened>.md`. Returns null when the instance
 * can't serve that component kind (no subdir).
 */
export function componentReadPathForInstance(
  instance: ToolInstance,
  pluginName: string,
  kind: "command" | "agent",
  name: string,
): string | null {
  const subdir = kind === "command" ? instance.commandsSubdir : instance.agentsSubdir;
  if (!subdir) return null;
  // Matches usesFlatCommands / the agent-install branch in managed.ts: a shared
  // destination is always namespaced; only a tool-own dir flattens.
  const flat =
    !isSharedSubdirPath(subdir) &&
    (instance.pluginFlatInstall || (kind === "command" && instance.toolId === "pi"));
  const base = flat
    ? resolveInstanceSubdirPath(instance.configDir, subdir)
    : resolveInstanceSubdirPath(instance.configDir, subdir, pluginName);
  const fileName = flat ? `${flattenNamespacedName(pluginName, name)}.md` : `${name}.md`;
  return join(base, fileName);
}

/**
 * Whether a file-copy tool instance counts as having the plugin installed —
 * judged by REAL presence of every file component (skill/command/agent) the
 * instance can serve, at the exact location it reads them from. This is the
 * single source of truth the detail rows are also derived from, so the list
 * badge (installed/incomplete) and the detail rows can never disagree.
 *
 * A component kind the instance can't serve (no subdir) or the plugin doesn't
 * ship is simply not required. When the plugin has NO file components the
 * instance can serve at all (MCP/LSP/hooks-only), fall back to the manifest —
 * there's no per-tool file to verify. Trusting the manifest for file-component
 * plugins was the bug: a stale/legacy dest read as "installed" while nothing
 * was actually present at the current read location.
 */
export function pluginInstalledForManagedInstance(
  plugin: Plugin,
  instance: ToolInstance,
  manifest: Manifest,
): boolean {
  const servesSkills = plugin.skills.length > 0 && !!instance.skillsSubdir;
  const servesCommands = plugin.commands.length > 0 && !!instance.commandsSubdir;
  const servesAgents = plugin.agents.length > 0 && !!instance.agentsSubdir;

  if (servesSkills || servesCommands || servesAgents) {
    const skillsOk = !servesSkills || plugin.skills.every((s) => skillPresentForInstance(plugin.name, s, instance));
    const commandsOk = !servesCommands || plugin.commands.every((c) => {
      const p = componentReadPathForInstance(instance, plugin.name, "command", c);
      return !!p && existsSync(p);
    });
    const agentsOk = !servesAgents || plugin.agents.every((a) => {
      const p = componentReadPathForInstance(instance, plugin.name, "agent", a);
      return !!p && existsSync(p);
    });
    return skillsOk && commandsOk && agentsOk;
  }

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
