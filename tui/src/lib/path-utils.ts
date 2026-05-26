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
 */
export function expandTilde(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(1));
  return p;
}

/**
 * Normalize a URL/path string to an absolute file-system path.
 * Handles `file://` URLs, `~`-prefixed paths, and relative paths.
 * Returns null if the URL is a non-local remote URL.
 */
export function resolveLocalPath(urlOrPath: string, isLocal = false): string | null {
  if (!urlOrPath) return null;

  if (urlOrPath.startsWith("file://")) {
    try { return fileURLToPath(urlOrPath); } catch { return null; }
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

  // If pointing at a file, return its directory
  if (existsSync(normalized) && lstatSync(normalized).isFile()) {
    normalized = dirname(normalized);
  }

  return normalized;
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

  const readSkillName = (skillDir: string) => {
    try {
      const body = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      const match = body.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m);
      return match?.[1]?.trim() || basename(skillDir);
    } catch {
      return basename(skillDir);
    }
  };

  const scanSkillRoot = (root: string) => {
    if (!isDirectory(root)) return;
    if (existsSync(join(root, "SKILL.md"))) {
      add(result.skills, readSkillName(root));
      return;
    }
    for (const item of readdirSync(root)) {
      const skillDir = join(root, item);
      if (isDirectory(skillDir) && existsSync(join(skillDir, "SKILL.md"))) {
        add(result.skills, readSkillName(skillDir));
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
