/**
 * Shared path utilities for resolving local marketplace/plugin source paths.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Expand a `~`-prefixed path to an absolute path.
 * Returns the path unchanged if it doesn't start with `~`.
 *
 * Note: `~/foo` must strip both the tilde AND the following slash before
 * joining onto the home directory. Stripping only the tilde leaves an
 * absolute `/foo`, which `resolve(home, "/foo")` would treat as an override
 * and silently discard the home directory.
 */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve a tool instance's component subdirectory (skills/commands/agents)
 * against its config directory. Most playbooks declare a subdir relative to
 * the tool's own config_dir (e.g. `"skills/"`), but a playbook can also
 * point a component at a shared absolute location (e.g. `"~/.agents/skills"`,
 * used to redirect skill installs to a directory multiple tools read
 * natively instead of each tool's own proprietary one) — in that case the
 * absolute/`~`-prefixed subdir is used directly and `configDir` is ignored.
 */
export function resolveInstanceSubdirPath(configDir: string, subdir: string, ...rest: string[]): string {
  const base = subdir.startsWith("/") || subdir.startsWith("~") ? expandTilde(subdir) : join(configDir, subdir);
  return join(base, ...rest);
}

/**
 * Whether a component subdir is an absolute/`~`-prefixed override — i.e. it
 * resolves to a location shared with any other instance declaring the same
 * override (e.g. Codex/OpenCode/Amp/Pi's `skills` component all pointing at
 * `~/.agents/skills`), rather than a path unique to this instance's own
 * configDir.
 */
export function isSharedSubdirPath(subdir: string | null | undefined): boolean {
  return !!subdir && (subdir.startsWith("/") || subdir.startsWith("~"));
}

/**
 * Prefix a component name with its plugin/namespace to avoid collisions on
 * tools with a flat, unnamespaced install layout (`pluginFlatInstall: true` —
 * Claude Code, and Pi's plugin-sourced commands). Non-flat tools don't need
 * this: they already namespace by putting the component under a
 * `<prefix>/<name>` subdirectory instead.
 *
 * Returns `name` unchanged when there's no prefix to apply (unknown
 * namespace), the name already equals the prefix (e.g. a plugin's
 * self-named skill), or the name is already prefix-elided (avoids
 * double-prefixing an already-namespaced name like `utils-helper` under
 * plugin `utils` into `utils-utils-helper`).
 */
export function flattenNamespacedName(prefix: string | null | undefined, name: string): string {
  if (!prefix || name === prefix || name.startsWith(`${prefix}-`)) return name;
  return `${prefix}-${name}`;
}

/**
 * Normalize a URL/path string to an absolute file-system path, without
 * collapsing a file target down to its containing directory. Handles
 * `file://` URLs, `~`-prefixed paths, and relative paths. Returns null if
 * the URL is a non-local remote URL.
 *
 * Prefer `resolveLocalPath` unless the caller specifically needs to know
 * whether the raw target is itself a file (e.g. to try alternate filenames
 * when it's a directory instead) — that's the one thing collapsing to a
 * directory up front would lose.
 */
export function resolveLocalPathRaw(urlOrPath: string, isLocal = false): string | null {
  if (!urlOrPath) return null;

  if (urlOrPath.startsWith("file://")) {
    try {
      return fileURLToPath(urlOrPath);
    } catch {
      return null;
    }
  }

  const looksLocal =
    isLocal ||
    urlOrPath.startsWith("/") ||
    urlOrPath.startsWith("~") ||
    urlOrPath.startsWith("./") ||
    urlOrPath.startsWith("../");

  if (!looksLocal && urlOrPath.includes("://")) return null;

  let normalized = expandTilde(urlOrPath);
  if (!normalized.startsWith("/")) normalized = resolve(process.cwd(), normalized);
  return normalized;
}

/**
 * Normalize a URL/path string to an absolute file-system path.
 * Handles `file://` URLs, `~`-prefixed paths, and relative paths.
 * Returns null if the URL is a non-local remote URL.
 */
export function resolveLocalPath(urlOrPath: string, isLocal = false): string | null {
  const normalized = resolveLocalPathRaw(urlOrPath, isLocal);
  if (normalized === null) return null;

  // If pointing at a file, return its directory — applies to file:// URLs too,
  // since a marketplace URL commonly points at marketplace.json itself.
  if (existsSync(normalized) && lstatSync(normalized).isFile()) {
    return dirname(normalized);
  }

  return normalized;
}

/**
 * Read a skill's canonical name from its `SKILL.md` frontmatter, falling
 * back to the containing directory's name if the file is missing/unparsable.
 * The directory name alone isn't reliable on flat-install tools (Claude, and
 * now Pi's commands), where a component may be stored under a
 * plugin/namespace-prefixed name (see `flattenNamespacedName`) rather than
 * its bare one — the frontmatter `name:` field is unaffected by that.
 */
export function readSkillFrontmatterName(skillDir: string): string {
  try {
    const body = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    const match = body.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m);
    return match?.[1]?.trim() || basename(skillDir);
  } catch {
    return basename(skillDir);
  }
}

export interface PluginContents {
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  hasMcp: boolean;
}

/**
 * Scan a local plugin directory for skills, commands, agents, hooks, and MCP.
 * Returns empty lists (no throw) if the directory doesn't exist.
 */
export function scanPluginContents(pluginDir: string): PluginContents {
  const result: PluginContents = { skills: [], commands: [], agents: [], hooks: [], hasMcp: false };
  if (!existsSync(pluginDir)) return result;

  const add = (list: string[], value: string) => {
    if (value && !value.includes("/") && !list.includes(value)) list.push(value);
  };

  const isDirectory = (path: string) => {
    try { return statSync(path).isDirectory(); } catch { return false; }
  };

  const tryReadDir = (subDir: string) => {
    try {
      const dir = join(pluginDir, subDir);
      return isDirectory(dir) ? readdirSync(dir) : [];
    } catch { return []; }
  };

  const manifestComponentPaths = (field: string): string[] => {
    const paths: string[] = [];
    for (const rel of [join(".claude-plugin", "plugin.json"), join(".codex-plugin", "plugin.json")]) {
      try {
        const manifestPath = join(pluginDir, rel);
        if (!existsSync(manifestPath)) continue;
        const value = JSON.parse(readFileSync(manifestPath, "utf-8"))?.[field];
        if (typeof value === "string") paths.push(value);
        else if (Array.isArray(value)) {
          for (const item of value) if (typeof item === "string") paths.push(item);
        }
      } catch {
        // Ignore malformed or unsupported manifests while scanning best-effort contents.
      }
    }
    return [...new Set(paths)];
  };

  const resolveManifestPath = (relPath: string) => {
    const clean = relPath.replace(/^\.\//, "").replace(/\/$/, "");
    return join(pluginDir, clean);
  };

  const scanSkillRoot = (root: string) => {
    if (!isDirectory(root)) return;
    if (existsSync(join(root, "SKILL.md"))) {
      add(result.skills, readSkillFrontmatterName(root));
      return;
    }
    for (const item of readdirSync(root)) {
      const skillDir = join(root, item);
      if (isDirectory(skillDir) && existsSync(join(skillDir, "SKILL.md"))) {
        add(result.skills, readSkillFrontmatterName(skillDir));
      }
    }
  };

  // Skills: default skills/ plus any manifest-declared skill roots.
  scanSkillRoot(join(pluginDir, "skills"));
  for (const relPath of manifestComponentPaths("skills")) scanSkillRoot(resolveManifestPath(relPath));

  // Commands: *.md files
  for (const item of tryReadDir("commands")) {
    if (item.endsWith(".md")) add(result.commands, item.replace(/\.md$/, ""));
  }

  // Agents: *.md files
  for (const item of tryReadDir("agents")) {
    if (item.endsWith(".md")) add(result.agents, item.replace(/\.md$/, ""));
  }

  // Hooks: *.md or *.json files
  for (const item of tryReadDir("hooks")) {
    if (item.endsWith(".md") || item.endsWith(".json")) add(result.hooks, item.replace(/\.(md|json)$/, ""));
  }

  // MCP
  if (existsSync(join(pluginDir, "mcp.json")) || existsSync(join(pluginDir, ".mcp.json"))) {
    result.hasMcp = true;
  }

  result.skills.sort();
  result.commands.sort();
  result.agents.sort();
  result.hooks.sort();
  return result;
}

function readJsonIfExists(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * Extract a plugin's actual MCP server definitions from its cached source
 * directory — `scanPluginContents`'s `hasMcp` only tells you a server
 * exists, not what it is. Checks, in order:
 * 1. `mcp.json` / `.mcp.json` at the plugin root — either the standard
 *    `{"mcpServers": {...}}` shape or a bare servers object.
 * 2. `.claude-plugin/plugin.json`'s `mcpServers` field — either an inline
 *    servers object, or a string path to another JSON file within the
 *    plugin (resolved relative to `pluginDir`) holding the servers.
 * Returns null if no server definitions are found or parsable.
 */
export function getPluginMcpServers(pluginDir: string): Record<string, unknown> | null {
  const fromFile = (relPath: string): Record<string, unknown> | null => {
    const parsed = readJsonIfExists(join(pluginDir, relPath));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const servers = obj.mcpServers;
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      return servers as Record<string, unknown>;
    }
    return obj;
  };

  for (const relPath of ["mcp.json", ".mcp.json"]) {
    if (existsSync(join(pluginDir, relPath))) {
      const servers = fromFile(relPath);
      if (servers) return servers;
    }
  }

  const manifest = readJsonIfExists(join(pluginDir, ".claude-plugin", "plugin.json"));
  if (manifest && typeof manifest === "object") {
    const mcpServers = (manifest as Record<string, unknown>).mcpServers;
    if (typeof mcpServers === "string") {
      const cleanRel = mcpServers.replace(/^\.\//, "");
      return fromFile(cleanRel);
    }
    if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
      return mcpServers as Record<string, unknown>;
    }
  }

  return null;
}
