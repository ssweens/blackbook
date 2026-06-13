import { existsSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import type { Plugin, ToolInstance } from "./types.js";
import { scanPluginContents } from "./path-utils.js";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_BRIDGE_STATE_PATHS = [
  join(PI_AGENT_DIR, "pi-plugins", "state.json"),
  join(PI_AGENT_DIR, "pi-claude-marketplace", "state.json"),
] as const;

export interface PiBridgeInstalledPlugin {
  marketplace: string;
  name: string;
  version?: string;
  resolvedSource?: string;
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  hasMcp: boolean;
}

function readPiBridgeState(): Record<string, any> | null {
  for (const statePath of PI_BRIDGE_STATE_PATHS) {
    try {
      if (!existsSync(statePath)) continue;
      return JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      // Try the next compatible state path.
    }
  }
  return null;
}

export function listPiBridgeInstalledPlugins(): PiBridgeInstalledPlugin[] {
  const state = readPiBridgeState();
  const marketplaces = state?.marketplaces;
  if (!marketplaces || typeof marketplaces !== "object") return [];

  const results: PiBridgeInstalledPlugin[] = [];

  for (const [marketplace, rawMarketplace] of Object.entries(marketplaces as Record<string, any>)) {
    const plugins = rawMarketplace?.plugins;
    if (!plugins || typeof plugins !== "object") continue;

    for (const [name, rawPlugin] of Object.entries(plugins as Record<string, any>)) {
      const resolvedSource = typeof rawPlugin?.resolvedSource === "string" ? rawPlugin.resolvedSource : undefined;
      const scanned = resolvedSource ? scanPluginContents(resolvedSource) : { skills: [], commands: [], agents: [], hooks: [], hasMcp: false };
      results.push({
        marketplace,
        name,
        version: typeof rawPlugin?.version === "string" ? rawPlugin.version : undefined,
        resolvedSource,
        skills: scanned.skills,
        commands: scanned.commands,
        agents: scanned.agents,
        hooks: scanned.hooks,
        hasMcp: scanned.hasMcp,
      });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name) || a.marketplace.localeCompare(b.marketplace));
  return results;
}

export function getPiBridgeInstalledPluginIds(): Set<string> {
  return new Set(listPiBridgeInstalledPlugins().map((plugin) => `${plugin.name}@${plugin.marketplace}`));
}

export function findPiBridgeInstalledPlugin(
  plugin: Pick<Plugin, "name" | "marketplace" | "installedMarketplace">,
): PiBridgeInstalledPlugin | null {
  const candidates = [plugin.installedMarketplace, plugin.marketplace].filter(Boolean) as string[];
  const installed = listPiBridgeInstalledPlugins();
  for (const marketplace of candidates) {
    const match = installed.find((entry) => entry.name === plugin.name && entry.marketplace === marketplace);
    if (match) return match;
  }
  return null;
}

export function resolvePiBridgePluginRoot(
  plugin: Pick<Plugin, "name" | "marketplace" | "installedMarketplace">,
): string | null {
  return findPiBridgeInstalledPlugin(plugin)?.resolvedSource ?? null;
}

function elidePluginPrefix(pluginName: string, componentName: string): string {
  if (componentName === pluginName) return componentName;
  const prefix = `${pluginName}-`;
  return componentName.startsWith(prefix) ? componentName.slice(prefix.length) : componentName;
}

function generatedPiSkillName(pluginName: string, sourceName: string): string {
  return sourceName === pluginName ? pluginName : `${pluginName}-${elidePluginPrefix(pluginName, sourceName)}`;
}

function generatedPiCommandName(pluginName: string, sourceName: string): string {
  return `${pluginName}:${elidePluginPrefix(pluginName, sourceName)}`;
}

function generatedPiAgentName(pluginName: string, sourceName: string): string {
  return `pi-plugins-${pluginName}-${elidePluginPrefix(pluginName, sourceName)}`;
}

export function resolveInstalledPluginComponentPath(
  instance: Pick<ToolInstance, "toolId" | "configDir" | "skillsSubdir" | "commandsSubdir" | "agentsSubdir">,
  plugin: Pick<Plugin, "name" | "marketplace" | "installedMarketplace">,
  kind: "skill" | "command" | "agent",
  name: string,
  manifestDest?: string,
): string | null {
  if (instance.toolId === "pi") {
    if (kind === "skill") {
      return join(tmpdir(), "pi-plugins-user-skills", generatedPiSkillName(plugin.name, name));
    }
    if (kind === "command") {
      return join(tmpdir(), "pi-plugins-user-prompts", `${generatedPiCommandName(plugin.name, name)}.md`);
    }
    return join(PI_AGENT_DIR, "agents", `${generatedPiAgentName(plugin.name, name)}.md`);
  }

  if (manifestDest) {
    return manifestDest.startsWith("/") ? manifestDest : join(instance.configDir, manifestDest);
  }

  const subdir = kind === "skill"
    ? instance.skillsSubdir
    : kind === "command"
      ? instance.commandsSubdir
      : instance.agentsSubdir;
  if (!subdir) return null;

  return kind === "skill"
    ? join(instance.configDir, subdir, name)
    : join(instance.configDir, subdir, `${name}.md`);
}
