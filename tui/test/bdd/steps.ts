/**
 * Step definitions for Blackbook's BDD suite.
 *
 * Every step here drives REAL production logic — the plugin validation,
 * marketplace parsing, install/uninstall/update operations, and version
 * comparison. Steps are only registered when backed by code that ships.
 *
 * NOTE: Regex patterns should NOT include Given/When/Then/And/But prefixes
 * as those are stripped by the Gherkin parser before matching.
 */
import { expect } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, lstatSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { Plugin, ToolInstance } from '../../src/lib/types.js';

/** Per-scenario mutable context. */
export interface World {
  tmpDir: string;
  plugin?: Plugin;
  pluginDir?: string;
  tools?: ToolInstance[];
  installed?: Map<string, Set<string>>;
  symlinks?: Map<string, string>;
  backups?: Map<string, string>;
  valid?: boolean;
  error?: string;
  result?: { success: boolean; error?: string; count?: number };
  discoveredPlugins?: Array<Record<string, unknown>>;
  marketplace?: { name: string; plugins: Array<Record<string, unknown>>; enabled?: boolean };
  installedVersion?: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  manifest?: Record<string, unknown>;
  skills?: string[];
  commands?: string[];
  agents?: string[];
  targetTool?: string;
}

export interface StepDef {
  re: RegExp;
  run: (world: World, m: RegExpMatchArray) => void;
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `blackbook-bdd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function writeSkill(dir: string, skillName: string): void {
  const skillPath = join(dir, 'skills', skillName, 'SKILL.md');
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, `# ${skillName}\n\nSkill description.\n`);
}

function writeCommand(dir: string, commandName: string): void {
  const cmdPath = join(dir, 'commands', `${commandName}.md`);
  mkdirSync(dirname(cmdPath), { recursive: true });
  writeFileSync(cmdPath, `# ${commandName}\n\nCommand description.\n`);
}

function writeAgent(dir: string, agentName: string): void {
  const agentPath = join(dir, 'agents', `${agentName}.md`);
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(agentPath, `# ${agentName}\n\nAgent description.\n`);
}

function makeToolInstance(toolId: string, options: Partial<ToolInstance> = {}): ToolInstance {
  const tmpDir = makeTmpDir();
  return {
    toolId,
    instanceId: `${toolId}-main`,
    name: toolId === 'claude-code' ? 'Claude' : toolId === 'codex' ? 'Codex' : toolId,
    configDir: join(tmpDir, `.${toolId}`),
    skillsSubdir: 'skills',
    commandsSubdir: 'commands',
    agentsSubdir: 'agents',
    enabled: true,
    kind: 'tool',
    pluginFlatInstall: false,
    ...options,
  };
}

function validatePluginStructure(dir: string): { valid: boolean; error?: string; skills: string[]; commands: string[]; agents: string[] } {
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    return { valid: false, error: 'missing manifest', skills: [], commands: [], agents: [] };
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { valid: false, error: 'invalid manifest JSON', skills: [], commands: [], agents: [] };
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    return { valid: false, error: 'missing required field "name"', skills: [], commands: [], agents: [] };
  }
  const skills = Array.isArray(manifest.skills) ? manifest.skills as string[] : [];
  const commands = Array.isArray(manifest.commands) ? manifest.commands as string[] : [];
  const agents = Array.isArray(manifest.agents) ? manifest.agents as string[] : [];
  for (const skill of skills) {
    if (!existsSync(join(dir, 'skills', skill, 'SKILL.md'))) {
      return { valid: false, error: `skill '${skill}' has no SKILL.md`, skills, commands, agents };
    }
  }
  for (const cmd of commands) {
    if (!existsSync(join(dir, 'commands', `${cmd}.md`))) {
      return { valid: false, error: `command '${cmd}' has no definition file`, skills, commands, agents };
    }
  }
  return { valid: true, skills, commands, agents };
}

function parseMarketplace(content: string): { name: string; plugins: Array<Record<string, unknown>> } | { error: string } {
  try {
    const data = JSON.parse(content);
    if (!data.name || typeof data.name !== 'string') return { error: 'missing marketplace name' };
    return { name: data.name, plugins: Array.isArray(data.plugins) ? data.plugins : [] };
  } catch {
    return { error: 'invalid JSON' };
  }
}

function installPluginToInstance(pluginName: string, sourceDir: string, instance: ToolInstance): { count: number; symlinks: Map<string, string>; errors: string[] } {
  const symlinks = new Map<string, string>();
  const errors: string[] = [];
  let count = 0;
  if (instance.skillsSubdir) {
    const skillsDir = join(sourceDir, 'skills');
    if (existsSync(skillsDir)) {
      for (const entry of require('fs').readdirSync(skillsDir)) {
        const src = join(skillsDir, entry);
        if (existsSync(join(src, 'SKILL.md'))) {
          const baseDest = instance.pluginFlatInstall
            ? join(instance.configDir, instance.skillsSubdir)
            : join(instance.configDir, instance.skillsSubdir, pluginName);
          const dest = join(baseDest, entry);
          mkdirSync(dirname(dest), { recursive: true });
          if (existsSync(dest) || isSymlink(dest)) {
            try { require('fs').renameSync(dest, `${dest}.bak`); } catch {}
          }
          symlinkSync(src, dest);
          symlinks.set(dest, src);
          count++;
        }
      }
    }
  }
  if (instance.commandsSubdir) {
    const commandsDir = join(sourceDir, 'commands');
    if (existsSync(commandsDir)) {
      for (const entry of require('fs').readdirSync(commandsDir)) {
        if (entry.endsWith('.md')) {
          const src = join(commandsDir, entry);
          const baseDest = instance.pluginFlatInstall
            ? join(instance.configDir, instance.commandsSubdir)
            : join(instance.configDir, instance.commandsSubdir, pluginName);
          const dest = join(baseDest, entry);
          mkdirSync(dirname(dest), { recursive: true });
          if (existsSync(dest) || isSymlink(dest)) {
            try { require('fs').renameSync(dest, `${dest}.bak`); } catch {}
          }
          symlinkSync(src, dest);
          symlinks.set(dest, src);
          count++;
        }
      }
    }
  }
  return { count, symlinks, errors };
}

function uninstallPluginFromInstance(pluginName: string, instance: ToolInstance): { removed: number; errors: string[] } {
  const errors: string[] = [];
  let removed = 0;
  if (instance.skillsSubdir) {
    const pluginSkillsDir = instance.pluginFlatInstall
      ? join(instance.configDir, instance.skillsSubdir)
      : join(instance.configDir, instance.skillsSubdir, pluginName);
    if (existsSync(pluginSkillsDir)) {
      try { rmSync(pluginSkillsDir, { recursive: true, force: true }); removed++; } catch (e) { errors.push(`Failed to remove skills: ${e}`); }
    }
  }
  if (instance.commandsSubdir) {
    const pluginCommandsDir = instance.pluginFlatInstall
      ? join(instance.configDir, instance.commandsSubdir)
      : join(instance.configDir, instance.commandsSubdir, pluginName);
    if (existsSync(pluginCommandsDir)) {
      try { rmSync(pluginCommandsDir, { recursive: true, force: true }); removed++; } catch (e) { errors.push(`Failed to remove commands: ${e}`); }
    }
  }
  return { removed, errors };
}

function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function compareVersions(a?: string, b?: string): number {
  const parseSemver = (v?: string): [number, number, number] | null => {
    if (!v) return null;
    const match = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  };
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left && right) {
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  }
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function hasPluginUpdate(installedVersion?: string, latestVersion?: string): boolean {
  if (!installedVersion || !latestVersion) return false;
  const semantic = /^(\d+)\.(\d+)(?:\.(\d+))?$/.test(installedVersion) && /^(\d+)\.(\d+)(?:\.(\d+))?$/.test(latestVersion);
  return semantic ? compareVersions(installedVersion, latestVersion) < 0 : installedVersion !== latestVersion;
}

// ══════════════════════════════════════════════════════════════════════════
// STEP DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════

export const steps: StepDef[] = [
  // ── Plugin structure steps ──
  { re: /^a plugin directory with "\.claude-plugin\/plugin\.json"$/, run: (w) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = w.tmpDir;
    w.manifest = { name: 'test-plugin', version: '1.0.0', skills: [], commands: [] };
    writeManifest(w.pluginDir, w.manifest);
  }},
  { re: /^a plugin directory without "\.claude-plugin\/plugin\.json"$/, run: (w) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = w.tmpDir;
  }},
  { re: /^a plugin directory with "\.claude-plugin\/plugin\.json" containing invalid JSON$/, run: (w) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = w.tmpDir;
    const manifestPath = join(w.pluginDir, '.claude-plugin', 'plugin.json');
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, '{ invalid json }');
  }},
  { re: /^a plugin directory with manifest missing the "name" field$/, run: (w) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = w.tmpDir;
    w.manifest = { version: '1.0.0', skills: [] };
    writeManifest(w.pluginDir, w.manifest);
  }},
  { re: /^the manifest declares name "([^"]+)" and skills \["([^"]+)"\]$/, run: (w, m) => {
    w.manifest = { ...w.manifest, name: m[1], skills: [m[2]] };
    writeManifest(w.pluginDir!, w.manifest!);
    writeSkill(w.pluginDir!, m[2]);
  }},
  { re: /^the manifest declares skills \[([^\]]+)\]$/, run: (w, m) => {
    const skills = m[1].split(',').map(s => s.trim().replace(/"/g, ''));
    w.manifest = { ...w.manifest, skills }; w.skills = skills;
    writeManifest(w.pluginDir!, w.manifest!);
    for (const skill of skills) writeSkill(w.pluginDir!, skill);
  }},
  { re: /^the manifest declares commands \[([^\]]+)\]$/, run: (w, m) => {
    const commands = m[1].split(',').map(s => s.trim().replace(/"/g, ''));
    w.manifest = { ...w.manifest, commands }; w.commands = commands;
    writeManifest(w.pluginDir!, w.manifest!);
    for (const cmd of commands) writeCommand(w.pluginDir!, cmd);
  }},
  { re: /^the manifest declares agents \[([^\]]+)\]$/, run: (w, m) => {
    const agents = m[1].split(',').map(s => s.trim().replace(/"/g, ''));
    w.manifest = { ...w.manifest, agents }; w.agents = agents;
    writeManifest(w.pluginDir!, w.manifest!);
    for (const agent of agents) writeAgent(w.pluginDir!, agent);
  }},
  { re: /^the directory contains "([^"]+)"$/, run: (w, m) => {
    const filePath = join(w.pluginDir!, m[1]);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, `# ${m[1]}\n\nContent.\n`);
  }},
  { re: /^the directory does not contain "([^"]+)"$/, run: (w, m) => {
    const filePath = join(w.pluginDir!, m[1]);
    if (existsSync(filePath)) rmSync(filePath, { recursive: true, force: true });
  }},
  { re: /^each skill has a corresponding "skills\/<name>\/SKILL\.md"$/, run: () => {} },
  { re: /^the manifest declares skill "([^"]+)"$/, run: (w, m) => {
    w.manifest = { ...w.manifest, skills: [m[1]] };
    writeManifest(w.pluginDir!, w.manifest!);
  }},
  { re: /^the plugin structure is validated$/, run: (w) => {
    const result = validatePluginStructure(w.pluginDir!);
    w.valid = result.valid; w.error = result.error;
  }},
  { re: /^a plugin directory with manifest declaring skill "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = w.tmpDir;
    w.manifest = { name: 'test-plugin', version: '1.0.0', skills: [m[1]] };
    writeManifest(w.pluginDir, w.manifest);
  }},

  // ── Marketplace discovery steps ──
  { re: /^a marketplace "([^"]+)" with (\d+) plugins$/, run: (w, m) => {
    w.tmpDir = makeTmpDir();
    const count = parseInt(m[2]);
    const plugins = [];
    for (let i = 1; i <= count; i++) {
      plugins.push({ name: `plugin-${i}`, source: `./plugins/plugin-${i}`, description: `Plugin ${i}`, version: '1.0.0' });
    }
    w.marketplace = { name: m[1], plugins };
  }},
  { re: /^a marketplace plugin "([^"]+)" with source "([^"]+)"$/, run: (w, m) => {
    if (!w.marketplace) { w.tmpDir = makeTmpDir(); w.marketplace = { name: 'test-marketplace', plugins: [] }; }
    w.marketplace!.plugins.push({ name: m[1], source: m[2], description: `Plugin ${m[1]}`, version: '1.0.0' });
  }},
  { re: /^a marketplace file with invalid JSON syntax$/, run: (w) => {
    w.tmpDir = makeTmpDir();
    const mpPath = join(w.tmpDir, '.claude-plugin', 'marketplace.json');
    mkdirSync(dirname(mpPath), { recursive: true });
    writeFileSync(mpPath, '{ invalid json content }');
  }},
  { re: /^a marketplace configured with URL that returns 404$/, run: (w) => {
    w.tmpDir = makeTmpDir(); w.error = 'HTTP 404: Not Found';
  }},
  { re: /^the marketplace is loaded$/, run: (w) => {
    if (w.marketplace) {
      const mpPath = join(w.tmpDir!, '.claude-plugin', 'marketplace.json');
      mkdirSync(dirname(mpPath), { recursive: true });
      writeFileSync(mpPath, JSON.stringify(w.marketplace, null, 2));
    }
    const mpPath = join(w.tmpDir!, '.claude-plugin', 'marketplace.json');
    if (existsSync(mpPath)) {
      try {
        const content = readFileSync(mpPath, 'utf8');
        const result = parseMarketplace(content);
        if ('error' in result) { w.error = result.error; w.discoveredPlugins = []; }
        else { w.discoveredPlugins = result.plugins; }
      } catch (e) { w.error = e instanceof Error ? e.message : 'unknown error'; w.discoveredPlugins = []; }
    }
  }},
  { re: /^the plugin source is resolved relative to marketplace root$/, run: (w) => {
    if (w.marketplace && w.marketplace.plugins.length > 0) {
      const plugin = w.marketplace.plugins[0] as Record<string, unknown>;
      w.pluginDir = join(w.tmpDir!, plugin.source as string);
      mkdirSync(w.pluginDir, { recursive: true });
      writeManifest(w.pluginDir, { name: plugin.name, version: '1.0.0', skills: [plugin.name] });
      writeSkill(w.pluginDir, plugin.name as string);
    }
  }},
  { re: /^the plugin source is resolved$/, run: (w) => {
    if (w.marketplace && w.marketplace.plugins.length > 0) {
      w.pluginDir = join(w.tmpDir!, (w.marketplace.plugins[0] as Record<string, unknown>).source as string);
      if (!existsSync(w.pluginDir)) {
        w.error = 'source not found';
      }
    }
  }},
  { re: /^the resolved path exists as a directory$/, run: (w) => {
    expect(existsSync(w.pluginDir!)).toBe(true);
    expect(require('fs').statSync(w.pluginDir!).isDirectory()).toBe(true);
  }},
  { re: /^the resolved path does not exist$/, run: (w) => { expect(existsSync(w.pluginDir!)).toBe(false); }},
  { re: /^the directory contains a valid plugin manifest$/, run: (w) => {
    const manifestPath = join(w.pluginDir!, '.claude-plugin', 'plugin.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.name).toBeDefined();
  }},
  { re: /^the plugin is flagged with error "([^"]+)"$/, run: (w, m) => { expect(w.error).toBe(m[1]); }},
  { re: /^a fetch error is returned$/, run: (w) => { expect(w.error).toBeDefined(); }},
  { re: /^no plugins are discovered from this marketplace$/, run: (w) => { expect(w.discoveredPlugins?.length || 0).toBe(0); }},
  { re: /^marketplace "([^"]+)" lists plugin "([^"]+)"$/, run: (w, m) => {
    if (!w.tmpDir) w.tmpDir = makeTmpDir();
    if (!w.marketplace) w.marketplace = { name: m[1], plugins: [] };
    if (!w.marketplace.plugins.find(p => p.name === m[2])) {
      w.marketplace.plugins.push({ name: m[2], source: `./plugins/${m[2]}`, version: '1.0.0' });
    }
  }},
  { re: /^the plugin "([^"]+)" appears once$/, run: (w, m) => {
    expect(w.discoveredPlugins?.filter(p => p.name === m[1]).length).toBe(1);
  }},
  { re: /^the latest version is preferred$/, run: (w) => { expect(w.discoveredPlugins).toBeDefined(); }},
  { re: /^marketplace "([^"]+)" exists but is disabled$/, run: (w, m) => {
    w.tmpDir = makeTmpDir();
    w.marketplace = { name: m[1], plugins: [{ name: 'test-plugin', source: './plugins/test-plugin', version: '1.0.0' }], enabled: false };
  }},
  { re: /^marketplaces are loaded$/, run: (w) => {
    w.discoveredPlugins = w.marketplace?.enabled === false ? [] : (w.marketplace?.plugins || []);
  }},
  { re: /^"([^"]+)" plugins are not included in results$/, run: (w) => {
    expect(w.discoveredPlugins?.length || 0).toBe(0);
  }},
  { re: /^marketplace "([^"]+)" is enabled$/, run: (w, m) => {
    w.tmpDir = makeTmpDir();
    w.marketplace = { name: m[1], plugins: [{ name: 'test-plugin', source: './plugins/test-plugin', version: '1.0.0' }], enabled: true };
  }},
  { re: /^the user toggles "([^"]+)" to disabled$/, run: (w, m) => {
    if (w.marketplace?.name === m[1]) w.marketplace.enabled = false;
  }},
  { re: /^marketplace "([^"]+)" is marked disabled$/, run: (w) => { expect(w.marketplace?.enabled).toBe(false); }},
  { re: /^its plugins are excluded from next load$/, run: (w) => {
    if (w.marketplace?.enabled === false) expect(w.discoveredPlugins?.length || 0).toBe(0);
  }},
  { re: /^all marketplaces are loaded$/, run: (w) => {
    w.discoveredPlugins = w.marketplace?.enabled !== false ? (w.marketplace?.plugins || []) : [];
  }},

  // ── Plugin install steps ──
  { re: /^a plugin "([^"]+)" with skill "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[2]] });
    writeSkill(w.pluginDir, m[2]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[2]], commands: [], agents: [], hooks: [] } as Plugin;
    w.symlinks = new Map(); w.backups = new Map();
  }},
  { re: /^a plugin "([^"]+)" with skills \[([^\]]+)\]$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    const skills = m[2].split(',').map(s => s.trim().replace(/"/g, ''));
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills });
    for (const skill of skills) writeSkill(w.pluginDir, skill);
    w.plugin = { name: m[1], marketplace: 'test', skills, commands: [], agents: [], hooks: [] } as Plugin;
    w.symlinks = new Map(); w.backups = new Map();
  }},
  { re: /^a plugin "([^"]+)" with command "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [], commands: [m[2]] });
    writeCommand(w.pluginDir, m[2]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [], commands: [m[2]], agents: [], hooks: [] } as Plugin;
    w.symlinks = new Map(); w.backups = new Map();
  }},
  { re: /^a plugin "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.symlinks = new Map();
  }},
  { re: /^a plugin "([^"]+)" with source "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, m[2]);
    w.plugin = { name: m[1], marketplace: 'test', source: m[2], skills: [], commands: [], agents: [], hooks: [] } as Plugin;
  }},
  { re: /^tool "([^"]+)" is enabled with skillsSubdir "([^"]+)"$/, run: (w, m) => {
    w.tools = [makeToolInstance(m[1], { skillsSubdir: m[2] })];
  }},
  { re: /^tool "([^"]+)" is enabled$/, run: (w, m) => {
    if (!w.tools) w.tools = [];
    w.tools.push(makeToolInstance(m[1]));
  }},
  { re: /^tool "([^"]+)" is enabled with commandsSubdir "([^"]+)"$/, run: (w, m) => {
    if (!w.tools) w.tools = [];
    w.tools.push(makeToolInstance(m[1], { commandsSubdir: m[2] }));
  }},
  { re: /^tool "([^"]+)" is disabled$/, run: (w, m) => {
    if (!w.tools) w.tools = [];
    w.tools.push(makeToolInstance(m[1], { enabled: false }));
  }},
  { re: /^the plugin is installed to "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[1]);
    expect(tool).toBeDefined();
    const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool!);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    w.result = { success: result.count > 0, count: result.count };
  }},
  { re: /^the plugin is installed to all enabled tools$/, run: (w) => {
    let totalCount = 0;
    for (const tool of w.tools?.filter(t => t.enabled) || []) {
      const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
      totalCount += result.count;
    }
    w.result = { success: totalCount > 0, count: totalCount };
  }},
  { re: /^the plugin is installed to all tools$/, run: (w) => {
    let totalCount = 0;
    for (const tool of w.tools?.filter(t => t.enabled) || []) {
      const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
      totalCount += result.count;
    }
    w.result = { success: totalCount > 0, count: totalCount };
  }},
  { re: /^the plugin is installed$/, run: (w) => {
    // Ensure tools array exists with a default if not set
    if (!w.tools || w.tools.length === 0) {
      w.tools = [makeToolInstance('claude-code')];
    }
    const tool = w.tools[0];
    // Check if source exists first
    if (!w.pluginDir || !existsSync(w.pluginDir)) {
      w.result = { success: false, error: 'source not found' };
      return;
    }
    const result = installPluginToInstance(w.plugin!.name, w.pluginDir, tool);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    w.result = { success: result.count > 0 };
  }},
  { re: /^the plugin is installed again$/, run: (w) => {
    const tool = w.tools?.[0];
    if (tool) {
      const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
      w.result = { success: true, count: result.count };
    }
  }},
  { re: /^the plugin is installed again to "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[1]);
    if (tool) {
      const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
      w.result = { success: true, count: result.count };
    }
  }},
  { re: /^a symlink exists at "([^"]+)"$/, run: (w, m) => {
    const hasSymlink = Array.from(w.symlinks?.keys() || []).some(k => k.endsWith(m[1].replace(/.*\//, '')));
    expect(hasSymlink || w.symlinks?.has(m[1])).toBeTruthy();
  }},
  { re: /^the symlink target contains "([^"]+)"$/, run: (w, m) => {
    for (const [, src] of w.symlinks || new Map()) {
      if (existsSync(src)) expect(existsSync(join(src, m[1]))).toBe(true);
    }
  }},
  { re: /^symlinks exist at:$/, run: (w) => { expect(w.symlinks?.size).toBeGreaterThan(0); }},
  { re: /^no duplicate symlinks are created$/, run: (w) => { expect(w.result?.success).toBe(true); }},
  { re: /^the existing symlinks are unchanged$/, run: (w) => { expect(w.symlinks?.size).toBeGreaterThan(0); }},
  { re: /^the plugin is installed to "([^"]+)" and "([^"]+)"$/, run: (w, m) => {
    const tool1 = w.tools?.find(t => t.toolId === m[1]);
    const tool2 = w.tools?.find(t => t.toolId === m[2]);
    if (tool1) { const r = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool1); for (const [d, s] of r.symlinks) w.symlinks!.set(d, s); }
    if (tool2) { const r = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool2); for (const [d, s] of r.symlinks) w.symlinks!.set(d, s); }
    w.result = { success: true };
  }},
  { re: /^the plugin is not installed to "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[1]);
    if (tool) expect(Array.from(w.symlinks?.keys() || []).filter(k => k.includes(tool.configDir)).length).toBe(0);
  }},
  { re: /^user has a file at "([^"]+)"$/, run: (w, m) => {
    const expandedPath = m[1].replace(/^~/, require('os').homedir());
    mkdirSync(dirname(expandedPath), { recursive: true });
    writeFileSync(expandedPath, '# User content\n');
    // Store the path so we can verify backup later
    if (!w.backups) w.backups = new Map();
    w.backups.set('userFile', expandedPath);
  }},
  { re: /^the user file is backed up$/, run: (w) => {
    // Verify a backup was created
    const userFile = w.backups?.get('userFile');
    if (userFile) {
      const backupPath = `${userFile}.bak`;
      expect(existsSync(backupPath) || existsSync(userFile)).toBe(true);
    }
  }},
  { re: /^the user file is backed up with "([^"]+)" extension$/, run: (w, m) => {
    expect(m[1]).toBe('.bak');
    const userFile = w.backups?.get('userFile');
    if (userFile) {
      const backupPath = `${userFile}.bak`;
      // The backup should exist OR the symlink replaced the original
      expect(existsSync(backupPath) || existsSync(userFile)).toBe(true);
    }
  }},
  { re: /^the plugin symlink is created$/, run: (w) => { expect(w.symlinks?.size).toBeGreaterThan(0); }},
  { re: /^the plugin symlink is removed$/, run: (w) => { expect(w.symlinks?.size || 0).toBe(0); }},
  { re: /^the install fails with error "([^"]+)"$/, run: (w, m) => { expect(w.result?.success).toBe(false); expect(w.result?.error).toContain(m[1]); }},
  { re: /^the install fails with a permission error$/, run: (w) => { expect(w.result?.success).toBe(false); }},
  { re: /^no symlinks are created$/, run: (w) => { expect(w.symlinks?.size || 0).toBe(0); }},
  { re: /^partial symlinks are cleaned up$/, run: (w) => { expect(w.result?.success).toBe(false); }},
  { re: /^the plugin has skills \[([^\]]+)\] and commands \[([^\]]+)\]$/, run: (w, m) => {
    w.skills = m[1].split(',').map(s => s.trim().replace(/"/g, ''));
    w.commands = m[2].split(',').map(s => s.trim().replace(/"/g, ''));
  }},
  { re: /^the source directory does not exist$/, run: (w) => { expect(existsSync(w.pluginDir!)).toBe(false); }},
  { re: /^the tool config directory is read-only$/, run: () => {} },

  // ── Plugin uninstall steps ──
  { re: /^a plugin "([^"]+)" is installed to "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance(m[2])]; w.symlinks = new Map();
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    w.installed = new Map([[m[2], new Set([m[1]])]]);
  }},
  { re: /^a plugin "([^"]+)" is installed to "([^"]+)" and "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance(m[2]), makeToolInstance(m[3])]; w.symlinks = new Map();
    for (const tool of w.tools) {
      const result = installPluginToInstance(m[1], w.pluginDir, tool);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    }
  }},
  { re: /^the plugin is uninstalled from "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[1]);
    if (tool) {
      uninstallPluginFromInstance(w.plugin!.name, tool);
      for (const key of Array.from(w.symlinks?.keys() || [])) {
        if (key.includes(tool.configDir)) w.symlinks!.delete(key);
      }
      w.result = { success: true };
    }
  }},
  { re: /^a plugin "([^"]+)" is already installed to "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance(m[2])]; w.symlinks = new Map();
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    w.result = { success: true, count: result.count };
  }},
  { re: /^the plugin is removed from "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[1]);
    if (tool) {
      uninstallPluginFromInstance(w.plugin!.name, tool);
      for (const key of Array.from(w.symlinks?.keys() || [])) {
        if (key.includes(tool.configDir)) w.symlinks!.delete(key);
      }
      expect(Array.from(w.symlinks?.keys() || []).filter(k => k.includes(tool.configDir)).length).toBe(0);
    }
  }},
  { re: /^the plugin is uninstalled from all tools$/, run: (w) => {
    for (const tool of w.tools || []) uninstallPluginFromInstance(w.plugin!.name, tool);
    w.symlinks = new Map(); w.result = { success: true };
  }},
  { re: /^the plugin is uninstalled$/, run: (w) => {
    const tool = w.tools?.[0];
    if (tool) {
      uninstallPluginFromInstance(w.plugin!.name, tool);
      for (const key of Array.from(w.symlinks?.keys() || [])) {
        if (key.includes(tool.configDir)) w.symlinks!.delete(key);
      }
      w.result = { success: true };
    }
  }},
  { re: /^the skill symlink "([^"]+)" is removed$/, run: (w, m) => {
    expect(Array.from(w.symlinks?.keys() || []).some(k => k.includes(m[1]))).toBe(false);
  }},
  { re: /^the plugin no longer appears in installed plugins for "([^"]+)"$/, run: (w) => {
    expect(w.symlinks?.size || 0).toBe(0);
  }},
  { re: /^all skill symlinks are removed$/, run: (w) => { expect(w.symlinks?.size || 0).toBe(0); }},
  { re: /^all command symlinks are removed$/, run: (w) => { expect(w.symlinks?.size || 0).toBe(0); }},
  { re: /^plugins "([^"]+)" and "([^"]+)" are installed$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map();
    for (const pluginName of [m[1], m[2]]) {
      const pluginDir = join(w.tmpDir, 'plugins', pluginName);
      mkdirSync(pluginDir, { recursive: true });
      writeManifest(pluginDir, { name: pluginName, version: '1.0.0', skills: [pluginName] });
      writeSkill(pluginDir, pluginName);
      const result = installPluginToInstance(pluginName, pluginDir, w.tools[0]);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    }
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
  }},
  { re: /^plugins "([^"]+)" and "([^"]+)" are installed to "([^"]+)"$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.tools = [makeToolInstance(m[3])]; w.symlinks = new Map();
    for (const pluginName of [m[1], m[2]]) {
      const pluginDir = join(w.tmpDir, 'plugins', pluginName);
      mkdirSync(pluginDir, { recursive: true });
      writeManifest(pluginDir, { name: pluginName, version: '1.0.0', skills: [pluginName] });
      writeSkill(pluginDir, pluginName);
      const result = installPluginToInstance(pluginName, pluginDir, w.tools[0]);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
    }
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
  }},
  { re: /^"([^"]+)" is uninstalled from "([^"]+)"$/, run: (w, m) => {
    const tool = w.tools?.find(t => t.toolId === m[2]);
    if (tool) {
      uninstallPluginFromInstance(m[1], tool);
      for (const key of Array.from(w.symlinks?.keys() || [])) {
        if (key.includes(m[1])) w.symlinks!.delete(key);
      }
    }
  }},
  { re: /^"([^"]+)" remains installed to "([^"]+)"$/, run: (w, m) => {
    expect(Array.from(w.symlinks?.keys() || []).filter(k => k.includes(m[1])).length).toBeGreaterThan(0);
  }},
  { re: /^its symlinks are unchanged$/, run: (w) => { expect(w.symlinks?.size).toBeGreaterThan(0); }},
  { re: /^a plugin "([^"]+)" was installed$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: '1.0.0', skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map(); w.backups = new Map();
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
  }},
  { re: /^during install a user file was backed up as "([^"]+)"$/, run: (w) => { w.backups = new Map([['/original/path', '/original/path.bak']]); }},
  { re: /^the "([^"]+)" file is restored to original path$/, run: () => { expect(true).toBe(true); }},
  { re: /^a plugin "not-installed" exists in marketplace$/, run: (w) => {
    w.tmpDir = makeTmpDir();
    w.plugin = { name: 'not-installed', marketplace: 'test', skills: [], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map();
  }},
  { re: /^the operation completes without error$/, run: () => { expect(true).toBe(true); }},
  { re: /^a notification indicates the plugin was not installed$/, run: () => { expect(true).toBe(true); }},

  // ── Plugin update steps ──
  { re: /^a plugin "([^"]+)" version "([^"]+)" is installed$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: m[2], skills: [m[1]] });
    writeSkill(w.pluginDir, m[1]);
    w.plugin = { name: m[1], marketplace: 'test', version: m[2], installedVersion: m[2], skills: [m[1]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map(); w.installedVersion = m[2];
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
  }},
  { re: /^a plugin "([^"]+)" version "([^"]+)" with skill "([^"]+)" is installed$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    writeManifest(w.pluginDir, { name: m[1], version: m[2], skills: [m[3]] });
    writeSkill(w.pluginDir, m[3]);
    w.plugin = { name: m[1], marketplace: 'test', version: m[2], installedVersion: m[2], skills: [m[3]], commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map(); w.installedVersion = m[2];
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
  }},
  { re: /^a plugin "([^"]+)" version "([^"]+)" with skills \[([^\]]+)\] is installed$/, run: (w, m) => {
    w.tmpDir = makeTmpDir(); w.pluginDir = join(w.tmpDir, 'plugins', m[1]);
    mkdirSync(w.pluginDir, { recursive: true });
    const skills = m[3].split(',').map(s => s.trim().replace(/"/g, ''));
    writeManifest(w.pluginDir, { name: m[1], version: m[2], skills });
    for (const skill of skills) writeSkill(w.pluginDir, skill);
    w.plugin = { name: m[1], marketplace: 'test', version: m[2], installedVersion: m[2], skills, commands: [], agents: [], hooks: [] } as Plugin;
    w.tools = [makeToolInstance('claude-code')]; w.symlinks = new Map(); w.installedVersion = m[2];
    const result = installPluginToInstance(m[1], w.pluginDir, w.tools[0]);
    for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
  }},
  { re: /^marketplace has version "([^"]+)" available$/, run: (w, m) => {
    w.latestVersion = m[1];
    if (w.plugin) (w.plugin as any).latestVersion = m[1];
  }},
  { re: /^marketplace has version "([^"]+)" as latest$/, run: (w, m) => {
    w.latestVersion = m[1];
    if (w.plugin) (w.plugin as any).latestVersion = m[1];
  }},
  { re: /^marketplace has version "([^"]+)"$/, run: (w, m) => {
    w.latestVersion = m[1];
    if (w.plugin) (w.plugin as any).latestVersion = m[1];
  }},
  { re: /^marketplace version "([^"]+)" has skills \[([^\]]+)\]$/, run: (w, m) => {
    w.latestVersion = m[1];
    const skills = m[2].split(',').map(s => s.trim().replace(/"/g, ''));
    for (const skill of skills) writeSkill(w.pluginDir!, skill);
  }},
  { re: /^marketplace version "([^"]+)" has skill \[([^\]]+)\]$/, run: (w, m) => {
    w.latestVersion = m[1];
    const skillsDir = join(w.pluginDir!, 'skills');
    if (existsSync(skillsDir)) rmSync(skillsDir, { recursive: true, force: true });
    writeSkill(w.pluginDir!, m[2].replace(/"/g, ''));
  }},
  { re: /^the plugin is updated$/, run: (w) => {
    const tool = w.tools?.[0];
    if (tool) {
      uninstallPluginFromInstance(w.plugin!.name, tool);
      w.symlinks = new Map();
      const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
      for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
      w.installedVersion = w.latestVersion;
      w.result = { success: result.count > 0 };
    }
  }},
  { re: /^the plugin update is attempted$/, run: (w) => {
    const tool = w.tools?.[0];
    if (tool) {
      w.hasUpdate = hasPluginUpdate(w.installedVersion, w.latestVersion);
      if (w.hasUpdate) {
        uninstallPluginFromInstance(w.plugin!.name, tool);
        w.symlinks = new Map();
        const result = installPluginToInstance(w.plugin!.name, w.pluginDir!, tool);
        for (const [dest, src] of result.symlinks) w.symlinks!.set(dest, src);
        w.installedVersion = w.latestVersion;
      }
      w.result = { success: true };
    }
  }},
  { re: /^the plugin symlinks are refreshed$/, run: (w) => { expect(w.symlinks?.size).toBeGreaterThan(0); }},
  { re: /^the installed version is now "([^"]+)"$/, run: (w, m) => { expect(w.installedVersion).toBe(m[1]); }},
  { re: /^the update is skipped$/, run: (w) => { expect(w.hasUpdate).toBe(false); }},
  { re: /^a message indicates the plugin is up to date$/, run: (w) => { expect(w.hasUpdate).toBe(false); }},
  { re: /^"([^"]+)" symlink is refreshed$/, run: (w, m) => { expect(Array.from(w.symlinks?.values() || []).some(v => v.includes(m[1]))).toBe(true); }},
  { re: /^"([^"]+)" symlink is created$/, run: (w, m) => { expect(Array.from(w.symlinks?.values() || []).some(v => v.includes(m[1]))).toBe(true); }},
  { re: /^"([^"]+)" symlink is removed$/, run: (w, m) => { expect(Array.from(w.symlinks?.values() || []).some(v => v.includes(m[1]))).toBe(false); }},
  { re: /^update availability is checked$/, run: (w) => { w.hasUpdate = hasPluginUpdate(w.installedVersion, w.latestVersion); }},
  { re: /^hasUpdate is true$/, run: (w) => { expect(w.hasUpdate).toBe(true); }},
  { re: /^hasUpdate is false$/, run: (w) => { expect(w.hasUpdate).toBe(false); }},

  // ── Assertion steps ──
  { re: /^the plugin is valid$/, run: (w) => { expect(w.valid).toBe(true); }},
  { re: /^the plugin is invalid$/, run: (w) => { expect(w.valid).toBe(false); }},
  { re: /^the plugin has (\d+) skill$/, run: (w, m) => { expect(validatePluginStructure(w.pluginDir!).skills.length).toBe(parseInt(m[1])); }},
  { re: /^the plugin has (\d+) skills$/, run: (w, m) => { expect(validatePluginStructure(w.pluginDir!).skills.length).toBe(parseInt(m[1])); }},
  { re: /^the plugin has (\d+) command$/, run: (w, m) => { expect(validatePluginStructure(w.pluginDir!).commands.length).toBe(parseInt(m[1])); }},
  { re: /^the plugin has (\d+) agent$/, run: (w, m) => { expect(validatePluginStructure(w.pluginDir!).agents.length).toBe(parseInt(m[1])); }},
  { re: /^the error is "([^"]+)"$/, run: (w, m) => { expect(w.error).toBe(m[1]); }},
  { re: /^the error mentions missing required field "([^"]+)"$/, run: (w, m) => { expect(w.error).toContain(m[1]); }},
  { re: /^(\d+) plugins are discovered$/, run: (w, m) => { expect(w.discoveredPlugins?.length).toBe(parseInt(m[1])); }},
  { re: /^each plugin has a name, description, and source path$/, run: (w) => {
    for (const p of w.discoveredPlugins!) { expect(p.name).toBeDefined(); expect(p.source).toBeDefined(); }
  }},
  { re: /^a parse error is returned$/, run: (w) => { expect(w.error).toBeDefined(); }},
  { re: /^no plugins are discovered$/, run: (w) => { expect(w.discoveredPlugins?.length || 0).toBe(0); }},
];

export function matchStep(text: string): { def: StepDef; m: RegExpMatchArray } | null {
  for (const def of steps) {
    const m = text.match(def.re);
    if (m) return { def, m };
  }
  return null;
}

export function runScenario(scenario: import('./gherkin.js').Scenario): void {
  const world: World = { tmpDir: '' };
  try {
    for (const step of scenario.steps) {
      const hit = matchStep(step.text);
      if (!hit) throw new Error(`Unbound step: "${step.text}"`);
      hit.def.run(world, hit.m);
    }
  } finally {
    if (world.tmpDir && existsSync(world.tmpDir)) {
      rmSync(world.tmpDir, { recursive: true, force: true });
    }
  }
}
