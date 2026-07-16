import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parseDocument } from "yaml";
import type { ToolTarget, ToolInstance, Marketplace, PackageManager, PluginComponentConfig } from "./types.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";
import { getAllPlaybooks, getBuiltinToolIds } from "./config/playbooks.js";
import { getConfigDir as getConfigDirFromPath, expandPath as expandYamlPath } from "./config/path.js";
import { loadConfig as loadYamlConfig } from "./config/loader.js";
import { saveConfig as saveYamlConfig } from "./config/writer.js";
import type { BlackbookConfig, FileEntry } from "./config/schema.js";

function buildToolDefinitions(): Record<string, ToolTarget> {
  const playbooks = getAllPlaybooks();
  const result: Record<string, ToolTarget> = {};
  for (const [toolId, pb] of playbooks) {
    // Respect XDG_CONFIG_HOME for blackbook (config-only tool)
    const configDir = toolId === "blackbook"
      ? getConfigDirFromPath()
      : expandPath(pb.default_instances[0].config_dir);

    result[toolId] = {
      id: toolId,
      name: pb.default_instances[0].name,
      configDir,
      skillsSubdir: pb.components.skills?.install_dir?.replace(/\/$/, "") ?? null,
      commandsSubdir: pb.components.commands?.install_dir?.replace(/\/$/, "") ?? null,
      agentsSubdir: pb.components.agents?.install_dir?.replace(/\/$/, "") ?? null,
      kind: pb.kind,
      pluginFlatInstall: pb.plugin_flat_install ?? false,
    };
  }
  return result;
}

export const TOOL_IDS = getBuiltinToolIds();

const DEFAULT_MARKETPLACES: Record<string, string> = {};

interface ClaudeMarketplaceEntry {
  source: {
    source: "github" | "git" | "directory";
    repo?: string;
    url?: string;
    path?: string;
  };
  installLocation: string;
  lastUpdated: string;
}

function getClaudeMarketplacesPath(): string {
  return join(homedir(), ".claude", "plugins", "known_marketplaces.json");
}

export function loadClaudeMarketplaces(): Record<string, string> {
  const path = getClaudeMarketplacesPath();
  if (!existsSync(path)) return {};

  return withFileLockSync(path, () => {
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, ClaudeMarketplaceEntry>;
      const result: Record<string, string> = {};

      for (const [name, entry] of Object.entries(data)) {
        if (entry.installLocation && existsSync(entry.installLocation)) {
          result[name] = entry.installLocation;
        } else if (entry.source.source === "github" && entry.source.repo) {
          result[name] = `https://raw.githubusercontent.com/${entry.source.repo}/main/.claude-plugin/marketplace.json`;
        } else if (entry.source.source === "git" && entry.source.url) {
          const match = entry.source.url.match(/github\.com\/([^/]+\/[^/.]+)/);
          if (match) {
            result[name] = `https://raw.githubusercontent.com/${match[1]}/main/.claude-plugin/marketplace.json`;
          }
        } else if (entry.source.source === "directory" && entry.source.path) {
          result[name] = expandPath(entry.source.path);
        }
      }

      return result;
    } catch (error) {
      console.error(`Failed to parse Claude marketplaces at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  });
}

export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), ".cache");
  return join(base, "blackbook");
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  const base = xdgConfig || join(homedir(), ".config");
  return join(base, "blackbook");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.yaml");
}

export interface ToolInstanceConfig {
  id?: string;
  name?: string;
  enabled?: boolean;
  configDir?: string;
}

export interface ToolConfig {
  enabled?: boolean;
  configDir?: string;
  instances?: ToolInstanceConfig[];
}

export interface PiMarketplacesConfig {
  [name: string]: string;  // name -> local path or git URL
}

const DEFAULT_INITIAL_MARKETPLACES: Record<string, string> = {
  "claude-plugins-official": "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
};

function buildInitialToolConfig(): Record<string, ToolConfig> {
  const definitions = buildToolDefinitions();
  const tools: Record<string, ToolConfig> = {};
  for (const [toolId, tool] of Object.entries(definitions)) {
    if (existsSync(tool.configDir)) {
      tools[toolId] = {
        instances: [
          {
            id: "default",
            name: tool.name,
            enabled: true,
            configDir: tool.configDir,
          },
        ],
      };
    }
  }
  return tools;
}

function buildInitialYamlTools(): BlackbookConfig["tools"] {
  const playbooks = getAllPlaybooks();
  const tools: BlackbookConfig["tools"] = {};

  for (const [toolId, playbook] of playbooks.entries()) {
    const instances = playbook.default_instances
      .filter((instance) => existsSync(expandYamlPath(instance.config_dir)))
      .map((instance) => ({
        id: instance.id,
        name: instance.name,
        enabled: true,
        config_dir: instance.config_dir,
      }));

    if (instances.length > 0) {
      tools[toolId] = instances;
    }
  }

  return tools;
}

function buildInitialYamlFiles(tools: BlackbookConfig["tools"]): FileEntry[] {
  const playbooks = getAllPlaybooks();
  const files: FileEntry[] = [];
  const usedNames = new Set<string>();

  for (const [toolId, instances] of Object.entries(tools)) {
    const playbook = playbooks.get(toolId);
    if (!playbook || playbook.config_files.length === 0) continue;

    for (const configFile of playbook.config_files) {
      let inferredSource: string | null = null;

      for (const instance of instances) {
        const absoluteTarget = join(expandYamlPath(instance.config_dir), configFile.path);
        if (existsSync(absoluteTarget)) {
          inferredSource = absoluteTarget;
          break;
        }
      }

      if (!inferredSource) continue;

      let name = `${toolId}:${configFile.name}`;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${toolId}:${configFile.name} (${suffix})`;
        suffix += 1;
      }
      usedNames.add(name);

      files.push({
        name,
        source: inferredSource,
        target: configFile.path,
        tools: [toolId],
      });
    }
  }

  return files;
}

function buildInitialYamlConfig(): BlackbookConfig {
  const tools = buildInitialYamlTools();
  return {
    settings: {
      package_manager: "npm",
      backup_retention: 3,
      config_management: false,
      disabled_marketplaces: [],
      disabled_pi_marketplaces: [],
    },
    marketplaces: { ...DEFAULT_INITIAL_MARKETPLACES },
    pi_marketplaces: {},
    tools,
    files: buildInitialYamlFiles(tools),
    configs: [],
    plugins: {},
    pi_packages: [],
    projects: [],
  };
}

export function ensureConfigExists(): void {
  const yamlPath = join(getConfigDirFromPath(), "config.yaml");
  if (!existsSync(yamlPath)) {
    const yamlConfig = buildInitialYamlConfig();
    saveYamlConfig(yamlConfig, yamlPath);
  }

  // Validate generated YAML once so startup gets deterministic defaults.
  const result = loadYamlConfig(yamlPath);

  // Migrate: strip removed fields (pullback, default_pullback) from existing configs
  if (result.errors.length === 0) {
    migrateConfig(yamlPath);
  }
}

/**
 * Remove deprecated fields from an existing YAML config file.
 * Uses the YAML document API to surgically strip fields without
 * disrupting comments or formatting.
 */
function migrateConfig(yamlPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(yamlPath, "utf-8");
  } catch {
    return;
  }

  // Quick check: if no deprecated fields exist, skip the migration entirely.
  if (!raw.includes("pullback") && !raw.includes("default_pullback")) {
    return;
  }

  const doc = parseDocument(raw);
  let changed = false;

  // Remove settings.default_pullback
  const settings = doc.get("settings") as any;
  if (settings && typeof settings === "object" && "delete" in settings) {
    if (settings.has?.("default_pullback")) {
      settings.delete("default_pullback");
      changed = true;
    }
  }

  // Remove pullback from each file entry
  const files = doc.get("files") as any;
  if (files && Array.isArray(files?.items ?? files)) {
    const items = files.items ?? files;
    for (const item of items) {
      if (item && typeof item === "object" && "delete" in item) {
        if (item.has?.("pullback")) {
          item.delete("pullback");
          changed = true;
        }
      }
    }
  }

  if (changed) {
    withFileLockSync(yamlPath, () => {
      atomicWriteFileSync(yamlPath, doc.toString());
    });
  }
}

/**
 * Load the YAML config, apply a mutation, and persist it atomically.
 *
 * When config.yaml fails to parse or fails zod validation, `loadYamlConfig`
 * returns schema defaults (NOT the user's real data) alongside `errors`.
 * Mutating and saving in that state would overwrite the user's real config
 * with mostly-defaults — silent data loss. This helper throws instead, so a
 * mutation is never persisted over a broken config, and the error surfaces to
 * the caller (and, via the store, to the user as a notification).
 */
function mutateYamlConfig<T>(
  mutator: (config: BlackbookConfig) => T,
  configPath?: string,
): T {
  const { config, configPath: resolvedPath, errors } = loadYamlConfig(configPath);
  if (errors.length > 0) {
    const detail = errors
      .map((e) => (e.path && e.path.length > 0 ? `${e.path.join(".")}: ${e.message}` : e.message))
      .join("; ");
    throw new Error(
      `Cannot save config: existing config.yaml has errors and would be overwritten with defaults: ${detail}`,
    );
  }
  const result = mutator(config);
  saveYamlConfig(config, resolvedPath);
  return result;
}

export function updateToolInstanceConfig(
  toolId: string,
  instanceId: string,
  updates: ToolInstanceConfig
): void {
  mutateYamlConfig((config) => {
    const instances = config.tools[toolId] || [];
    const index = instances.findIndex((inst) => inst.id === instanceId);
    if (index >= 0) {
      if (updates.name) instances[index].name = updates.name;
      if (updates.configDir) instances[index].config_dir = updates.configDir;
      if (typeof updates.enabled === "boolean") instances[index].enabled = updates.enabled;
    } else {
      instances.push({
        id: instanceId,
        name: updates.name || toolId,
        enabled: updates.enabled ?? true,
        config_dir: updates.configDir || "",
      });
    }
    config.tools[toolId] = instances;
  });
}

export function addMarketplace(name: string, url: string): void {
  mutateYamlConfig((config) => {
    config.marketplaces[name] = url;
  });
}

export function removeMarketplace(name: string): void {
  mutateYamlConfig((config) => {
    delete config.marketplaces[name];
  });
}

export function getToolDefinitions(): Record<string, ToolTarget> {
  return buildToolDefinitions();
}

export function getToolInstances(): ToolInstance[] {
  const definitions = buildToolDefinitions();
  const { config: yamlConfig } = loadYamlConfig();
  const instances: ToolInstance[] = [];

  for (const toolId of TOOL_IDS) {
    const tool = definitions[toolId];
    if (!tool) continue;
    const yamlInstances = yamlConfig.tools[toolId] || [];
    const toolInstances = yamlInstances.map((inst) => ({
      id: inst.id,
      name: inst.name,
      enabled: inst.enabled,
      configDir: inst.config_dir,
    }));

    if (toolInstances.length === 0) {
      const configOnly = !tool.skillsSubdir && !tool.commandsSubdir && !tool.agentsSubdir;
      if (configOnly && existsSync(tool.configDir)) {
        instances.push({
          toolId,
          instanceId: "default",
          name: tool.name,
          configDir: tool.configDir,
          skillsSubdir: tool.skillsSubdir,
          commandsSubdir: tool.commandsSubdir,
          agentsSubdir: tool.agentsSubdir,
          enabled: true,
          kind: tool.kind,
          pluginFlatInstall: tool.pluginFlatInstall,
        });
        continue;
      }
    }

    toolInstances.forEach((instance, index) => {
      const instanceId = instance.id && instance.id.trim().length > 0
        ? instance.id
        : `${toolId}-${index + 1}`;
      const name = instance.name && instance.name.trim().length > 0
        ? instance.name
        : tool.name;
      const configDir = typeof instance.configDir === "string" && instance.configDir.length > 0
        ? expandPath(instance.configDir)
        : tool.configDir;
      const enabled = typeof instance.enabled === "boolean" ? instance.enabled : false;

      instances.push({
        toolId,
        instanceId,
        name,
        configDir,
        skillsSubdir: tool.skillsSubdir,
        commandsSubdir: tool.commandsSubdir,
        agentsSubdir: tool.agentsSubdir,
        enabled,
        kind: tool.kind,
        pluginFlatInstall: tool.pluginFlatInstall,
      });
    });
  }

  return instances;
}

export function getEnabledToolInstances(): ToolInstance[] {
  return getToolInstances().filter((instance) => instance.enabled);
}

export function parseMarketplaces(): Marketplace[] {
  const { config: yamlConfig } = loadYamlConfig();
  const blackbookUrls = { ...DEFAULT_MARKETPLACES, ...yamlConfig.marketplaces };
  const hasEnabledClaudeInstance = getToolInstances().some(
    (instance) => instance.toolId === "claude-code" && instance.enabled
  );
  const claudeUrls = hasEnabledClaudeInstance ? loadClaudeMarketplaces() : {};
  const marketplaces: Marketplace[] = [];
  const disabledList = getDisabledMarketplaces();
  const isDisabled = (name: string) => disabledList.includes(name);

  // Add Blackbook marketplaces first (they take precedence)
  for (const [name, url] of Object.entries(blackbookUrls)) {
    const expandedUrl = expandPath(url);
    const isLocal = expandedUrl.startsWith("/");
    marketplaces.push({
      name,
      url: expandedUrl,
      isLocal,
      plugins: [],
      availableCount: 0,
      installedCount: 0,
      autoUpdate: false,
      source: "blackbook",
      enabled: !isDisabled(name),
    });
  }

  // Add Claude marketplaces (skip if name already exists from Blackbook)
  const blackbookNames = new Set(Object.keys(blackbookUrls));
  for (const [name, url] of Object.entries(claudeUrls)) {
    if (blackbookNames.has(name)) continue;
    
    const expandedUrl = expandPath(url);
    const isLocal = expandedUrl.startsWith("/");
    marketplaces.push({
      name,
      url: expandedUrl,
      isLocal,
      plugins: [],
      availableCount: 0,
      installedCount: 0,
      autoUpdate: false,
      source: "claude",
      enabled: !isDisabled(name),
    });
  }

  return marketplaces;
}

export function expandPath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }
  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

export function getConfigRepoPath(): string | null {
  const { config } = loadYamlConfig();
  if (!config.settings.source_repo) return null;
  return expandPath(config.settings.source_repo);
}

export function getAssetsRepoPath(): string | null {
  const { config } = loadYamlConfig();
  if (!config.settings.source_repo) return null;
  return expandPath(config.settings.source_repo);
}

export function getPackageManager(): PackageManager {
  const { config } = loadYamlConfig();
  return config.settings.package_manager;
}

/**
 * Resolve an asset source path. Supports:
 * - Absolute paths (start with /)
 * - Home-relative paths (start with ~)
 * - URLs (http:// or https://)
 * - Relative paths (resolved against assets_repo)
 */
export function resolveAssetSourcePath(source: string): string {
  // URLs pass through unchanged
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }
  
  // Absolute paths pass through with ~ expansion
  if (source.startsWith("/") || source.startsWith("~")) {
    return expandPath(source);
  }
  
  // Relative paths resolve against assets_repo
  const assetsRepo = getAssetsRepoPath();
  if (assetsRepo) {
    return join(assetsRepo, source);
  }
  
  // No assets_repo configured - try to expand as-is
  return expandPath(source);
}

/**
 * Get configured Pi marketplaces from the YAML `pi_marketplaces` section.
 * Returns a map of marketplace name -> source (local path or git URL).
 */
export function getPiMarketplaces(): PiMarketplacesConfig {
  const { config } = loadYamlConfig();
  return config.pi_marketplaces;
}

export function getDisabledMarketplaces(): string[] {
  const { config } = loadYamlConfig();
  return config.settings.disabled_marketplaces;
}

export function setMarketplaceEnabled(name: string, enabled: boolean): void {
  mutateYamlConfig((config) => {
    const disabled = new Set(config.settings.disabled_marketplaces);
    if (enabled) {
      disabled.delete(name);
    } else {
      disabled.add(name);
    }
    config.settings.disabled_marketplaces = Array.from(disabled);
  });
}

export function addPiMarketplace(name: string, source: string): void {
  mutateYamlConfig((config) => {
    config.pi_marketplaces[name] = source;
  });
}

export function removePiMarketplace(name: string): void {
  mutateYamlConfig((config) => {
    delete config.pi_marketplaces[name];
  });
}

export function getDisabledPiMarketplaces(): string[] {
  const { config } = loadYamlConfig();
  return config.settings.disabled_pi_marketplaces;
}

export function setPiMarketplaceEnabled(name: string, enabled: boolean): void {
  mutateYamlConfig((config) => {
    const disabled = new Set(config.settings.disabled_pi_marketplaces);
    if (enabled) {
      disabled.delete(name);
    } else {
      disabled.add(name);
    }
    config.settings.disabled_pi_marketplaces = Array.from(disabled);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Component Config (per-component enable/disable)
// ─────────────────────────────────────────────────────────────────────────────

function parseCommaList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function getPluginComponentConfig(marketplace: string, pluginName: string): PluginComponentConfig {
  const { config } = loadYamlConfig();
  const pluginEntry = config.plugins?.[marketplace]?.[pluginName];
  return {
    disabledSkills: pluginEntry?.disabled_skills ?? [],
    disabledCommands: pluginEntry?.disabled_commands ?? [],
    disabledAgents: pluginEntry?.disabled_agents ?? [],
  };
}

export function setPluginComponentEnabled(
  marketplace: string,
  pluginName: string,
  kind: "skill" | "command" | "agent",
  componentName: string,
  enabled: boolean
): void {
  mutateYamlConfig((config) => {
    if (!config.plugins[marketplace]) config.plugins[marketplace] = {};
    if (!config.plugins[marketplace][pluginName]) {
      config.plugins[marketplace][pluginName] = { disabled_skills: [], disabled_commands: [], disabled_agents: [] };
    }

    const pluginEntry = config.plugins[marketplace][pluginName];
    const field = kind === "skill" ? "disabled_skills" : kind === "command" ? "disabled_commands" : "disabled_agents";
    const current = new Set(pluginEntry[field]);

    if (enabled) {
      current.delete(componentName);
    } else {
      current.add(componentName);
    }

    pluginEntry[field] = Array.from(current);

    // Clean up empty plugin entries
    if (pluginEntry.disabled_skills.length === 0 && pluginEntry.disabled_commands.length === 0 && pluginEntry.disabled_agents.length === 0) {
      delete config.plugins[marketplace][pluginName];
      if (Object.keys(config.plugins[marketplace]).length === 0) {
        delete config.plugins[marketplace];
      }
    }
  });
}

export function isPluginComponentEnabled(
  marketplace: string,
  pluginName: string,
  kind: "skill" | "command" | "agent",
  componentName: string
): boolean {
  const componentConfig = getPluginComponentConfig(marketplace, pluginName);
  const disabledList = kind === "skill" ? componentConfig.disabledSkills :
                       kind === "command" ? componentConfig.disabledCommands :
                       componentConfig.disabledAgents;
  return !disabledList.includes(componentName);
}
