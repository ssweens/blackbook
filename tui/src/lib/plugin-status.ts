/**
 * Plugin installation status checking and component toggling
 */

import { readFileSync, existsSync, lstatSync, unlinkSync, rmSync, renameSync } from "fs";
import { join } from "path";
import type { Plugin, ToolInstance } from "./types.js";
import { getToolInstances, getEnabledToolInstances, setPluginComponentEnabled } from "./config.js";
import { safePath, validatePluginMetadata, logError } from "./validation.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { getPluginSourcePath, instanceKey, createSymlink, isSymlink } from "./plugin-helpers.js";

export interface ToolInstallStatus {
  toolId: string;
  instanceId: string;
  name: string;
  installed: boolean;
  supported: boolean;
  enabled: boolean;
}

function isConfigOnlyInstance(instance: ToolInstance): boolean {
  return !instance.skillsSubdir && !instance.commandsSubdir && !instance.agentsSubdir;
}

export function getPluginToolStatus(plugin: Plugin): ToolInstallStatus[] {
  const statuses: ToolInstallStatus[] = [];
  try {
    validatePluginMetadata(plugin);
  } catch (error) {
    logError(`Invalid plugin metadata for ${plugin.name}`, error);
    return statuses;
  }
  const instances = getToolInstances();

  for (const instance of instances) {
    const hasSkills = plugin.skills.length > 0;
    const hasCommands = plugin.commands.length > 0;
    const hasAgents = plugin.agents.length > 0;

    const canInstallSkills = hasSkills && instance.skillsSubdir !== null;
    const canInstallCommands = hasCommands && instance.commandsSubdir !== null;
    const canInstallAgents = hasAgents && instance.agentsSubdir !== null;

    const supported = canInstallSkills || canInstallCommands || canInstallAgents ||
                      (instance.toolId === "claude-code" && (plugin.hasMcp || plugin.hasLsp));

    let installed = false;
    const enabled = instance.enabled;

    if (enabled && supported) {
      // Check for installed components by looking at actual files/symlinks
      if (canInstallSkills && instance.skillsSubdir) {
        for (const skill of plugin.skills) {
          const base = join(instance.configDir, instance.skillsSubdir);
          const skillPath = safePath(base, skill);
          if (existsSync(skillPath)) {
            installed = true;
            break;
          }
        }
      }
      if (!installed && canInstallCommands && instance.commandsSubdir) {
        for (const cmd of plugin.commands) {
          const base = join(instance.configDir, instance.commandsSubdir);
          const cmdPath = safePath(base, `${cmd}.md`);
          if (existsSync(cmdPath)) {
            installed = true;
            break;
          }
        }
      }
      if (!installed && canInstallAgents && instance.agentsSubdir) {
        for (const agent of plugin.agents) {
          const base = join(instance.configDir, instance.agentsSubdir);
          const agentPath = safePath(base, `${agent}.md`);
          if (existsSync(agentPath)) {
            installed = true;
            break;
          }
        }
      }

      // For MCP/LSP-only plugins on Claude, check installed_plugins.json
      if (!installed && (plugin.hasMcp || plugin.hasLsp) && instance.toolId === "claude-code") {
        const installedPluginsPath = join(instance.configDir, "plugins/installed_plugins.json");
        if (existsSync(installedPluginsPath)) {
          try {
            const content = readFileSync(installedPluginsPath, "utf-8");
            const data = JSON.parse(content);
            if (data.plugins && typeof data.plugins === "object") {
              for (const key of Object.keys(data.plugins)) {
                const pluginName = key.split("@")[0];
                if (pluginName === plugin.name) {
                  installed = true;
                  break;
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    statuses.push({
      toolId: instance.toolId,
      instanceId: instance.instanceId,
      name: instance.name,
      installed,
      supported,
      enabled,
    });
  }

  return statuses;
}

export function togglePluginComponent(
  plugin: Plugin,
  kind: "skill" | "command" | "agent",
  componentName: string,
  enabled: boolean
): { success: boolean; error?: string } {
  // Update config first
  setPluginComponentEnabled(plugin.marketplace, plugin.name, kind, componentName, enabled);

  const instances = getEnabledToolInstances();
  const manifest = loadManifest();
  const sourcePath = getPluginSourcePath(plugin);

  for (const instance of instances) {
    if (isConfigOnlyInstance(instance)) continue;
    const key = instanceKey(instance);
    const itemKey = `${kind}:${componentName}`;

    if (!enabled) {
      // Remove the component from this instance
      if (!manifest.tools[key]) continue;
      const item = manifest.tools[key].items[itemKey];
      if (!item) continue;

      // Resolve the actual destination path
      const subdir = kind === "skill" ? instance.skillsSubdir :
                     kind === "command" ? instance.commandsSubdir :
                     instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const destPath = join(instance.configDir, subdir, suffix);

      try {
        if (existsSync(destPath) || isSymlink(destPath)) {
          const stat = lstatSync(destPath);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            rmSync(destPath, { recursive: true });
          } else {
            unlinkSync(destPath);
          }
        }
      } catch (error) {
        logError(`Failed to remove ${kind} ${componentName} from ${instance.name}`, error);
      }

      // Restore backup if exists
      if (item.backup && existsSync(item.backup)) {
        try {
          renameSync(item.backup, destPath);
        } catch (error) {
          logError(`Failed to restore backup for ${componentName}`, error);
        }
      }

      if (item.previous) {
        manifest.tools[key].items[itemKey] = item.previous;
      } else {
        delete manifest.tools[key].items[itemKey];
      }
    } else {
      // Enable: create symlink/copy for this component
      if (!sourcePath) continue;

      const subdir = kind === "skill" ? instance.skillsSubdir :
                     kind === "command" ? instance.commandsSubdir :
                     instance.agentsSubdir;
      if (!subdir) continue;

      const suffix = kind === "skill" ? componentName : `${componentName}.md`;
      const src = join(sourcePath, `${kind}s`, suffix);
      if (!existsSync(src)) continue;

      const dest = join(instance.configDir, subdir, suffix);

      if (!manifest.tools[key]) {
        manifest.tools[key] = { items: {} };
      }

      const result = createSymlink(src, dest, plugin.name, kind, componentName);
      if (result.success) {
        manifest.tools[key].items[itemKey] = {
          kind,
          name: componentName,
          source: src,
          dest: join(subdir, suffix),
          backup: null,
          owner: plugin.name,
          previous: null,
        };
      }
    }
  }

  saveManifest(manifest);
  return { success: true };
}
