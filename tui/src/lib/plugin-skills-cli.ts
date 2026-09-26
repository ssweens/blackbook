/**
 * Plugin skills go through the bundled skills CLI; everything else in a plugin
 * (commands, agents, MCP) stays with Blackbook's own engine.
 *
 * For each plugin install/update, Blackbook runs
 *   skills add <plugin source> -g -y --skill <name>… -a <agents>
 * so the skills land in the central store with flat names and are recorded in
 * the global skills lockfile, exactly like standalone skills. The per-tool
 * adapters then see those skills as skills-CLI-managed (see
 * skills-cli-guard.ts) and record them without writing. Uninstall runs
 * `skills remove`.
 *
 * Calls are grouped by where agents read skills:
 *   - one call with `-a codex` covers every universal agent (Codex, OpenCode,
 *     Amp, Pi all read ~/.agents/skills);
 *   - one call per Claude instance with CLAUDE_CONFIG_DIR=<its config dir>
 *     and `-a claude-code` (e.g. ~/.claude and ~/.claude-learning).
 *
 * Disabled with BLACKBOOK_SKILLS_CLI=0 (the unit-test default).
 */
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative, resolve, sep } from "path";
import type { Plugin, ToolInstance } from "./types.js";
import { expandPath } from "./config/path.js";
import { parseMarketplaces } from "./config.js";
import { resolveLocalPath } from "./path-utils.js";
import { getSkillsCliEntry, skillsCliEnv } from "./skills-cli.js";
import { skillsSourceForRepo } from "./project-actions.js";

/** Tools whose skills live in the shared ~/.agents/skills (one CLI call covers all). */
const UNIVERSAL_TOOLS = new Set(["openai-codex", "opencode", "amp-code", "pi"]);

export function skillsCliEnabled(): boolean {
  return process.env.BLACKBOOK_SKILLS_CLI !== "0";
}

export interface CliCallResult {
  ok: boolean;
  error?: string;
}

export function runSkillsCliSync(args: string[], env: Record<string, string> = {}): CliCallResult {
  const r = spawnSync(process.execPath, [getSkillsCliEntry(), ...args], {
    cwd: process.env.HOME || process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, ...skillsCliEnv(), ...env },
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status === 0) return { ok: true };
  const text = `${r.stderr ?? ""}\n${r.stdout ?? ""}`
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s│◇◆●■└┌├─╮╯╭╰]+/, "").replace(/[\s│]+$/, "").trim())
    .filter(Boolean);
  const detail = text.reverse().find((l) => /error|fail|not found|invalid|✗/i.test(l)) ?? text[0];
  return { ok: false, error: detail ?? (r.error ? r.error.message : `skills CLI exited ${r.status}`) };
}

/** Frontmatter `name:` of a SKILL.md (falls back to the directory name). */
function skillName(dir: string): string {
  try {
    const m = readFileSync(join(dir, "SKILL.md"), "utf-8").match(/^---\s*\n([\s\S]*?)\n---/);
    const line = m?.[1].split("\n").find((l) => /^name\s*:/.test(l));
    const name = line?.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
    if (name) return name;
  } catch {
    /* fall through */
  }
  return dir.split(sep).pop() ?? dir;
}

/**
 * The installable skill names in a downloaded plugin (`<plugin>/skills/…`,
 * one level of nesting allowed), restricted to `plugin.skills` when that list
 * names the enabled skill directories.
 */
export function pluginSkillNames(plugin: Plugin, sourcePath: string | null): string[] {
  const names = new Set<string>();
  const root = sourcePath ? join(sourcePath, "skills") : "";
  const wanted = new Set(plugin.skills ?? []);
  const visit = (dir: string, depth: number) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (existsSync(join(full, "SKILL.md"))) {
        if (wanted.size === 0 || wanted.has(entry)) names.add(skillName(full));
      } else if (depth < 1) {
        visit(full, depth + 1);
      }
    }
  };
  if (root && existsSync(root)) visit(root, 0);
  if (names.size === 0) for (const s of plugin.skills ?? []) names.add(s);
  return [...names].sort();
}

function marketplaceUrlFor(plugin: Plugin, marketplaceUrl?: string): string | undefined {
  if (marketplaceUrl) return marketplaceUrl;
  const key = plugin.installedMarketplace ?? plugin.marketplace;
  return parseMarketplaces().find((m) => m.name === key)?.url;
}

/**
 * The `skills add` source for a plugin, scoped to the plugin's own folder so
 * same-named skills elsewhere in the repo are never picked up. Local-path
 * marketplaces resolve to their git remote (store keys then match standalone
 * installs; a dev shortcut can still point that repo back at the checkout).
 */
export function pluginSkillsSource(plugin: Plugin, marketplaceUrl?: string): { source: string; warning?: string } | null {
  const src = plugin.source;
  if (typeof src === "object") {
    if (src.source === "github" && src.repo) return { source: `github:${src.repo}` };
    if (src.url) return { source: src.url };
    return null;
  }
  if (typeof src !== "string") return null;

  const sub = src.replace(/^\.\//, "").replace(/\/+$/, "");
  const url = marketplaceUrlFor(plugin, marketplaceUrl);
  if (!url) return null;

  const local = resolveLocalPath(url);
  if (local) {
    const repoRoot = findGitRoot(local);
    const pluginDir = resolve(local, sub);
    if (!repoRoot) return { source: pluginDir, warning: `${local} is not a git repo; installing from the local path` };
    const { source, warning } = skillsSourceForRepo(repoRoot);
    if (warning) return { source: pluginDir, warning };
    const rel = relative(repoRoot, pluginDir).split(sep).join("/");
    return { source: /^[\w.-]+\/[\w.-]+$/.test(source) ? `github:${source}${rel ? `/${rel}` : ""}` : source };
  }

  const gh = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//) ?? url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
  if (gh) return { source: `github:${gh[1]}${sub ? `/${sub}` : ""}` };
  return null;
}

function findGitRoot(dir: string): string | null {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

/** Group instances into CLI calls: one universal call, one per Claude instance. */
export function callGroups(instances: ToolInstance[]): Array<{ agents: string[]; env: Record<string, string> }> {
  const groups: Array<{ agents: string[]; env: Record<string, string> }> = [];
  if (instances.some((i) => i.enabled && UNIVERSAL_TOOLS.has(i.toolId))) groups.push({ agents: ["codex"], env: {} });
  for (const i of instances) {
    if (i.enabled && i.toolId === "claude-code") {
      groups.push({ agents: ["claude-code"], env: { CLAUDE_CONFIG_DIR: expandPath(i.configDir) } });
    }
  }
  return groups;
}

/** Install (or refresh) a plugin's skills through the skills CLI for these instances. */
export function installPluginSkillsViaCli(
  plugin: Plugin,
  sourcePath: string | null,
  instances: ToolInstance[],
  marketplaceUrl?: string,
): string[] {
  if (!skillsCliEnabled()) return [];
  const names = pluginSkillNames(plugin, sourcePath);
  if (names.length === 0) return [];
  const resolved = pluginSkillsSource(plugin, marketplaceUrl);
  if (!resolved) return [`${plugin.name}: no skills CLI source for this plugin; skills left to Blackbook`];
  const errors: string[] = [];
  for (const g of callGroups(instances)) {
    const args = ["add", resolved.source, "-g", "-y", ...names.flatMap((n) => ["--skill", n]), ...g.agents.flatMap((a) => ["-a", a])];
    const r = runSkillsCliSync(args, g.env);
    if (!r.ok) errors.push(`${plugin.name} skills (${g.agents.join(",")}): ${r.error}`);
  }
  return errors;
}

/** Remove a plugin's skills through the skills CLI. `everywhere` also clears every universal agent link. */
export function removePluginSkillsViaCli(
  plugin: Plugin,
  sourcePath: string | null,
  instances: ToolInstance[],
  options: { everywhere?: boolean } = {},
): string[] {
  if (!skillsCliEnabled()) return [];
  const names = pluginSkillNames(plugin, sourcePath);
  if (names.length === 0) return [];
  const errors: string[] = [];
  for (const g of callGroups(instances)) {
    // Universal agents share ~/.agents/skills: removing for one removes for
    // all, so only do it when the whole plugin is being removed.
    if (g.agents.includes("codex") && !options.everywhere) continue;
    // Omitting -a for the universal group targets every agent, so no other
    // universal agent keeps the canonical link alive.
    const agentArgs = g.agents.includes("codex") ? [] : g.agents.flatMap((a) => ["-a", a]);
    const r = runSkillsCliSync(["remove", ...names, "-g", "-y", ...agentArgs], g.env);
    if (!r.ok) errors.push(`${plugin.name} skills removal: ${r.error}`);
  }
  return errors;
}

/** CLI call group for a single instance, or null for tools the skills CLI doesn't serve. */
function groupFor(instance: ToolInstance): { agents: string[]; env: Record<string, string> } | null {
  if (UNIVERSAL_TOOLS.has(instance.toolId)) return { agents: ["codex"], env: {} };
  if (instance.toolId === "claude-code") {
    return { agents: ["claude-code"], env: { CLAUDE_CONFIG_DIR: expandPath(instance.configDir) } };
  }
  return null;
}

/**
 * Install one standalone source-repo skill for one tool instance through the
 * skills CLI (`skills add github:<owner>/<repo>/<skill dir> -g`). Returns null
 * when the CLI can't serve it (disabled, no git remote, unsupported tool) so
 * the caller falls back to Blackbook's own copy.
 */
export function installStandaloneSkillViaCli(skillDir: string, sourceRepo: string, instance: ToolInstance): boolean | null {
  if (!skillsCliEnabled()) return null;
  const group = groupFor(instance);
  const repoRoot = findGitRoot(sourceRepo);
  if (!group || !repoRoot) return null;
  const { source, warning } = skillsSourceForRepo(repoRoot);
  if (warning || !/^[\w.-]+\/[\w.-]+$/.test(source)) return null;
  const rel = relative(repoRoot, resolve(skillDir)).split(sep).join("/");
  if (!rel || rel.startsWith("..")) return null;
  const args = ["add", `github:${source}/${rel}`, "-g", "-y", "--skill", skillName(skillDir), ...group.agents.flatMap((a) => ["-a", a])];
  return runSkillsCliSync(args, group.env).ok;
}

/**
 * Remove a CLI-managed skill (by its installed, flat name). With an instance,
 * only a Claude instance's links can be removed on their own; universal agents
 * share ~/.agents/skills, so `instance === null` (everywhere) is required for them.
 */
export function removeSkillViaCli(name: string, instance: ToolInstance | null, allInstances: ToolInstance[] = []): boolean {
  if (!skillsCliEnabled()) return false;
  const groups = instance ? [groupFor(instance)].filter((g): g is NonNullable<typeof g> => g !== null) : callGroups(allInstances);
  let ok = groups.length > 0;
  for (const g of groups) {
    if (g.agents.includes("codex") && instance) continue;
    const agentArgs = g.agents.includes("codex") ? [] : g.agents.flatMap((a) => ["-a", a]);
    ok = runSkillsCliSync(["remove", name, "-g", "-y", ...agentArgs], g.env).ok && ok;
  }
  return ok;
}
