/**
 * Shared path utilities for resolving local marketplace/plugin source paths.
 */
import { existsSync, lstatSync, readdirSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
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

  const tryReadDir = (subDir: string) => {
    try {
      const dir = join(pluginDir, subDir);
      return lstatSync(dir).isDirectory() ? readdirSync(dir) : [];
    } catch { return []; }
  };

  // Skills: each subdirectory containing SKILL.md
  for (const item of tryReadDir("skills")) {
    if (existsSync(join(pluginDir, "skills", item, "SKILL.md"))) result.skills.push(item);
  }

  // Commands: *.md files
  for (const item of tryReadDir("commands")) {
    if (item.endsWith(".md")) result.commands.push(item.replace(/\.md$/, ""));
  }

  // Agents: *.md files
  for (const item of tryReadDir("agents")) {
    if (item.endsWith(".md")) result.agents.push(item.replace(/\.md$/, ""));
  }

  // Hooks: *.md or *.json files
  for (const item of tryReadDir("hooks")) {
    if (item.endsWith(".md") || item.endsWith(".json")) result.hooks.push(item.replace(/\.(md|json)$/, ""));
  }

  // MCP
  if (existsSync(join(pluginDir, "mcp.json")) || existsSync(join(pluginDir, ".mcp.json"))) {
    result.hasMcp = true;
  }

  return result;
}
