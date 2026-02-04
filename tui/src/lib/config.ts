import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ToolTarget, ToolInstance, Marketplace, AssetConfig, ConfigSyncConfig, ConfigMapping } from "./types.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";

const DEFAULT_TOOLS: Record<string, ToolTarget> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude",
    configDir: join(homedir(), ".claude"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    configDir: join(homedir(), ".config/opencode"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  },
  "amp-code": {
    id: "amp-code",
    name: "Amp",
    configDir: join(homedir(), ".config/amp"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  },
  "openai-codex": {
    id: "openai-codex",
    name: "Codex",
    configDir: join(homedir(), ".codex"),
    skillsSubdir: "skills",
    commandsSubdir: null,
    agentsSubdir: null,
  },
  pi: {
    id: "pi",
    name: "Pi",
    configDir: join(homedir(), ".pi"),
    skillsSubdir: "agent/skills",
    commandsSubdir: "agent/prompts",
    agentsSubdir: null,
  },
};

export const TOOL_IDS = Object.keys(DEFAULT_TOOLS);

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
        if (entry.source.source === "github" && entry.source.repo) {
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
  return join(getConfigDir(), "config.toml");
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

export interface SyncConfig {
  configRepo?: string;
  assetsRepo?: string;  // defaults to configRepo if not specified
  disabledMarketplaces?: string;    // comma-separated list of disabled plugin marketplace names
  disabledPiMarketplaces?: string;  // comma-separated list of disabled Pi marketplace names
}

export interface PiMarketplacesConfig {
  [name: string]: string;  // name -> local path or git URL
}

export interface TomlConfig {
  marketplaces?: Record<string, string>;
  piMarketplaces?: PiMarketplacesConfig;
  tools?: Record<string, ToolConfig>;
  assets?: AssetConfig[];
  sync?: SyncConfig;
  configs?: ConfigSyncConfig[];
}

export function loadConfig(configPath?: string): TomlConfig {
  const path = configPath || getConfigPath();
  
  if (!existsSync(path)) {
    return { marketplaces: {}, tools: {}, assets: [], configs: [] };
  }

  return withFileLockSync(path, () => {
    const content = readFileSync(path, "utf-8");
    const result: TomlConfig = { marketplaces: {}, tools: {}, assets: [], configs: [] };

    let currentSection = "";
    let currentTool = "";
    let currentInstance: ToolInstanceConfig | null = null;
    let currentAsset: AssetConfig | null = null;
    let currentConfig: ConfigSyncConfig | null = null;
    
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed) continue;

      const arraySectionMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
      if (arraySectionMatch) {
        const section = arraySectionMatch[1];
        if (section.startsWith("tools.") && section.endsWith(".instances")) {
          currentSection = "tool_instances";
          currentTool = section.replace(/^tools\./, "").replace(/\.instances$/, "");
          const toolConfig = result.tools![currentTool] || {};
          toolConfig.instances = toolConfig.instances || [];
          const instance: ToolInstanceConfig = {};
          toolConfig.instances.push(instance);
          result.tools![currentTool] = toolConfig;
          currentInstance = instance;
          currentAsset = null;
        } else if (section === "assets") {
          currentSection = "assets";
          currentTool = "";
          currentInstance = null;
          currentConfig = null;
          const asset: AssetConfig = { name: "" };
          result.assets = result.assets || [];
          result.assets.push(asset);
          currentAsset = asset;
        } else if (section === "assets.files" && currentAsset) {
          currentSection = "asset_files";
          currentTool = "";
          currentInstance = null;
          currentConfig = null;
          // Initialize mappings array and add new mapping
          if (!currentAsset.mappings) {
            currentAsset.mappings = [];
          }
          const mapping = { source: "", target: "" };
          currentAsset.mappings.push(mapping);
        } else if (section === "configs") {
          currentSection = "configs";
          currentTool = "";
          currentInstance = null;
          currentAsset = null;
          const config: ConfigSyncConfig = { name: "", toolId: "" };
          result.configs = result.configs || [];
          result.configs.push(config);
          currentConfig = config;
        } else if (section === "configs.files" && currentConfig) {
          currentSection = "config_files";
          currentTool = "";
          currentInstance = null;
          currentAsset = null;
          // Initialize mappings array and add new mapping
          if (!currentConfig.mappings) {
            currentConfig.mappings = [];
          }
          const mapping = { source: "", target: "" };
          currentConfig.mappings.push(mapping);
        } else {
          currentSection = "";
          currentTool = "";
          currentInstance = null;
          currentAsset = null;
          currentConfig = null;
        }
        continue;
      }

      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        const section = sectionMatch[1];
        if (section.startsWith("tools.")) {
          currentSection = "tools";
          currentTool = section.replace("tools.", "");
          result.tools![currentTool] = result.tools![currentTool] || {};
          currentInstance = null;
          currentAsset = null;
        } else if (section === "assets.overrides") {
          currentSection = "asset_overrides";
          currentTool = "";
          currentInstance = null;
        } else if (section === "assets.files.overrides" && currentAsset && currentAsset.mappings && currentAsset.mappings.length > 0) {
          currentSection = "asset_file_overrides";
          currentTool = "";
          currentInstance = null;
        } else if (section === "sync") {
          currentSection = "sync";
          currentTool = "";
          currentInstance = null;
          currentAsset = null;
          currentConfig = null;
          result.sync = result.sync || {};
        } else {
          currentSection = section;
          currentTool = "";
          currentInstance = null;
          currentAsset = null;
          currentConfig = null;
        }
        continue;
      }

      const kvStringMatch = trimmed.match(/^(".+"|\S+)\s*=\s*"(.*)"$/);
      const kvBoolMatch = trimmed.match(/^(\S+)\s*=\s*(true|false)$/);
      if (kvStringMatch) {
        let [, key, value] = kvStringMatch;
        if (key.startsWith("\"") && key.endsWith("\"")) {
          key = key.slice(1, -1);
        }
        if (currentSection === "marketplaces") {
          result.marketplaces![key] = value;
        } else if (currentSection === "pi-marketplaces") {
          if (!result.piMarketplaces) result.piMarketplaces = {};
          result.piMarketplaces[key] = value;
        } else if (currentSection === "tools" && currentTool) {
          const normalizedKey = key === "config_dir" ? "configDir" : key;
          (result.tools![currentTool] as Record<string, string>)[normalizedKey] = value;
        } else if (currentSection === "tool_instances" && currentTool && currentInstance) {
          const normalizedKey = key === "config_dir" ? "configDir" : key;
          (currentInstance as Record<string, string>)[normalizedKey] = value;
        } else if (currentSection === "assets" && currentAsset) {
          const normalizedKey = key === "default_target" ? "defaultTarget" : key;
          (currentAsset as unknown as Record<string, string>)[normalizedKey] = value;
        } else if (currentSection === "asset_overrides" && currentAsset) {
          if (!currentAsset.overrides) currentAsset.overrides = {};
          currentAsset.overrides[key] = value;
        } else if (currentSection === "asset_files" && currentAsset && currentAsset.mappings) {
          const currentMapping = currentAsset.mappings[currentAsset.mappings.length - 1];
          if (currentMapping) {
            (currentMapping as unknown as Record<string, string>)[key] = value;
          }
        } else if (currentSection === "asset_file_overrides" && currentAsset && currentAsset.mappings) {
          const currentMapping = currentAsset.mappings[currentAsset.mappings.length - 1];
          if (currentMapping) {
            if (!currentMapping.overrides) currentMapping.overrides = {};
            currentMapping.overrides[key] = value;
          }
        } else if (currentSection === "sync") {
          const normalizedKey = key === "config_repo" ? "configRepo" :
                               key === "assets_repo" ? "assetsRepo" :
                               key === "disabled_marketplaces" ? "disabledMarketplaces" :
                               key === "disabled_pi_marketplaces" ? "disabledPiMarketplaces" : key;
          (result.sync as Record<string, string>)[normalizedKey] = value;
        } else if (currentSection === "configs" && currentConfig) {
          const normalizedKey = key === "tool_id" ? "toolId" :
                               key === "source_path" ? "sourcePath" :
                               key === "target_path" ? "targetPath" : key;
          (currentConfig as unknown as Record<string, string>)[normalizedKey] = value;
        } else if (currentSection === "config_files" && currentConfig && currentConfig.mappings) {
          const currentMapping = currentConfig.mappings[currentConfig.mappings.length - 1];
          if (currentMapping) {
            (currentMapping as unknown as Record<string, string>)[key] = value;
          }
        }
      } else if (kvBoolMatch) {
        const [, key, rawValue] = kvBoolMatch;
        const value = rawValue === "true";
        if (currentSection === "tools" && currentTool) {
          const normalizedKey = key === "config_dir" ? "configDir" : key;
          (result.tools![currentTool] as Record<string, boolean>)[normalizedKey] = value;
        } else if (currentSection === "tool_instances" && currentTool && currentInstance) {
          const normalizedKey = key === "config_dir" ? "configDir" : key;
          (currentInstance as Record<string, boolean>)[normalizedKey] = value;
        }
      }
    }

    return result;
  });
}

export function saveConfig(config: TomlConfig, configPath?: string): void {
  const path = configPath || getConfigPath();
  
  const lines: string[] = [
    "# Blackbook Configuration",
    "# See https://github.com/ssweens/blackbook for documentation",
    "",
  ];

  const hasMarketplaces = config.marketplaces && Object.keys(config.marketplaces).length > 0;
  const hasTools = config.tools && Object.keys(config.tools).length > 0;
  const hasAssets = config.assets && config.assets.length > 0;
  const hasSync = config.sync && config.sync.configRepo;
  const hasConfigs = config.configs && config.configs.length > 0;

  lines.push("[marketplaces]");
  if (hasMarketplaces) {
    for (const [name, url] of Object.entries(config.marketplaces!)) {
      lines.push(`${name} = "${url}"`);
    }
  } else {
    lines.push("# Add custom marketplaces here. Examples:");
    lines.push("# my-plugins = \"https://raw.githubusercontent.com/my-org/plugins/main/.claude-plugin/marketplace.json\"");
  }
  lines.push("");

  if (hasSync) {
    lines.push("[sync]");
    lines.push(`config_repo = "${config.sync!.configRepo}"`);
    if (config.sync!.assetsRepo) {
      lines.push(`assets_repo = "${config.sync!.assetsRepo}"`);
    }
    if (config.sync!.disabledMarketplaces) {
      lines.push(`disabled_marketplaces = "${config.sync!.disabledMarketplaces}"`);
    }
    if (config.sync!.disabledPiMarketplaces) {
      lines.push(`disabled_pi_marketplaces = "${config.sync!.disabledPiMarketplaces}"`);
    }
    lines.push("");
  }

  if (hasAssets) {
    for (const asset of config.assets!) {
      lines.push("[[assets]]");
      lines.push(`name = "${asset.name}"`);
      lines.push(`source = "${asset.source}"`);
      if (asset.defaultTarget) {
        lines.push(`default_target = "${asset.defaultTarget}"`);
      }
      if (asset.overrides && Object.keys(asset.overrides).length > 0) {
        lines.push("");
        lines.push("[assets.overrides]");
        for (const [key, value] of Object.entries(asset.overrides)) {
          lines.push(`"${key}" = "${value}"`);
        }
      }
      lines.push("");
    }
  }

  if (hasConfigs) {
    for (const cfg of config.configs!) {
      lines.push("[[configs]]");
      lines.push(`name = "${cfg.name}"`);
      lines.push(`tool_id = "${cfg.toolId}"`);

      // New format: mappings array
      if (cfg.mappings && cfg.mappings.length > 0) {
        for (const mapping of cfg.mappings) {
          lines.push("[[configs.files]]");
          lines.push(`source = "${mapping.source}"`);
          lines.push(`target = "${mapping.target}"`);
        }
      } else if (cfg.sourcePath && cfg.targetPath) {
        // Legacy format: single source/target
        lines.push(`source_path = "${cfg.sourcePath}"`);
        lines.push(`target_path = "${cfg.targetPath}"`);
      }

      lines.push("");
    }
  }

  if (hasTools) {
    for (const [toolId, toolConfig] of Object.entries(config.tools!)) {
      const orderedEntries: Array<[string, string | boolean]> = [];
      if (typeof toolConfig.enabled === "boolean") {
        orderedEntries.push(["enabled", toolConfig.enabled]);
      }
      if (typeof toolConfig.configDir === "string") {
        orderedEntries.push(["config_dir", toolConfig.configDir]);
      }
      if (orderedEntries.length > 0) {
        lines.push(`[tools.${toolId}]`);
        for (const [key, value] of orderedEntries) {
          if (typeof value === "boolean") {
            lines.push(`${key} = ${value}`);
          } else {
            lines.push(`${key} = "${value}"`);
          }
        }
        lines.push("");
      }

      if (toolConfig.instances && toolConfig.instances.length > 0) {
        for (const instance of toolConfig.instances) {
          lines.push(`[[tools.${toolId}.instances]]`);
          if (typeof instance.id === "string") {
            lines.push(`id = "${instance.id}"`);
          }
          if (typeof instance.name === "string") {
            lines.push(`name = "${instance.name}"`);
          }
          if (typeof instance.enabled === "boolean") {
            lines.push(`enabled = ${instance.enabled}`);
          }
          if (typeof instance.configDir === "string") {
            lines.push(`config_dir = "${instance.configDir}"`);
          }
          lines.push("");
        }
      }
    }
  } else {
    lines.push("# Configure tool instances. Examples:");
    lines.push("# [tools.claude-code]");
    lines.push("#");
    lines.push("# [[tools.claude-code.instances]]");
    lines.push("# id = \"default\"");
    lines.push("# name = \"Claude\"");
    lines.push("# enabled = true");
    lines.push("# config_dir = \"~/.claude\"");
    lines.push("");
    lines.push("# [tools.opencode]");
    lines.push("#");
    lines.push("# [[tools.opencode.instances]]");
    lines.push("# id = \"default\"");
    lines.push("# name = \"OpenCode\"");
    lines.push("# enabled = true");
    lines.push("# config_dir = \"~/.config/opencode\"");
  }

  withFileLockSync(path, () => {
    atomicWriteFileSync(path, lines.join("\n"));
  });
}

const DEFAULT_INITIAL_MARKETPLACES: Record<string, string> = {
  "claude-plugins-official": "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
};

function buildInitialToolConfig(): Record<string, ToolConfig> {
  const tools: Record<string, ToolConfig> = {};
  for (const [toolId, tool] of Object.entries(DEFAULT_TOOLS)) {
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

export function ensureConfigExists(): void {
  const path = getConfigPath();
  if (!existsSync(path)) {
    saveConfig({ marketplaces: DEFAULT_INITIAL_MARKETPLACES, tools: buildInitialToolConfig() });
  }
}

export function updateToolInstanceConfig(
  toolId: string,
  instanceId: string,
  updates: ToolInstanceConfig
): void {
  const config = loadConfig();
  config.tools = config.tools || {};
  const toolConfig: ToolConfig = config.tools[toolId] || {};
  const instances = toolConfig.instances ? [...toolConfig.instances] : [];
  const index = instances.findIndex((instance) => instance.id === instanceId);
  if (index >= 0) {
    instances[index] = { ...instances[index], ...updates };
  } else {
    instances.push({ id: instanceId, ...updates });
  }
  toolConfig.instances = instances;
  config.tools[toolId] = toolConfig;
  saveConfig(config);
}

export function addMarketplace(name: string, url: string): void {
  const config = loadConfig();
  config.marketplaces = config.marketplaces || {};
  config.marketplaces[name] = url;
  saveConfig(config);
}

export function removeMarketplace(name: string): void {
  const config = loadConfig();
  if (config.marketplaces) {
    delete config.marketplaces[name];
    saveConfig(config);
  }
}

export function getToolDefinitions(): Record<string, ToolTarget> {
  return DEFAULT_TOOLS;
}

export function getToolInstances(): ToolInstance[] {
  const userConfig = loadConfig();
  const instances: ToolInstance[] = [];

  for (const toolId of TOOL_IDS) {
    const tool = DEFAULT_TOOLS[toolId];
    const toolConfig = userConfig.tools?.[toolId];
    const toolInstances = toolConfig?.instances || [];

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
      });
    });
  }

  return instances;
}

export function getEnabledToolInstances(): ToolInstance[] {
  return getToolInstances().filter((instance) => instance.enabled);
}

export function parseMarketplaces(config?: TomlConfig): Marketplace[] {
  const userConfig = config || loadConfig();
  const blackbookUrls = { ...DEFAULT_MARKETPLACES, ...userConfig.marketplaces };
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
  const config = loadConfig();
  if (!config.sync?.configRepo) return null;
  return expandPath(config.sync.configRepo);
}

export function getAssetsRepoPath(): string | null {
  const config = loadConfig();
  // assets_repo defaults to config_repo if not specified
  if (config.sync?.assetsRepo) {
    return expandPath(config.sync.assetsRepo);
  }
  if (config.sync?.configRepo) {
    return expandPath(config.sync.configRepo);
  }
  return null;
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
 * Get configured Pi marketplaces from [pi-marketplaces] section.
 * Returns a map of marketplace name -> source (local path or git URL).
 */
export function getPiMarketplaces(): PiMarketplacesConfig {
  const config = loadConfig();
  return config.piMarketplaces ?? {};
}

export function getDisabledMarketplaces(): string[] {
  const config = loadConfig();
  const raw = config.sync?.disabledMarketplaces;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function setMarketplaceEnabled(name: string, enabled: boolean): void {
  const config = loadConfig();
  const disabled = new Set(getDisabledMarketplaces());
  
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }
  
  config.sync = config.sync || {};
  config.sync.disabledMarketplaces = Array.from(disabled).join(",") || undefined;
  saveConfig(config);
}

export function getDisabledPiMarketplaces(): string[] {
  const config = loadConfig();
  const raw = config.sync?.disabledPiMarketplaces;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function setPiMarketplaceEnabled(name: string, enabled: boolean): void {
  const config = loadConfig();
  const disabled = new Set(getDisabledPiMarketplaces());
  
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }
  
  config.sync = config.sync || {};
  config.sync.disabledPiMarketplaces = Array.from(disabled).join(",") || undefined;
  saveConfig(config);
}
