/**
 * Pi bridge adapter. Pi is driven through a subprocess ("bridge") that runs the
 * @ssweens/pi-plugins orchestrators under `bun -e`. This module owns bridge
 * readiness detection (isPiPluginBridgeReady) and the install/update/uninstall
 * bridge invocations, plus Pi's native installed-plugin listing.
 *
 * isPiPluginBridgeReady is the single home for Pi-bridge resolution logic and is
 * consumed by both the status check (plugin-status.ts) and the install path so
 * they can never diverge.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Plugin, ToolInstance } from "../types.js";
import { getCacheDir } from "../config.js";
import { loadPiSettings, normalizePiPackageSource } from "../marketplace.js";
import { listPiBridgeInstalledPlugins } from "../pi-bridge.js";
import { validateMarketplaceName, logError } from "../validation.js";
import type {
  ToolAdapter,
  PerInstanceResult,
  SupportInput,
  InstalledContext,
} from "./types.js";

const execFileAsync = promisify(execFile);

const PI_PLUGINS_PACKAGE_NAME = "@ssweens/pi-plugins";
const PI_PLUGINS_EXTENSION_DIR = "pi-plugins";
const PI_SOFT_DEP_REQUIRED_SOURCES = [
  "npm:pi-subagents",
  "npm:pi-mcp-adapter",
] as const;
const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_SETTINGS_DIR = PI_AGENT_DIR;

function resolvePiSettingsPackagePath(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("npm:")) return null;
  const expanded = trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1)) : trimmed;
  return resolve(PI_SETTINGS_DIR, expanded);
}

function isPiPluginsSource(source: string): boolean {
  const normalized = normalizePiPackageSource(source);
  if (normalized === normalizePiPackageSource(`npm:${PI_PLUGINS_PACKAGE_NAME}`)) return true;

  const resolved = resolvePiSettingsPackagePath(source);
  if (resolved) {
    try {
      const pkg = JSON.parse(readFileSync(join(resolved, "package.json"), "utf-8"));
      return pkg?.name === PI_PLUGINS_PACKAGE_NAME;
    } catch {
      return basename(resolved) === PI_PLUGINS_EXTENSION_DIR;
    }
  }

  return false;
}

export function resolvePiPluginsPackageRoot(): string | null {
  const nodeModulesCandidate = join(PI_AGENT_DIR, "npm", "node_modules", "@ssweens", "pi-plugins");
  if (existsSync(join(nodeModulesCandidate, "package.json"))) return nodeModulesCandidate;

  for (const source of loadPiSettings().packages) {
    const resolved = resolvePiSettingsPackagePath(source);
    if (!resolved) continue;
    if (existsSync(join(resolved, "package.json")) && isPiPluginsSource(source)) return resolved;
  }

  return null;
}

export function isPiPluginBridgeReady(): boolean {
  const settings = loadPiSettings();
  const installed = new Set(settings.packages.map((s) => normalizePiPackageSource(s)));
  const hasPiPlugins = settings.packages.some(isPiPluginsSource);
  const hasSoftDeps = PI_SOFT_DEP_REQUIRED_SOURCES.every((s) => installed.has(normalizePiPackageSource(s)));
  return hasPiPlugins && hasSoftDeps && resolvePiPluginsPackageRoot() !== null;
}

function toPiBridgeMarketplaceSource(rawSource: string): string {
  const s = rawSource.trim();
  const rawMatch = s.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/.+$/);
  if (rawMatch) {
    const [, owner, repo, ref] = rawMatch;
    return `https://github.com/${owner}/${repo}#${ref}`;
  }
  const ghBlobMatch = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/.+$/);
  if (ghBlobMatch) {
    const [, owner, repo, ref] = ghBlobMatch;
    return `https://github.com/${owner}/${repo}#${ref}`;
  }
  return s;
}

export async function runPiBridgeMarketplaceRemoveCommand(
  instance: ToolInstance,
  marketplaceName: string,
): Promise<void> {
  validateMarketplaceName(marketplaceName);

  if (!isPiPluginBridgeReady()) {
    throw new Error("Pi plugin bridge is not ready. Install: npm:@ssweens/pi-plugins, npm:pi-subagents, npm:pi-mcp-adapter");
  }

  const piPluginsRoot = resolvePiPluginsPackageRoot();
  if (!piPluginsRoot) {
    throw new Error("Pi plugin bridge package @ssweens/pi-plugins was not found in Pi settings or Pi node_modules.");
  }

  const script = `
import { removeMarketplace } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "orchestrators", "marketplace", "remove.ts"))};

const marketplace = ${JSON.stringify(marketplaceName)};
const cwd = ${JSON.stringify(instance.configDir)};
const ctx = { ui: { notify: () => {} } };
const pi = { getAllTools: () => [] };

await removeMarketplace({
  ctx,
  pi,
  scope: "user",
  cwd,
  name: marketplace,
});
`;

  await execFileAsync("bun", ["-e", script], {
    timeout: 120000,
    cwd: instance.configDir,
  });
}

export async function runPiBridgePluginCommand(
  instance: ToolInstance,
  command: string,
  marketplaceUrl?: string,
): Promise<void> {
  if (!isPiPluginBridgeReady()) {
    throw new Error("Pi plugin bridge is not ready. Install: npm:@ssweens/pi-plugins, npm:pi-subagents, npm:pi-mcp-adapter");
  }

  const piPluginsRoot = resolvePiPluginsPackageRoot();
  if (!piPluginsRoot) {
    throw new Error("Pi plugin bridge package @ssweens/pi-plugins was not found in Pi settings or Pi node_modules.");
  }

  const match = command.match(/^(?:\/plugin|\/claude:plugin)\s+(install|update|uninstall)\s+([^@\s]+)@([^\s]+)$/);
  if (!match) {
    throw new Error(`Unsupported Pi bridge command format: ${command}`);
  }

  const op = match[1];
  const plugin = match[2];
  const marketplace = match[3];
  const marketplaceSource = marketplaceUrl ? toPiBridgeMarketplaceSource(marketplaceUrl) : "";
  const bridgeStageRoot = join(getCacheDir(), "pi-bridge-marketplaces");

  const script = `
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addMarketplace } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "orchestrators", "marketplace", "add.ts"))};
import { installPlugin } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "orchestrators", "plugin", "install.ts"))};
import { updatePlugins } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "orchestrators", "plugin", "update.ts"))};
import { uninstallPlugin } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "orchestrators", "plugin", "uninstall.ts"))};
import { locationsFor } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "persistence", "locations.ts"))};
import { loadState, saveState } from ${JSON.stringify(join(piPluginsRoot, "extensions", "pi-plugins", "persistence", "state-io.ts"))};

const op = ${JSON.stringify(op)};
const plugin = ${JSON.stringify(plugin)};
const marketplace = ${JSON.stringify(marketplace)};
const marketplaceUrl = ${JSON.stringify(marketplaceUrl ?? "")};
let marketplaceSource = ${JSON.stringify(marketplaceSource)};
const cwd = ${JSON.stringify(instance.configDir)};
const bridgeStageRoot = ${JSON.stringify(bridgeStageRoot)};

const ctx = { ui: { notify: () => {} } };
const pi = { getAllTools: () => [] };

async function readJsonIfExists(p) {
  try { return JSON.parse(await readFile(p, 'utf-8')); } catch { return undefined; }
}

async function readMcpServers(pluginDir, relPath = '.mcp.json') {
  const cleanRel = String(relPath || '.mcp.json').replace(/^\\.\\//, '');
  const parsed = await readJsonIfExists(path.join(pluginDir, cleanRel));
  if (!parsed || typeof parsed !== 'object') return undefined;
  return parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : parsed;
}

async function repointExistingMarketplaceToSource(marketplaceSource) {
  const locations = locationsFor('user', cwd);
  const state = await loadState(locations.extensionRoot);
  const existing = state.marketplaces[marketplace];
  if (!existing) return false;

  state.marketplaces[marketplace] = {
    ...existing,
    source: { kind: 'path', raw: marketplaceSource, logical: marketplaceSource },
    manifestPath: path.join(marketplaceSource, '.claude-plugin', 'marketplace.json'),
    marketplaceRoot: marketplaceSource,
    lastUpdatedAt: new Date().toISOString(),
  };
  await saveState(locations.extensionRoot, state);
  return true;
}

async function piCompatibleMarketplaceSource(source) {
  if (!source || source.startsWith('http://') || source.startsWith('https://')) return source;

  let marketplaceRoot = source;
  let manifestPath = source;
  try {
    const stat = await import('node:fs/promises').then((fs) => fs.stat(source));
    if (stat.isDirectory()) {
      marketplaceRoot = source;
      manifestPath = path.join(source, '.claude-plugin', 'marketplace.json');
    } else {
      marketplaceRoot = path.dirname(path.dirname(source));
    }
  } catch {
    return source;
  }

  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest || !Array.isArray(manifest.plugins)) return source;

  const configuredLocalMarketplace = marketplaceUrl !== '' && !marketplaceUrl.startsWith('http://') && !marketplaceUrl.startsWith('https://');
  if (configuredLocalMarketplace) {
    // Local marketplaces are already Pi-compatible. Keep the real repository
    // path as the pi-plugins source so updates track the local checkout instead
    // of a Blackbook cache copy.
    return marketplaceRoot;
  }

  const stageDir = path.join(bridgeStageRoot, marketplace);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(path.join(stageDir, '.claude-plugin'), { recursive: true });

  const stagedManifest = { ...manifest, plugins: [] };
  for (const entry of manifest.plugins) {
    const nextEntry = { ...entry };
    if (typeof entry.source === 'string' && entry.source.startsWith('./')) {
      const rel = entry.source.replace(/^\\.\\//, '');
      const sourceDir = path.resolve(marketplaceRoot, rel);
      const targetDir = path.join(stageDir, rel);
      await mkdir(path.dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true, force: true, dereference: true });

      const pluginManifestPath = path.join(targetDir, '.claude-plugin', 'plugin.json');
      const pluginManifest = await readJsonIfExists(pluginManifestPath);
      if (pluginManifest && typeof pluginManifest === 'object') {
        if (typeof pluginManifest.mcpServers === 'string') {
          nextEntry.mcpServers = await readMcpServers(targetDir, pluginManifest.mcpServers);
          delete pluginManifest.mcpServers;
        } else if (pluginManifest.mcpServers && typeof pluginManifest.mcpServers === 'object' && !Array.isArray(pluginManifest.mcpServers)) {
          nextEntry.mcpServers = pluginManifest.mcpServers;
        } else if ('mcpServers' in pluginManifest) {
          delete pluginManifest.mcpServers;
        }
        await writeFile(pluginManifestPath, JSON.stringify(pluginManifest, null, 2), 'utf-8');
      }

      if (!nextEntry.mcpServers) {
        nextEntry.mcpServers = await readMcpServers(targetDir);
      }
      if (nextEntry.mcpServers === undefined) delete nextEntry.mcpServers;
    }
    stagedManifest.plugins.push(nextEntry);
  }

  const stagedManifestPath = path.join(stageDir, '.claude-plugin', 'marketplace.json');
  await writeFile(stagedManifestPath, JSON.stringify(stagedManifest, null, 2), 'utf-8');
  return stageDir;
}

if (op === "install") {
  if (!marketplaceUrl) {
    throw new Error("Missing marketplace URL for Pi bridge install on " + marketplace);
  }
  if (marketplaceUrl.startsWith('http://') || marketplaceUrl.startsWith('https://')) {
    const res = await fetch(marketplaceUrl);
    if (!res.ok) {
      throw new Error('Failed to fetch marketplace manifest: ' + res.status + ' ' + res.statusText);
    }
    const body = await res.text();
    const stageDir = path.join(bridgeStageRoot, marketplace);
    const manifestPath = path.join(stageDir, '.claude-plugin', 'marketplace.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, body, 'utf-8');
    marketplaceSource = manifestPath;
  }

  marketplaceSource = await piCompatibleMarketplaceSource(marketplaceSource);

  try {
    await addMarketplace({
      ctx,
      scope: "user",
      cwd,
      rawSource: marketplaceSource,
    });
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (msg.includes("already exists") || msg.includes("duplicate") || msg.includes("already configured")) {
      await repointExistingMarketplaceToSource(marketplaceSource);
    } else {
      throw e;
    }
  }

  const outcome = await installPlugin({
    ctx,
    pi,
    scope: "user",
    cwd,
    marketplace,
    plugin,
    notifications: { mode: "orchestrated" },
  });
  if (outcome.status !== "installed" && outcome.status !== "already-installed") {
    throw new Error("Pi install failed: " + outcome.status + (outcome.cause ? " - " + outcome.cause : ""));
  }
} else if (op === "update") {
  if (marketplaceUrl !== '' && !marketplaceUrl.startsWith('http://') && !marketplaceUrl.startsWith('https://')) {
    marketplaceSource = await piCompatibleMarketplaceSource(marketplaceSource);
    await repointExistingMarketplaceToSource(marketplaceSource);
  }

  await updatePlugins({
    ctx,
    pi,
    scope: "user",
    cwd,
    target: { kind: "plugin", plugin, marketplace },
  });
} else if (op === "uninstall") {
  await uninstallPlugin({
    ctx,
    pi,
    scope: "user",
    cwd,
    marketplace,
    plugin,
  });
} else {
  throw new Error("Unsupported op: " + op);
}
`;

  await execFileAsync("bun", ["-e", script], {
    timeout: 120000,
    cwd: instance.configDir,
  });
}

function getInstalledPluginsForPiInstance(): Plugin[] {
  return listPiBridgeInstalledPlugins().map((plugin) => ({
    name: plugin.name,
    marketplace: plugin.marketplace,
    version: plugin.version,
    installedVersion: plugin.version,
    latestVersion: plugin.version,
    description: "",
    source: plugin.resolvedSource ?? "",
    skills: plugin.skills,
    commands: plugin.commands,
    agents: plugin.agents,
    hooks: plugin.hooks,
    hasMcp: plugin.hasMcp,
    hasLsp: false,
    homepage: "",
    installed: true,
    scope: "user",
  }));
}

export const piBridgeAdapter: ToolAdapter = {
  toolId: "pi",
  usesSource: false,

  supports(input: SupportInput): { supported: boolean; reason?: string } {
    const { canInstallSkills, canInstallCommands, canInstallAgents } = input;
    const baseSupported = canInstallSkills || canInstallCommands || canInstallAgents;
    const piBridgeReady = isPiPluginBridgeReady();
    const supported = piBridgeReady && baseSupported;
    if (!piBridgeReady) {
      return {
        supported,
        reason: "Pi bridge missing (install: @ssweens/pi-plugins, pi-subagents, pi-mcp-adapter)",
      };
    }
    return { supported };
  },

  isInstalled(plugin: Plugin, _instance: ToolInstance, ctx: InstalledContext): boolean {
    const ids = ctx.getPiBridgeInstalledIds();
    const id1 = `${plugin.name}@${plugin.marketplace}`;
    const id2 = plugin.installedMarketplace ? `${plugin.name}@${plugin.installedMarketplace}` : "";
    return ids.has(id1) || (id2 ? ids.has(id2) : false);
  },

  listInstalled(): Plugin[] {
    return getInstalledPluginsForPiInstance();
  },

  async install(
    plugin: Plugin,
    instance: ToolInstance,
    _sourcePath: string | null,
    marketplaceUrl: string,
  ): Promise<PerInstanceResult> {
    try {
      await runPiBridgePluginCommand(instance, `/plugin install ${plugin.name}@${plugin.marketplace}`, marketplaceUrl);
      return { count: 1, errors: [] };
    } catch (e) {
      return {
        count: 0,
        errors: [
          `Pi bridge install failed for ${instance.name}: ${e instanceof Error ? e.message : "unknown error"}`,
        ],
      };
    }
  },

  async uninstall(plugin: Plugin, instance: ToolInstance): Promise<PerInstanceResult> {
    // Await the bridge so a failure is observed (no unhandled rejection) and the
    // caller learns the truth instead of a false success.
    try {
      await runPiBridgePluginCommand(instance, `/plugin uninstall ${plugin.name}@${plugin.marketplace}`);
      return { count: 1, errors: [] };
    } catch (error) {
      logError(`Pi bridge uninstall failed for ${plugin.name} in ${instance.name}`, error);
      return { count: 0, errors: [] };
    }
  },

  async update(
    plugin: Plugin,
    instance: ToolInstance,
    _sourcePath: string | null,
    marketplaceUrl: string,
  ): Promise<PerInstanceResult> {
    try {
      await runPiBridgePluginCommand(instance, `/plugin update ${plugin.name}@${plugin.marketplace}`, marketplaceUrl);
      return { count: 1, errors: [] };
    } catch (error) {
      logError(`Pi bridge update failed for ${plugin.name} in ${instance.name}`, error);
      return {
        count: 0,
        errors: [
          `Pi bridge update failed for ${plugin.name} in ${instance.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        ],
      };
    }
  },

  // Component surface: same bridge install as the lifecycle, but intentionally
  // lets exceptions propagate so enable/disable/sync produce their own
  // context-specific error messages (matching the pre-refactor behavior).
  async installComponents(
    plugin: Plugin,
    instance: ToolInstance,
    _sourcePath: string | null,
    marketplaceUrl?: string,
  ): Promise<PerInstanceResult> {
    await runPiBridgePluginCommand(instance, `/plugin install ${plugin.name}@${plugin.marketplace}`, marketplaceUrl);
    return { count: 1, errors: [] };
  },

  async removeComponents(plugin: Plugin, instance: ToolInstance): Promise<number> {
    try {
      await runPiBridgePluginCommand(instance, `/plugin uninstall ${plugin.name}@${plugin.marketplace}`);
      return 1;
    } catch {
      return 0;
    }
  },
};
