/**
 * Plugin installer naming conventions.
 *
 * Some plugins use custom installers that rename their components on disk
 * (e.g. compound-engineering's installer prefixes everything with `ce-` on
 * non-Claude tools, while keeping bare names on Claude). The plugin's
 * `plugin.json` declares the bare names, but the on-disk reality differs.
 *
 * This module is the SINGLE place that records those conventions. Two
 * consumers use it:
 *   1. `getStandaloneSkills` (install.ts) — to exclude plugin-owned skills
 *      from the standalone list even when they appear with prefixed names
 *      on disk.
 *   2. `computePluginToolStatus` (plugin-status.ts) — to recognize plugins
 *      as installed on non-Claude tools when their components live under
 *      prefixed names.
 *
 * Future direction: plugins should declare their installer prefixes in
 * `plugin.json` (`installer.prefix.<toolId>`). When/if that protocol exists,
 * this hard-coded table becomes a fallback for plugins that predate it.
 */

import type { Plugin } from "./types.js";

/**
 * Map of plugin-name → optional installer-prefix conventions, keyed by where
 * the prefix applies. Empty string means "use the bare name" (always
 * implicitly included). Non-empty entries are the recognized prefixed forms.
 *
 * Currently only one known convention; documented because every entry here
 * is a workaround for a plugin author who chose to bypass our standard
 * install flow.
 */
const KNOWN_INSTALLER_CONVENTIONS: Record<
  string,
  { nonClaudePrefixes: string[] }
> = {
  // https://github.com/everyinc/compound-engineering-plugin
  // Custom installer ships skills/commands as `ce-<name>` on Pi, OpenCode, etc.,
  // and bare `<name>` on Claude / Amp.
  "compound-engineering": { nonClaudePrefixes: ["ce-"] },
};

/**
 * Return every name a plugin component might appear under on a given tool.
 * Always includes the bare declared name; adds any known prefixed forms when
 * applicable.
 *
 * @example
 *   componentNameCandidates(compoundEngineering, "agent-browser", "pi")
 *     // → ["agent-browser", "ce-agent-browser"]
 *   componentNameCandidates(compoundEngineering, "agent-browser", "claude-code")
 *     // → ["agent-browser"]
 *   componentNameCandidates(unknownPlugin, "foo", "pi")
 *     // → ["foo"]
 */
export function componentNameCandidates(
  plugin: Pick<Plugin, "name">,
  componentName: string,
  toolId: string,
): string[] {
  const convention = KNOWN_INSTALLER_CONVENTIONS[plugin.name];
  if (!convention) return [componentName];
  const isClaude = toolId === "claude-code";
  if (isClaude) return [componentName];
  return [componentName, ...convention.nonClaudePrefixes.map((p) => `${p}${componentName}`)];
}

/**
 * Return every "prefix" form (including the empty bare form) a plugin uses
 * across all non-Claude tools. Useful for building scan filters that aren't
 * tied to a specific tool instance.
 */
export function pluginPrefixedSkillNames(
  plugin: Pick<Plugin, "name" | "skills">,
): string[] {
  const convention = KNOWN_INSTALLER_CONVENTIONS[plugin.name];
  const prefixes = ["", ...(convention?.nonClaudePrefixes ?? [])];
  const out: string[] = [];
  for (const skill of plugin.skills) {
    for (const p of prefixes) out.push(`${p}${skill}`);
  }
  return out;
}

/**
 * Plugins with custom installers may ship MORE components than their
 * plugin.json declares. We can't enumerate the exact set without running
 * the installer, but we can recognize the installer's PREFIX and treat any
 * disk component bearing that prefix as plugin-owned.
 *
 * Returns true if `skillName` looks like it was installed by one of the
 * installed plugins' custom installers.
 */
export function isSkillNameOwnedByInstalledPlugin(
  skillName: string,
  installedPlugins: ReadonlyArray<Pick<Plugin, "name" | "installed">>,
): boolean {
  for (const p of installedPlugins) {
    if (!p.installed) continue;
    const convention = KNOWN_INSTALLER_CONVENTIONS[p.name];
    if (!convention) continue;
    for (const prefix of convention.nonClaudePrefixes) {
      if (prefix && skillName.startsWith(prefix)) return true;
    }
  }
  return false;
}
