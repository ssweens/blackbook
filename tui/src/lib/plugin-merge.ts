import type { Plugin } from "./types.js";
import { getPluginToolStatus } from "./install.js";

export interface InstallStatus {
  installed: boolean;
  incomplete?: boolean;
}

function parseSemverParts(version?: string): [number, number, number] | null {
  if (!version) return null;
  const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

export function compareVersions(a?: string, b?: string): number {
  const left = parseSemverParts(a);
  const right = parseSemverParts(b);
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

export function hasPluginUpdate(installedVersion?: string, latestVersion?: string): boolean {
  if (!installedVersion || !latestVersion) return false;
  const semantic = parseSemverParts(installedVersion) && parseSemverParts(latestVersion);
  return semantic ? compareVersions(installedVersion, latestVersion) < 0 : installedVersion !== latestVersion;
}

export function uniqueStrings(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))].sort();
}

export function newestMarketplacePluginFor(scannedPlugin: Plugin, marketplacePlugins: Plugin[]): Plugin | undefined {
  const candidates = marketplacePlugins.filter((p) => p.name === scannedPlugin.name);
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => {
    const versionCmp = compareVersions(b.latestVersion ?? b.version, a.latestVersion ?? a.version);
    if (versionCmp !== 0) return versionCmp;
    if (a.marketplace === scannedPlugin.marketplace) return -1;
    if (b.marketplace === scannedPlugin.marketplace) return 1;
    return a.marketplace.localeCompare(b.marketplace);
  })[0];
}

export function getInstallStatus(plugin: Plugin, installedAny: boolean): InstallStatus {
  const statuses = getPluginToolStatus(plugin);
  const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
  if (supportedEnabled.length === 0) return { installed: false, incomplete: false };

  const installedByToolStatus = supportedEnabled.some((status) => status.installed);
  if (!installedAny && !installedByToolStatus) return { installed: false, incomplete: false };

  // "Incomplete" means a materializable FILE component (skill/command/agent) is
  // absent somewhere it should be. A plugin with no file components at all
  // (MCP/LSP/hooks/output-style only) can't be partially installed — its status
  // is binary, so it must never read as incomplete.
  const hasFileComponents =
    plugin.skills.length + plugin.commands.length + plugin.agents.length > 0;
  if (!hasFileComponents) return { installed: true, incomplete: false };

  const incomplete = supportedEnabled.some((status) => !status.installed);
  return { installed: true, incomplete };
}

function mergeInstalledPluginMetadata(
  scannedPlugin: Plugin,
  allMarketplacePlugins: Plugin[],
  configuredMarketplaceNames: Set<string>,
): Plugin {
  const marketplacePlugin = newestMarketplacePluginFor(scannedPlugin, allMarketplacePlugins);
  if (marketplacePlugin) {
    const installedVersion = scannedPlugin.installedVersion ?? scannedPlugin.version;
    const latestVersion = marketplacePlugin.latestVersion ?? marketplacePlugin.version;
    const status = getInstallStatus(marketplacePlugin, true);
    return {
      ...marketplacePlugin,
      skills: marketplacePlugin.skills.length > 0 ? marketplacePlugin.skills : scannedPlugin.skills,
      commands: marketplacePlugin.commands.length > 0 ? marketplacePlugin.commands : scannedPlugin.commands,
      agents: marketplacePlugin.agents.length > 0 ? marketplacePlugin.agents : scannedPlugin.agents,
      hooks: marketplacePlugin.hooks.length > 0 ? marketplacePlugin.hooks : scannedPlugin.hooks,
      hasMcp: marketplacePlugin.hasMcp || scannedPlugin.hasMcp,
      installed: true,
      incomplete: status.incomplete,
      installedVersion,
      latestVersion,
      version: latestVersion ?? marketplacePlugin.version,
      hasUpdate: hasPluginUpdate(installedVersion, latestVersion),
      installedMarketplace: scannedPlugin.marketplace,
      prescriptionStatus: "in-git",
    };
  }

  const status = getInstallStatus(scannedPlugin, true);
  const marketplaceStillConfigured = configuredMarketplaceNames.has(scannedPlugin.marketplace);
  return {
    ...scannedPlugin,
    installed: true,
    incomplete: status.incomplete,
    latestVersion: scannedPlugin.latestVersion ?? scannedPlugin.version,
    hasUpdate: hasPluginUpdate(scannedPlugin.installedVersion, scannedPlugin.latestVersion ?? scannedPlugin.version),
    prescriptionStatus: marketplaceStillConfigured ? "no-longer-in-marketplace" : "marketplace-removed",
  };
}

export function buildInstalledPlugins(
  scannedPlugins: Plugin[],
  allMarketplacePlugins: Plugin[],
  configuredMarketplaceNames: Set<string>,
): Plugin[] {
  const result: Plugin[] = [];
  const seenNames = new Set<string>();

  for (const scannedPlugin of scannedPlugins) {
    const merged = mergeInstalledPluginMetadata(scannedPlugin, allMarketplacePlugins, configuredMarketplaceNames);
    result.push(merged);
    seenNames.add(merged.name);
  }

  const marketplaceCandidates = [...allMarketplacePlugins].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return compareVersions(b.latestVersion ?? b.version, a.latestVersion ?? a.version);
  });

  for (const marketplacePlugin of marketplaceCandidates) {
    if (seenNames.has(marketplacePlugin.name)) continue;
    const status = getInstallStatus(marketplacePlugin, false);
    if (!status.installed) continue;
    const latestVersion = marketplacePlugin.latestVersion ?? marketplacePlugin.version;
    result.push({
      ...marketplacePlugin,
      installed: true,
      incomplete: status.incomplete,
      latestVersion,
      version: latestVersion ?? marketplacePlugin.version,
      hasUpdate: hasPluginUpdate(marketplacePlugin.installedVersion, latestVersion),
      prescriptionStatus: "in-git",
    });
    seenNames.add(marketplacePlugin.name);
  }

  // PASS 3: Include uninstalled marketplace plugins from configured marketplaces.
  // These are repo-prescribed plugins that appear in the Installed tab so users
  // can see what's available from their source_repo without visiting Discover.
  for (const marketplacePlugin of marketplaceCandidates) {
    if (seenNames.has(marketplacePlugin.name)) continue;
    const latestVersion = marketplacePlugin.latestVersion ?? marketplacePlugin.version;
    result.push({
      ...marketplacePlugin,
      installed: false,
      incomplete: false,
      latestVersion,
      version: latestVersion ?? marketplacePlugin.version,
      hasUpdate: false,
      prescriptionStatus: "in-git",
    });
    seenNames.add(marketplacePlugin.name);
  }

  return result;
}
