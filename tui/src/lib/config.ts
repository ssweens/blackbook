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

export interface SyncConfig {
  configRepo?: string;
  assetsRepo?: string;  // defaults to configRepo if not specified
  disabledMarketplaces?: string;    // comma-separated list of disabled plugin marketplace names
  disabledPiMarketplaces?: string;  // comma-separated list of disabled Pi marketplace names
  packageManager?: PackageManager;
}

export interface PiMarketplacesConfig {
  [name: string]: string;  // name -> local path or git URL
}

export interface PluginComponentEntry {
  disabled_skills?: string;
  disabled_commands?: string;
  disabled_agents?: string;
}

export interface LegacyConfig {
  marketplaces?: Record<string, string>;
  piMarketplaces?: PiMarketplacesConfig;
  tools?: Record<string, ToolConfig>;
  assets?: Record<string, any>[];
  sync?: SyncConfig;
  configs?: Record<string, any>[];
  plugins?: Record<string, Record<string, PluginComponentEntry>>;
}

export function loadConfig(configPath?: string): LegacyConfig {
  const path = configPath || getConfigPath();
  
  if (!existsSync(path)) {
    return { marketplaces: {}, tools: {}, assets: [], configs: [] };
  }

  return withFileLockSync(path, () => {
    const content = readFileSync(path, "utf-8");
    const result: LegacyConfig = { marketplaces: {}, tools: {}, assets: [], configs: [] };

    let currentSection = "";
    let currentTool = "";
    let currentInstance: ToolInstanceConfig | null = null;
    let currentAsset: Record<string, any> | null = null;
    let currentConfig: Record<string, any> | null = null;
    
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
          const asset: Record<string, any> = { name: "" };
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
          const config: Record<string, any> = { name: "", toolId: "" };
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
        if (section.startsWith("plugins.")) {
          // [plugins.marketplace-name.plugin-name]
          const pluginParts = section.replace("plugins.", "").split(".");
          if (pluginParts.length >= 2) {
            currentSection = "plugins";
            const marketplace = pluginParts[0];
            const pluginName = pluginParts.slice(1).join(".");
            result.plugins = result.plugins || {};
            result.plugins[marketplace] = result.plugins[marketplace] || {};
            result.plugins[marketplace][pluginName] = result.plugins[marketplace][pluginName] || {};
            // Store reference for KV parsing
            currentTool = `${marketplace}:${pluginName}`;
          }
          currentInstance = null;
          currentAsset = null;
          currentConfig = null;
        } else if (section.startsWith("tools.")) {
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
        } else if (currentSection === "plugins" && currentTool) {
          const [marketplace, pluginName] = currentTool.split(":", 2);
          if (result.plugins?.[marketplace]?.[pluginName]) {
            (result.plugins[marketplace][pluginName] as Record<string, string>)[key] = value;
          }
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
                               key === "disabled_pi_marketplaces" ? "disabledPiMarketplaces" :
                               key === "package_manager" ? "packageManager" : key;
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

export function saveConfig(config: LegacyConfig, configPath?: string): void {
  const path = configPath || getConfigPath();
  
  const lines: string[] = [
    "# Blackbook Configuration",
    "# See https://github.com/ssweens/blackbook for documentation",
    "",
  ];

  const hasMarketplaces = config.marketplaces && Object.keys(config.marketplaces).length > 0;
  const hasPiMarketplaces = config.piMarketplaces && Object.keys(config.piMarketplaces).length > 0;
  const hasTools = config.tools && Object.keys(config.tools).length > 0;
  const hasAssets = config.assets && config.assets.length > 0;
  const hasSync = Boolean(
    config.sync && (
      config.sync.configRepo ||
      config.sync.assetsRepo ||
      config.sync.disabledMarketplaces ||
      config.sync.disabledPiMarketplaces ||
      config.sync.packageManager
    )
  );
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

  if (hasPiMarketplaces) {
    lines.push("[pi-marketplaces]");
    for (const [name, source] of Object.entries(config.piMarketplaces!)) {
      lines.push(`${name} = "${source}"`);
    }
    lines.push("");
  }

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
    if (config.sync!.packageManager) {
      lines.push(`package_manager = "${config.sync!.packageManager}"`);
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

  // Write plugin component configs
  if (config.plugins) {
    for (const [marketplace, plugins] of Object.entries(config.plugins)) {
      for (const [pluginName, pluginConfig] of Object.entries(plugins)) {
        const hasContent = pluginConfig.disabled_skills || pluginConfig.disabled_commands || pluginConfig.disabled_agents;
        if (!hasContent) continue;
        lines.push(`[plugins.${marketplace}.${pluginName}]`);
        if (pluginConfig.disabled_skills) {
          lines.push(`disabled_skills = "${pluginConfig.disabled_skills}"`);
        }
        if (pluginConfig.disabled_commands) {
          lines.push(`disabled_commands = "${pluginConfig.disabled_commands}"`);
        }
        if (pluginConfig.disabled_agents) {
          lines.push(`disabled_agents = "${pluginConfig.disabled_agents}"`);
        }
        lines.push("");
      }
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
    tools,
    files: buildInitialYamlFiles(tools),
    configs: [],
    plugins: {},
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

export function updateToolInstanceConfig(
  toolId: string,
  instanceId: string,
  updates: ToolInstanceConfig
): void {
  const { config, configPath } = loadYamlConfig();
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
  saveYamlConfig(config, configPath);
}

export function addMarketplace(name: string, url: string): void {
  const { config, configPath } = loadYamlConfig();
  config.marketplaces[name] = url;
  saveYamlConfig(config, configPath);
}

export function removeMarketplace(name: string): void {
  const { config, configPath } = loadYamlConfig();
  delete config.marketplaces[name];
  saveYamlConfig(config, configPath);
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
      });
    });
  }

  return instances;
}

export function getEnabledToolInstances(): ToolInstance[] {
  return getToolInstances().filter((instance) => instance.enabled);
}

export function parseMarketplaces(config?: LegacyConfig): Marketplace[] {
  // Use YAML config for marketplaces (legacy TOML parser can't read YAML)
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
 * Get configured Pi marketplaces from legacy [pi-marketplaces] section.
 * Returns a map of marketplace name -> source (local path or git URL).
 */
export function getPiMarketplaces(): PiMarketplacesConfig {
  const config = loadConfig();
  return config.piMarketplaces ?? {};
}

export function getDisabledMarketplaces(): string[] {
  const { config } = loadYamlConfig();
  return config.settings.disabled_marketplaces;
}

export function setMarketplaceEnabled(name: string, enabled: boolean): void {
  const { config, configPath } = loadYamlConfig();
  const disabled = new Set(config.settings.disabled_marketplaces);

  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }

  config.settings.disabled_marketplaces = Array.from(disabled);
  saveYamlConfig(config, configPath);
}

export function addPiMarketplace(name: string, source: string): void {
  const config = loadConfig();
  config.piMarketplaces = config.piMarketplaces || {};
  config.piMarketplaces[name] = source;
  saveConfig(config);
}

export function removePiMarketplace(name: string): void {
  const config = loadConfig();
  if (config.piMarketplaces) {
    delete config.piMarketplaces[name];
    saveConfig(config);
  }
}

export function getDisabledPiMarketplaces(): string[] {
  const { config } = loadYamlConfig();
  return config.settings.disabled_pi_marketplaces;
}

export function setPiMarketplaceEnabled(name: string, enabled: boolean): void {
  const { config, configPath } = loadYamlConfig();
  const disabled = new Set(config.settings.disabled_pi_marketplaces);

  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }

  config.settings.disabled_pi_marketplaces = Array.from(disabled);
  saveYamlConfig(config, configPath);
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
  const { config, configPath } = loadYamlConfig();
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

  saveYamlConfig(config, configPath);
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
