import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import type { ToolTarget, Marketplace } from "./types.js";

const DEFAULT_TOOLS: Record<string, ToolTarget> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude",
    configDir: join(homedir(), ".claude"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: false,
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    configDir: join(homedir(), ".config/opencode"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: false,
  },
  "amp-code": {
    id: "amp-code",
    name: "Amp",
    configDir: join(homedir(), ".config/amp"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: false,
  },
  "openai-codex": {
    id: "openai-codex",
    name: "Codex",
    configDir: join(homedir(), ".codex"),
    skillsSubdir: "skills",
    commandsSubdir: null,
    agentsSubdir: null,
    enabled: false,
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
        result[name] = entry.source.path;
      }
    }

    return result;
  } catch {
    return {};
  }
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

export interface ToolConfig {
  enabled?: boolean;
  configDir?: string;
}

export interface TomlConfig {
  marketplaces?: Record<string, string>;
  tools?: Record<string, ToolConfig>;
}

export function loadConfig(configPath?: string): TomlConfig {
  const path = configPath || getConfigPath();
  
  if (!existsSync(path)) {
    return { marketplaces: {}, tools: {} };
  }

  const content = readFileSync(path, "utf-8");
  const result: TomlConfig = { marketplaces: {}, tools: {} };

  let currentSection = "";
  let currentTool = "";
  
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1];
      if (section.startsWith("tools.")) {
        currentSection = "tools";
        currentTool = section.replace("tools.", "");
        result.tools![currentTool] = result.tools![currentTool] || {};
      } else {
        currentSection = section;
        currentTool = "";
      }
      continue;
    }

    const kvStringMatch = trimmed.match(/^(\S+)\s*=\s*"(.+)"$/);
    const kvBoolMatch = trimmed.match(/^(\S+)\s*=\s*(true|false)$/);
    if (kvStringMatch) {
      const [, key, value] = kvStringMatch;
      if (currentSection === "marketplaces") {
        result.marketplaces![key] = value;
      } else if (currentSection === "tools" && currentTool) {
        const normalizedKey = key === "config_dir" ? "configDir" : key;
        (result.tools![currentTool] as Record<string, string>)[normalizedKey] = value;
      }
    } else if (kvBoolMatch) {
      const [, key, rawValue] = kvBoolMatch;
      const value = rawValue === "true";
      if (currentSection === "tools" && currentTool) {
        const normalizedKey = key === "config_dir" ? "configDir" : key;
        (result.tools![currentTool] as Record<string, boolean>)[normalizedKey] = value;
      }
    }
  }

  return result;
}

export function saveConfig(config: TomlConfig, configPath?: string): void {
  const path = configPath || getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  
  const lines: string[] = [
    "# Blackbook Configuration",
    "# See https://github.com/ssweens/blackbook for documentation",
    "",
  ];

  const hasMarketplaces = config.marketplaces && Object.keys(config.marketplaces).length > 0;
  const hasTools = config.tools && Object.keys(config.tools).length > 0;

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

  if (hasTools) {
    for (const [toolId, toolConfig] of Object.entries(config.tools!)) {
      lines.push(`[tools.${toolId}]`);
      const orderedEntries: Array<[string, string | boolean]> = [];
      if (typeof toolConfig.enabled === "boolean") {
        orderedEntries.push(["enabled", toolConfig.enabled]);
      }
      if (typeof toolConfig.configDir === "string") {
        orderedEntries.push(["config_dir", toolConfig.configDir]);
      }
      for (const [key, value] of orderedEntries) {
        if (typeof value === "boolean") {
          lines.push(`${key} = ${value}`);
        } else {
          lines.push(`${key} = "${value}"`);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("# Enable tools and override config directories (optional). Examples:");
    lines.push("# [tools.claude-code]");
    lines.push("# enabled = true");
    lines.push("# config_dir = \"~/.claude\"");
    lines.push("");
    lines.push("# [tools.opencode]");
    lines.push("# enabled = true");
    lines.push("# config_dir = \"~/.config/opencode\"");
  }

  writeFileSync(path, lines.join("\n"));
}

const DEFAULT_INITIAL_MARKETPLACES: Record<string, string> = {
  "claude-plugins-official": "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
};

function buildInitialToolConfig(): Record<string, ToolConfig> {
  const tools: Record<string, ToolConfig> = {};
  for (const [toolId, tool] of Object.entries(DEFAULT_TOOLS)) {
    if (existsSync(tool.configDir)) {
      tools[toolId] = { enabled: true, configDir: tool.configDir };
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

export function updateToolConfig(toolId: string, updates: ToolConfig): void {
  const config = loadConfig();
  config.tools = config.tools || {};
  const existing = config.tools[toolId] || {};
  const next: ToolConfig = { ...existing, ...updates };
  config.tools[toolId] = next;
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

export function getMergedConfig(): { marketplaces: Record<string, string>; tools: Record<string, ToolTarget> } {
  const userConfig = loadConfig();
  
  // Merge marketplaces: user config overrides/extends defaults
  const marketplaces = { ...DEFAULT_MARKETPLACES, ...userConfig.marketplaces };
  
  // Merge tools: user config overrides specific fields
  const tools: Record<string, ToolTarget> = {};
  for (const [toolId, defaultTool] of Object.entries(DEFAULT_TOOLS)) {
    const userTool = userConfig.tools?.[toolId] || {};
    const enabled = typeof userTool.enabled === "boolean" ? userTool.enabled : false;
    const configDir = typeof userTool.configDir === "string" ? userTool.configDir : defaultTool.configDir;
    tools[toolId] = {
      ...defaultTool,
      configDir,
      enabled,
    };
  }
  
  return { marketplaces, tools };
}

export function getTools(): Record<string, ToolTarget> {
  return getMergedConfig().tools;
}

export function getEnabledTools(): Record<string, ToolTarget> {
  const tools = getMergedConfig().tools;
  const enabled: Record<string, ToolTarget> = {};
  for (const [toolId, tool] of Object.entries(tools)) {
    if (tool.enabled) {
      enabled[toolId] = tool;
    }
  }
  return enabled;
}

export function getToolList(): ToolTarget[] {
  const tools = getMergedConfig().tools;
  return TOOL_IDS.map((toolId) => tools[toolId]).filter((tool): tool is ToolTarget => Boolean(tool));
}

export function parseMarketplaces(config?: TomlConfig): Marketplace[] {
  const merged = getMergedConfig();
  const blackbookUrls = config?.marketplaces || merged.marketplaces;
  const claudeUrls = merged.tools["claude-code"].enabled ? loadClaudeMarketplaces() : {};
  const marketplaces: Marketplace[] = [];

  // Add Blackbook marketplaces first (they take precedence)
  for (const [name, url] of Object.entries(blackbookUrls)) {
    const isLocal = url.startsWith("/") || url.startsWith("~");
    marketplaces.push({
      name,
      url,
      isLocal,
      plugins: [],
      availableCount: 0,
      installedCount: 0,
      autoUpdate: false,
      source: "blackbook",
    });
  }

  // Add Claude marketplaces (skip if name already exists from Blackbook)
  const blackbookNames = new Set(Object.keys(blackbookUrls));
  for (const [name, url] of Object.entries(claudeUrls)) {
    if (blackbookNames.has(name)) continue;
    
    const isLocal = url.startsWith("/") || url.startsWith("~");
    marketplaces.push({
      name,
      url,
      isLocal,
      plugins: [],
      availableCount: 0,
      installedCount: 0,
      autoUpdate: false,
      source: "claude",
    });
  }

  return marketplaces;
}
