import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  lstatSync,
  realpathSync,
  readdirSync,
  copyFileSync,
  cpSync,
  rmSync,
} from "fs";
import { promisify } from "util";
import { exec } from "child_process";

const execAsync = promisify(exec);
import { join, dirname } from "path";
import { tmpdir } from "os";
import { getCacheDir, getEnabledToolInstances, getToolInstances } from "./config.js";
import type { Plugin, InstalledItem, ToolInstance } from "./types.js";

export function getPluginsCacheDir(): string {
  return join(getCacheDir(), "plugins");
}

function instanceKey(instance: ToolInstance): string {
  return `${instance.toolId}:${instance.instanceId}`;
}

async function execClaudeCommand(instance: ToolInstance, args: string): Promise<void> {
  await execAsync(`claude plugin ${args}`, {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: instance.configDir,
    },
  });
}

function parseGithubRepoFromUrl(url: string): { repo: string; ref: string } | null {
  const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/);
  if (rawMatch) return { repo: rawMatch[1], ref: rawMatch[2] };

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (gitMatch) return { repo: gitMatch[1], ref: "main" };

  return null;
}

export async function downloadPlugin(plugin: Plugin, marketplaceUrl: string): Promise<string | null> {
  const pluginsDir = getPluginsCacheDir();
  const pluginDir = join(pluginsDir, plugin.marketplace, plugin.name);

  if (existsSync(pluginDir)) {
    return pluginDir;
  }

  mkdirSync(pluginDir, { recursive: true });

  let repoUrl: string | null = null;
  let ref = "main";
  let subPath = "";

  const source = plugin.source;
  if (typeof source === "object") {
    if (source.source === "github" && source.repo) {
      repoUrl = `https://github.com/${source.repo}.git`;
      ref = source.ref || "main";
    } else if (source.source === "url" && source.url) {
      const parsed = parseGithubRepoFromUrl(source.url);
      if (parsed) {
        repoUrl = `https://github.com/${parsed.repo}.git`;
        ref = parsed.ref;
      }
    }
  } else if (typeof source === "string" && source.startsWith("./")) {
    const parsed = parseGithubRepoFromUrl(marketplaceUrl);
    if (parsed) {
      repoUrl = `https://github.com/${parsed.repo}.git`;
      ref = parsed.ref;
      subPath = source.replace(/^\.\//, "");
    }
  }

  if (!repoUrl) {
    rmSync(pluginDir, { recursive: true, force: true });
    return null;
  }

  try {
    const tempDir = join(tmpdir(), `blackbook-clone-${Date.now()}`);
    await execAsync(`git clone --depth 1 --branch "${ref}" "${repoUrl}" "${tempDir}"`);

    const sourceDir = subPath ? join(tempDir, subPath) : tempDir;

    if (!existsSync(sourceDir)) {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(pluginDir, { recursive: true, force: true });
      return null;
    }

    cpSync(sourceDir, pluginDir, { recursive: true });

    rmSync(tempDir, { recursive: true, force: true });

    return pluginDir;
  } catch {
    rmSync(pluginDir, { recursive: true, force: true });
    return null;
  }
}

export function getPluginSourcePath(plugin: Plugin): string | null {
  const pluginDir = join(getPluginsCacheDir(), plugin.marketplace, plugin.name);
  if (existsSync(pluginDir)) {
    return pluginDir;
  }
  return null;
}

export function manifestPath(cacheDir?: string): string {
  return join(cacheDir || getCacheDir(), "installed_items.json");
}

interface Manifest {
  tools: Record<string, { items: Record<string, InstalledItem> }>;
}

export function loadManifest(cacheDir?: string): Manifest {
  const path = manifestPath(cacheDir);
  if (!existsSync(path)) return { tools: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { tools: {} };
  }
}

export function saveManifest(manifest: Manifest, cacheDir?: string): void {
  const path = manifestPath(cacheDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

export function createSymlink(
  source: string,
  target: string,
  pluginName?: string,
  itemKind?: string,
  itemName?: string
): boolean {
  if (!existsSync(source)) return false;

  mkdirSync(dirname(target), { recursive: true });

  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target)) {
      try {
        const actual = realpathSync(target);
        const expected = realpathSync(source);
        if (actual === expected) return true;
      } catch {
        // Broken symlink
      }
    }

    let backupPath: string;
    if (pluginName && itemKind && itemName) {
      const backupDir = join(getCacheDir(), "backups", pluginName, itemKind);
      mkdirSync(backupDir, { recursive: true });
      backupPath = join(backupDir, itemName);

      if (existsSync(backupPath) || isSymlink(backupPath)) {
        rmSync(backupPath, { recursive: true, force: true });
      }
    } else {
      backupPath = `${target}.bak`;
      if (existsSync(backupPath) || isSymlink(backupPath)) {
        let i = 1;
        let candidate = `${backupPath}.${i}`;
        while (existsSync(candidate) || isSymlink(candidate)) {
          i += 1;
          candidate = `${backupPath}.${i}`;
        }
        backupPath = candidate;
      }
    }

    renameSync(target, backupPath);
  }

  const tmpPath = join(tmpdir(), `.tmp_${Date.now()}`);
  try {
    symlinkSync(source, tmpPath);
    renameSync(tmpPath, target);
    return true;
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore
    }
    return false;
  }
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function removeSymlink(target: string): boolean {
  if (!isSymlink(target)) return false;
  unlinkSync(target);
  return true;
}

function isPluginInstalledInClaudeInstance(plugin: Plugin, instance: ToolInstance): boolean {
  const claudePluginsDir = join(instance.configDir, "plugins/cache");
  if (!existsSync(claudePluginsDir)) return false;

  for (const marketplace of readdirSync(claudePluginsDir)) {
    const mpDir = join(claudePluginsDir, marketplace);
    if (!existsSync(mpDir)) continue;

    for (const pluginName of readdirSync(mpDir)) {
      if (pluginName === plugin.name) return true;
    }
  }

  return false;
}

export interface InstallResult {
  success: boolean;
  linkedInstances: Record<string, number>;
  errors: string[];
  skippedInstances: string[];
}

export async function installPlugin(plugin: Plugin, marketplaceUrl: string): Promise<InstallResult> {
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
  const result: InstallResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, `install "${plugin.name}"`);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch (e) {
      result.errors.push(
        `Claude install failed for ${instance.name}: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }
  }

  if (nonClaudeInstances.length > 0) {
    const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

    if (!sourcePath) {
      if (Object.values(result.linkedInstances).every((count) => count === 0)) {
        result.errors.push(`Failed to download plugin ${plugin.name}`);
        return result;
      }
    } else {
      for (const instance of nonClaudeInstances) {
        const { count } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
        result.linkedInstances[instanceKey(instance)] = count;
      }
    }
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function uninstallPlugin(plugin: Plugin): Promise<boolean> {
  const enabledInstances = getEnabledToolInstances();
  let claudeSuccess = false;
  let removedCount = 0;

  if (enabledInstances.length === 0) {
    return false;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, `uninstall "${plugin.name}"`);
      claudeSuccess = true;
    } catch { /* ignore */ }
  }

  for (const instance of nonClaudeInstances) {
    removedCount += uninstallPluginItemsFromInstance(plugin.name, instance);
  }

  const pluginDir = join(getPluginsCacheDir(), plugin.marketplace, plugin.name);
  try {
    rmSync(pluginDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  return claudeSuccess || removedCount > 0;
}

export interface EnableResult {
  success: boolean;
  linkedInstances: Record<string, number>;
  errors: string[];
  skippedInstances: string[];
}

function copyWithBackup(
  src: string,
  dest: string,
  pluginName: string,
  itemKind: string,
  itemName: string
): { dest: string; backup: string | null } {
  let backupPath: string | null = null;
  
  if (existsSync(dest) || isSymlink(dest)) {
    const backupDir = join(getCacheDir(), "backups", pluginName, itemKind);
    mkdirSync(backupDir, { recursive: true });
    const backup = join(backupDir, itemName);
    
    if (existsSync(backup) || isSymlink(backup)) {
      rmSync(backup, { recursive: true, force: true });
    }
    
    renameSync(dest, backup);
    backupPath = backup;
  }
  
  mkdirSync(dirname(dest), { recursive: true });
  
  const srcStat = lstatSync(src);
  if (srcStat.isDirectory()) {
    cpSync(src, dest, { recursive: true });
  } else {
    copyFileSync(src, dest);
  }
  
  return { dest, backup: backupPath };
}

function installPluginItemsToInstance(
  pluginName: string,
  sourcePath: string,
  instance: ToolInstance
): { count: number; items: InstalledItem[] } {
  if (!instance.enabled) return { count: 0, items: [] };
  
  const items: InstalledItem[] = [];
  let count = 0;
  
  if (instance.skillsSubdir) {
    const skillsDir = join(sourcePath, "skills");
    if (existsSync(skillsDir)) {
      try {
        for (const entry of readdirSync(skillsDir)) {
          const src = join(skillsDir, entry);
          if (existsSync(join(src, "SKILL.md"))) {
            const dest = join(instance.configDir, instance.skillsSubdir, entry);
            const result = copyWithBackup(src, dest, pluginName, "skill", entry);
            items.push({
              kind: "skill",
              name: entry,
              source: src,
              dest: result.dest,
              backup: result.backup,
            });
            count++;
          }
        }
      } catch { /* ignore */ }
    }
  }
  
  if (instance.commandsSubdir) {
    const commandsDir = join(sourcePath, "commands");
    if (existsSync(commandsDir)) {
      try {
        for (const entry of readdirSync(commandsDir)) {
          if (entry.endsWith(".md")) {
            const src = join(commandsDir, entry);
            const dest = join(instance.configDir, instance.commandsSubdir, entry);
            const result = copyWithBackup(src, dest, pluginName, "command", entry);
            items.push({
              kind: "command",
              name: entry.replace(/\.md$/, ""),
              source: src,
              dest: result.dest,
              backup: result.backup,
            });
            count++;
          }
        }
      } catch { /* ignore */ }
    }
  }
  
  if (instance.agentsSubdir) {
    const agentsDir = join(sourcePath, "agents");
    if (existsSync(agentsDir)) {
      try {
        for (const entry of readdirSync(agentsDir)) {
          if (entry.endsWith(".md")) {
            const src = join(agentsDir, entry);
            const dest = join(instance.configDir, instance.agentsSubdir, entry);
            const result = copyWithBackup(src, dest, pluginName, "agent", entry);
            items.push({
              kind: "agent",
              name: entry.replace(/\.md$/, ""),
              source: src,
              dest: result.dest,
              backup: result.backup,
            });
            count++;
          }
        }
      } catch { /* ignore */ }
    }
  }
  
  if (items.length > 0) {
    const manifest = loadManifest();
    const key = instanceKey(instance);
    if (!manifest.tools[key]) {
      manifest.tools[key] = { items: {} };
    }
    const pluginKey = `plugin:${pluginName}`;
    manifest.tools[key].items[pluginKey] = items[0];
    for (const item of items) {
      manifest.tools[key].items[`${item.kind}:${item.name}`] = item;
    }
    saveManifest(manifest);
  }
  
  return { count, items };
}

function uninstallPluginItemsFromInstance(pluginName: string, instance: ToolInstance): number {
  const manifest = loadManifest();
  const key = instanceKey(instance);
  const toolManifest = manifest.tools[key];
  if (!toolManifest) return 0;
  
  let removed = 0;
  const keysToRemove: string[] = [];
  const processedDests = new Set<string>();
  
  for (const [key, item] of Object.entries(toolManifest.items)) {
    if (item.source.includes(pluginName)) {
      const dest = item.dest;
      const backup = item.backup;
      
      if (!processedDests.has(dest)) {
        processedDests.add(dest);
        try {
          if (existsSync(dest) || isSymlink(dest)) {
            const stat = lstatSync(dest);
            if (stat.isDirectory() && !stat.isSymbolicLink()) {
              rmSync(dest, { recursive: true });
            } else {
              unlinkSync(dest);
            }
            removed++;
          }
          
          if (backup && (existsSync(backup) || isSymlink(backup))) {
            renameSync(backup, dest);
          }
        } catch { /* ignore */ }
      }
      
      keysToRemove.push(key);
    }
  }
  
  for (const key of keysToRemove) {
    delete toolManifest.items[key];
  }
  saveManifest(manifest);
  
  return removed;
}

export async function enablePlugin(plugin: Plugin, marketplaceUrl?: string): Promise<EnableResult> {
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, `enable "${plugin.name}"`);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch { /* ignore */ }
  }

  let sourcePath = getPluginSourcePath(plugin);
  
  if (!sourcePath && marketplaceUrl) {
    sourcePath = await downloadPlugin(plugin, marketplaceUrl);
  }
  
  if (sourcePath) {
    for (const instance of nonClaudeInstances) {
      const { count } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
      result.linkedInstances[instanceKey(instance)] = count;
    }
  } else if (nonClaudeInstances.length > 0) {
    result.errors.push(`Plugin source not found for ${plugin.name}`);
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function disablePlugin(plugin: Plugin): Promise<EnableResult> {
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, `disable "${plugin.name}"`);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch { /* ignore */ }
  }

  for (const instance of nonClaudeInstances) {
    const removed = uninstallPluginItemsFromInstance(plugin.name, instance);
    result.linkedInstances[instanceKey(instance)] = removed;
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export async function updatePlugin(plugin: Plugin, marketplaceUrl: string): Promise<EnableResult> {
  const instances = getToolInstances();
  const enabledInstances = getEnabledToolInstances();
  const skippedInstances = instances.filter((instance) => !instance.enabled).map(instanceKey);
  const result: EnableResult = {
    success: false,
    linkedInstances: {},
    errors: [],
    skippedInstances,
  };

  if (enabledInstances.length === 0) {
    result.errors.push("No tools enabled in config.");
    return result;
  }

  const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
  const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");

  for (const instance of claudeInstances) {
    try {
      await execClaudeCommand(instance, `update "${plugin.name}"`);
      result.linkedInstances[instanceKey(instance)] = 1;
    } catch { /* ignore */ }
  }

  for (const instance of nonClaudeInstances) {
    uninstallPluginItemsFromInstance(plugin.name, instance);
  }

  const pluginDir = join(getPluginsCacheDir(), plugin.marketplace, plugin.name);
  try {
    rmSync(pluginDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  if (nonClaudeInstances.length > 0) {
    const sourcePath = await downloadPlugin(plugin, marketplaceUrl);

    if (sourcePath) {
      for (const instance of nonClaudeInstances) {
        const { count } = installPluginItemsToInstance(plugin.name, sourcePath, instance);
        result.linkedInstances[instanceKey(instance)] = count;
      }
    } else if (Object.values(result.linkedInstances).every((count) => count === 0)) {
      result.errors.push(`Failed to download plugin update for ${plugin.name}`);
    }
  }

  result.success = Object.values(result.linkedInstances).some((n) => n > 0);
  return result;
}

export function linkPluginToInstance(
  plugin: Plugin,
  instance: ToolInstance,
  sourcePath: string
): number {
  if (!instance.enabled) return 0;

  let linked = 0;
  const manifest = loadManifest();
  const key = instanceKey(instance);
  if (!manifest.tools[key]) {
    manifest.tools[key] = { items: {} };
  }

  for (const skill of plugin.skills) {
    const source = join(sourcePath, "skills", skill);
    if (!existsSync(source)) continue;

    if (instance.skillsSubdir) {
      const target = join(instance.configDir, instance.skillsSubdir, skill);
      if (createSymlink(source, target, plugin.name, "skill", skill)) {
        manifest.tools[key].items[`skill:${skill}`] = {
          kind: "skill",
          name: skill,
          source,
          dest: join(instance.skillsSubdir, skill),
          backup: null,
        };
        linked++;
      }
    }
  }

  for (const cmd of plugin.commands) {
    const source = join(sourcePath, "commands", `${cmd}.md`);
    if (!existsSync(source)) continue;

    if (instance.commandsSubdir) {
      const target = join(instance.configDir, instance.commandsSubdir, `${cmd}.md`);
      if (createSymlink(source, target, plugin.name, "command", `${cmd}.md`)) {
        manifest.tools[key].items[`command:${cmd}`] = {
          kind: "command",
          name: cmd,
          source,
          dest: join(instance.commandsSubdir, `${cmd}.md`),
          backup: null,
        };
        linked++;
      }
    }
  }

  for (const agent of plugin.agents) {
    const source = join(sourcePath, "agents", `${agent}.md`);
    if (!existsSync(source)) continue;

    if (instance.agentsSubdir) {
      const target = join(instance.configDir, instance.agentsSubdir, `${agent}.md`);
      if (createSymlink(source, target, plugin.name, "agent", `${agent}.md`)) {
        manifest.tools[key].items[`agent:${agent}`] = {
          kind: "agent",
          name: agent,
          source,
          dest: join(instance.agentsSubdir, `${agent}.md`),
          backup: null,
        };
        linked++;
      }
    }
  }

  saveManifest(manifest);
  return linked;
}

function getInstalledPluginsForClaudeInstance(instance: ToolInstance): Plugin[] {
  const claudePluginsDir = join(instance.configDir, "plugins/cache");
  const plugins: Plugin[] = [];

  if (!existsSync(claudePluginsDir)) return plugins;

  try {
    const marketplaceDirs = readdirSync(claudePluginsDir);
    
    for (const marketplace of marketplaceDirs) {
      const mpDir = join(claudePluginsDir, marketplace);
      
      try {
        const stat = lstatSync(mpDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const pluginDirs = readdirSync(mpDir);
      
      for (const pluginName of pluginDirs) {
        const pluginDir = join(mpDir, pluginName);
        
        try {
          const stat = lstatSync(pluginDir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        let contentDir = pluginDir;
        const subDirs = readdirSync(pluginDir).filter(d => {
          const p = join(pluginDir, d);
          try {
            return lstatSync(p).isDirectory() && !d.startsWith(".");
          } catch {
            return false;
          }
        });
        
        if (subDirs.length > 0 && subDirs.every(d => /^[a-f0-9]+$/.test(d))) {
          subDirs.sort();
          contentDir = join(pluginDir, subDirs[subDirs.length - 1]);
        }

        const skills: string[] = [];
        const commands: string[] = [];
        const agents: string[] = [];
        const hooks: string[] = [];
        let hasMcp = false;
        let description = "";

        const skillsDir = join(contentDir, "skills");
        if (existsSync(skillsDir)) {
          try {
            for (const item of readdirSync(skillsDir)) {
              const itemPath = join(skillsDir, item);
              if (existsSync(join(itemPath, "SKILL.md"))) {
                skills.push(item);
              }
            }
          } catch { /* ignore */ }
        }

        const commandsDir = join(contentDir, "commands");
        if (existsSync(commandsDir)) {
          try {
            for (const item of readdirSync(commandsDir)) {
              if (item.endsWith(".md")) {
                commands.push(item.replace(/\.md$/, ""));
              }
            }
          } catch { /* ignore */ }
        }

        const agentsDir = join(contentDir, "agents");
        if (existsSync(agentsDir)) {
          try {
            for (const item of readdirSync(agentsDir)) {
              if (item.endsWith(".md")) {
                agents.push(item.replace(/\.md$/, ""));
              }
            }
          } catch { /* ignore */ }
        }

        const hooksDir = join(contentDir, "hooks");
        if (existsSync(hooksDir)) {
          try {
            for (const item of readdirSync(hooksDir)) {
              hooks.push(item.replace(/\.(md|json)$/, ""));
            }
          } catch { /* ignore */ }
        }

        if (existsSync(join(contentDir, "mcp.json")) || 
            existsSync(join(contentDir, ".claude-plugin", "mcp.json"))) {
          hasMcp = true;
        }

        const manifestPath = join(contentDir, ".claude-plugin", "manifest.json");
        if (existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            description = manifest.description || "";
          } catch { /* ignore */ }
        }

        plugins.push({
          name: pluginName,
          marketplace,
          description,
          source: contentDir,
          skills,
          commands,
          agents,
          hooks,
          hasMcp,
          hasLsp: false,
          homepage: "",
          installed: true,
          scope: "user",
        });
      }
    }
  } catch (e) {
    // Directory scanning failed
  }

  return plugins;
}

export function getInstalledPluginsForInstance(instance: ToolInstance): Plugin[] {
  if (!instance.enabled) return [];
  if (instance.toolId === "claude-code") {
    return getInstalledPluginsForClaudeInstance(instance);
  }

  const plugins: Plugin[] = [];
  const seen = new Set<string>();

  if (instance.skillsSubdir) {
    const skillsDir = join(instance.configDir, instance.skillsSubdir);
    if (existsSync(skillsDir)) {
      try {
        for (const item of readdirSync(skillsDir)) {
          const itemPath = join(skillsDir, item);
          try {
            const stat = lstatSync(itemPath);
            if (stat.isDirectory() || stat.isSymbolicLink()) {
              if (existsSync(join(itemPath, "SKILL.md"))) {
                if (!seen.has(item)) {
                  seen.add(item);
                  plugins.push({
                    name: item,
                    marketplace: "local",
                    description: "",
                    source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                    skills: [item],
                    commands: [],
                    agents: [],
                    hooks: [],
                    hasMcp: false,
                    hasLsp: false,
                    homepage: "",
                    installed: true,
                    scope: "user",
                  });
                }
              }
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
  }

  if (instance.commandsSubdir) {
    const commandsDir = join(instance.configDir, instance.commandsSubdir);
    if (existsSync(commandsDir)) {
      try {
        for (const item of readdirSync(commandsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            if (!seen.has(name)) {
              seen.add(name);
              const itemPath = join(commandsDir, item);
              const stat = lstatSync(itemPath);
              plugins.push({
                name,
                marketplace: "local",
                description: "",
                source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                skills: [],
                commands: [name],
                agents: [],
                hooks: [],
                hasMcp: false,
                hasLsp: false,
                homepage: "",
                installed: true,
                scope: "user",
              });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  if (instance.agentsSubdir) {
    const agentsDir = join(instance.configDir, instance.agentsSubdir);
    if (existsSync(agentsDir)) {
      try {
        for (const item of readdirSync(agentsDir)) {
          if (item.endsWith(".md")) {
            const name = item.replace(/\.md$/, "");
            if (!seen.has(name)) {
              seen.add(name);
              const itemPath = join(agentsDir, item);
              const stat = lstatSync(itemPath);
              plugins.push({
                name,
                marketplace: "local",
                description: "",
                source: stat.isSymbolicLink() ? realpathSync(itemPath) : itemPath,
                skills: [],
                commands: [],
                agents: [name],
                hooks: [],
                hasMcp: false,
                hasLsp: false,
                homepage: "",
                installed: true,
                scope: "user",
              });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  return plugins;
}

export function getAllInstalledPlugins(): { plugins: Plugin[]; byTool: Record<string, Plugin[]> } {
  const byTool: Record<string, Plugin[]> = {};
  const allPlugins: Plugin[] = [];
  const seen = new Set<string>();
  const instances = getToolInstances();

  for (const instance of instances) {
    const key = instanceKey(instance);
    if (!instance.enabled) {
      byTool[key] = [];
      continue;
    }

    const instancePlugins = getInstalledPluginsForInstance(instance);
    byTool[key] = instancePlugins;

    for (const p of instancePlugins) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        allPlugins.push(p);
      }
    }
  }

  return { plugins: allPlugins, byTool };
}

export interface ToolInstallStatus {
  toolId: string;
  instanceId: string;
  name: string;
  installed: boolean;
  supported: boolean;
  enabled: boolean;
}

export function getPluginToolStatus(plugin: Plugin): ToolInstallStatus[] {
  const statuses: ToolInstallStatus[] = [];
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
      if (instance.toolId === "claude-code") {
        installed = isPluginInstalledInClaudeInstance(plugin, instance);
      } else {
        if (canInstallSkills && instance.skillsSubdir) {
          for (const skill of plugin.skills) {
            const skillPath = join(instance.configDir, instance.skillsSubdir, skill);
            if (existsSync(skillPath)) {
              installed = true;
              break;
            }
          }
        }
        if (!installed && canInstallCommands && instance.commandsSubdir) {
          for (const cmd of plugin.commands) {
            const cmdPath = join(instance.configDir, instance.commandsSubdir, `${cmd}.md`);
            if (existsSync(cmdPath)) {
              installed = true;
              break;
            }
          }
        }
        if (!installed && canInstallAgents && instance.agentsSubdir) {
          for (const agent of plugin.agents) {
            const agentPath = join(instance.configDir, instance.agentsSubdir, `${agent}.md`);
            if (existsSync(agentPath)) {
              installed = true;
              break;
            }
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
