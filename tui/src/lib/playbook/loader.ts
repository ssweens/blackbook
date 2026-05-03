/**
 * Playbook loader — reads a playbook directory from disk and validates it.
 *
 * Layout expected:
 *   <root>/playbook.yaml                  required
 *   <root>/shared/AGENTS.md               optional
 *   <root>/shared/skills/<name>/SKILL.md  optional
 *   <root>/shared/commands/<name>.md      optional
 *   <root>/shared/agents/<name>.md        optional
 *   <root>/shared/mcp/<server>.yaml       optional
 *   <root>/tools/<tool>/tool.yaml         required if tool is in tools_enabled
 *   <root>/tools/<tool>/plugins.yaml      optional (artifact-bundle paradigm)
 *   <root>/tools/<tool>/packages.yaml     optional (code-package paradigm)
 *   <root>/tools/<tool>/<type>/...        optional (standalone artifacts)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  McpServerSchema,
  PackagesManifestSchema,
  PlaybookSchema,
  PluginsManifestSchema,
  ToolConfigSchema,
  ToolIdSchema,
  type McpServer,
  type PackagesManifest,
  type PlaybookManifest,
  type PluginsManifest,
  type ToolConfig,
  type ToolId,
} from "./schema.js";
import type { ArtifactRef, LoadedPlaybook, LoadedToolConfig, SharedArtifacts } from "./types.js";

export class PlaybookLoadError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlaybookLoadError";
  }
}

/**
 * Load a playbook from a directory. Returns the parsed in-memory representation.
 *
 * Throws PlaybookLoadError on schema violations or missing required files.
 * Cross-file consistency checks are NOT done here — see `validator.ts`.
 */
export function loadPlaybook(rootPath: string): LoadedPlaybook {
  const absRoot = resolve(rootPath);

  if (!existsSync(absRoot)) {
    throw new PlaybookLoadError(`Playbook root does not exist: ${absRoot}`, absRoot);
  }
  if (!statSync(absRoot).isDirectory()) {
    throw new PlaybookLoadError(`Playbook root is not a directory: ${absRoot}`, absRoot);
  }

  const manifest = loadManifest(absRoot);
  const shared = loadSharedArtifacts(absRoot);
  const tools = loadAllToolConfigs(absRoot, manifest.tools_enabled);

  return { rootPath: absRoot, manifest, tools, shared };
}

// ─────────────────────────────────────────────────────────────────────────────
// playbook.yaml
// ─────────────────────────────────────────────────────────────────────────────

function loadManifest(rootPath: string): PlaybookManifest {
  const path = join(rootPath, "playbook.yaml");
  if (!existsSync(path)) {
    throw new PlaybookLoadError("Missing playbook.yaml at playbook root", path);
  }
  const raw = readYamlFile(path);
  const result = PlaybookSchema.safeParse(raw);
  if (!result.success) {
    throw new PlaybookLoadError(
      `Invalid playbook.yaml: ${formatZodIssues(result.error.issues)}`,
      path,
      result.error,
    );
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// shared/
// ─────────────────────────────────────────────────────────────────────────────

function loadSharedArtifacts(rootPath: string): SharedArtifacts {
  const sharedDir = join(rootPath, "shared");
  if (!existsSync(sharedDir)) {
    return { skills: [], commands: [], agents: [], mcp: {} };
  }

  const agentsMdPath = join(sharedDir, "AGENTS.md");
  const skills = readArtifactDir(join(sharedDir, "skills"), "skill");
  const commands = readArtifactDir(join(sharedDir, "commands"), "command");
  const agents = readArtifactDir(join(sharedDir, "agents"), "agent");
  const mcp = readMcpDir(join(sharedDir, "mcp"));

  return {
    agentsMdPath: existsSync(agentsMdPath) ? agentsMdPath : undefined,
    skills,
    commands,
    agents,
    mcp,
  };
}

/**
 * Read an artifact directory.
 * - skills: each subdir is a skill containing SKILL.md
 * - commands/agents: each .md file is one artifact
 */
function readArtifactDir(dir: string, kind: "skill" | "command" | "agent"): ArtifactRef[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const refs: ArtifactRef[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (kind === "skill") {
      if (!entry.isDirectory()) continue;
      const skillFile = join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      refs.push({ name: entry.name, sourcePath: entryPath });
    } else {
      if (!entry.isFile()) continue;
      if (extname(entry.name) !== ".md") continue;
      const name = basename(entry.name, ".md");
      refs.push({ name, sourcePath: entryPath });
    }
  }
  refs.sort((a, b) => a.name.localeCompare(b.name));
  return refs;
}

function readMcpDir(dir: string): Record<string, McpServer> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return {};
  const result: Record<string, McpServer> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    const filePath = join(dir, entry.name);
    const raw = readYamlFile(filePath);
    const parsed = McpServerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PlaybookLoadError(
        `Invalid MCP server definition in ${entry.name}: ${formatZodIssues(parsed.error.issues)}`,
        filePath,
        parsed.error,
      );
    }
    if (result[parsed.data.name]) {
      throw new PlaybookLoadError(
        `Duplicate MCP server name "${parsed.data.name}" (also defined in another file under shared/mcp/)`,
        filePath,
      );
    }
    result[parsed.data.name] = parsed.data;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// tools/<tool>/
// ─────────────────────────────────────────────────────────────────────────────

function loadAllToolConfigs(
  rootPath: string,
  toolsEnabled: ToolId[],
): Partial<Record<ToolId, LoadedToolConfig>> {
  const out: Partial<Record<ToolId, LoadedToolConfig>> = {};
  for (const toolId of toolsEnabled) {
    out[toolId] = loadToolConfig(rootPath, toolId);
  }
  return out;
}

function loadToolConfig(rootPath: string, toolId: ToolId): LoadedToolConfig {
  const toolDir = join(rootPath, "tools", toolId);
  const toolYaml = join(toolDir, "tool.yaml");

  if (!existsSync(toolDir)) {
    throw new PlaybookLoadError(
      `Tool "${toolId}" is enabled in playbook.yaml but tools/${toolId}/ does not exist`,
      toolDir,
    );
  }
  if (!existsSync(toolYaml)) {
    throw new PlaybookLoadError(
      `Tool "${toolId}" is enabled but tools/${toolId}/tool.yaml is missing`,
      toolYaml,
    );
  }

  const rawConfig = readYamlFile(toolYaml);
  const parsedConfig = ToolConfigSchema.safeParse(rawConfig);
  if (!parsedConfig.success) {
    throw new PlaybookLoadError(
      `Invalid tools/${toolId}/tool.yaml: ${formatZodIssues(parsedConfig.error.issues)}`,
      toolYaml,
      parsedConfig.error,
    );
  }
  const config = parsedConfig.data;

  // Cross-check: tool field in tool.yaml should match directory name
  if (config.tool !== toolId) {
    throw new PlaybookLoadError(
      `tools/${toolId}/tool.yaml declares tool="${config.tool}", expected "${toolId}"`,
      toolYaml,
    );
  }

  const pluginsManifest = config.plugins_manifest
    ? loadPluginsManifest(toolDir, config.plugins_manifest, toolId)
    : tryLoadPluginsManifest(toolDir, "plugins.yaml", toolId);

  const packagesManifest = config.packages_manifest
    ? loadPackagesManifest(toolDir, config.packages_manifest, toolId)
    : tryLoadPackagesManifest(toolDir, "packages.yaml", toolId);

  const standalone = loadStandaloneArtifacts(toolDir);

  return {
    rootPath: toolDir,
    config,
    pluginsManifest,
    packagesManifest,
    standalone,
  };
}

function tryLoadPluginsManifest(
  toolDir: string,
  filename: string,
  toolId: ToolId,
): PluginsManifest | undefined {
  const path = join(toolDir, filename);
  if (!existsSync(path)) return undefined;
  return loadPluginsManifest(toolDir, filename, toolId);
}

function loadPluginsManifest(toolDir: string, filename: string, toolId: ToolId): PluginsManifest {
  const path = join(toolDir, filename);
  if (!existsSync(path)) {
    throw new PlaybookLoadError(
      `tool.yaml references plugins_manifest "${filename}" but file does not exist`,
      path,
    );
  }
  const raw = readYamlFile(path);
  const parsed = PluginsManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlaybookLoadError(
      `Invalid tools/${toolId}/${filename}: ${formatZodIssues(parsed.error.issues)}`,
      path,
      parsed.error,
    );
  }
  return parsed.data;
}

function tryLoadPackagesManifest(
  toolDir: string,
  filename: string,
  toolId: ToolId,
): PackagesManifest | undefined {
  const path = join(toolDir, filename);
  if (!existsSync(path)) return undefined;
  return loadPackagesManifest(toolDir, filename, toolId);
}

function loadPackagesManifest(toolDir: string, filename: string, toolId: ToolId): PackagesManifest {
  const path = join(toolDir, filename);
  if (!existsSync(path)) {
    throw new PlaybookLoadError(
      `tool.yaml references packages_manifest "${filename}" but file does not exist`,
      path,
    );
  }
  const raw = readYamlFile(path);
  const parsed = PackagesManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlaybookLoadError(
      `Invalid tools/${toolId}/${filename}: ${formatZodIssues(parsed.error.issues)}`,
      path,
      parsed.error,
    );
  }
  return parsed.data;
}

function loadStandaloneArtifacts(toolDir: string): SharedArtifacts {
  // Same shape as shared/, but rooted at tools/<tool>/
  const agentsMdPath = join(toolDir, "AGENTS.md");
  const skills = readArtifactDir(join(toolDir, "skills"), "skill");
  const commands = readArtifactDir(join(toolDir, "commands"), "command");
  const agents = readArtifactDir(join(toolDir, "agents"), "agent");
  // Standalone artifacts don't include MCP definitions — those always live in shared/mcp/
  return {
    agentsMdPath: existsSync(agentsMdPath) ? agentsMdPath : undefined,
    skills,
    commands,
    agents,
    mcp: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readYamlFile(path: string): unknown {
  const text = readFileSync(path, "utf-8");
  try {
    return parseYaml(text);
  } catch (err) {
    throw new PlaybookLoadError(`YAML parse error in ${path}`, path, err);
  }
}

function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .map((i) => {
      const segments = i.path.map((seg) => String(seg));
      const p = segments.length ? segments.join(".") : "(root)";
      return `${p}: ${i.message}`;
    })
    .join("; ");
}

/** Used by validator.ts and tests. */
export const __test = { readArtifactDir, readMcpDir, loadToolConfig };

// Re-export ToolIdSchema check for callers that need it before loading
export { ToolIdSchema };
