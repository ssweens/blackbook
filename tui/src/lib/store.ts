import { create } from "zustand";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join } from "path";

/**
 * Yield to the event loop so Ink can process keyboard input between
 * synchronous filesystem checks. Without this, tight loops of fs.existsSync
 * and fs.readFileSync block the event loop for hundreds of milliseconds,
 * making the TUI feel frozen.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

import type {
  Tab,
  Marketplace,
  Plugin,
  FileStatus,
  FileInstanceStatus,
  AppState,
  Notification,
  SyncPreviewItem,
  DiffTarget,
  DiffInstanceRef,
  MissingSummary,
  PiPackage,
  PiMarketplace,
  PiPackageSpec,
  DiscoverSection,
  DiscoverSubView,
  ManagedToolRow,
  ToolDetectionResult,
} from "./types.js";
import { fetchMarketplace, loadAllPiMarketplaces, getAllPiPackages, loadPiSettings, isPackageInstalled, fetchNpmPackageDetails, getGlobalPiPackageInstallInfo, getSourceType, normalizePiPackageSource } from "./marketplace.js";
import { installPiPackage, removePiPackage, updatePiPackage, repairPiPackageManager } from "./pi-install.js";
import {
  parseMarketplaces,
  addMarketplace as addMarketplaceToConfig,
  removeMarketplace as removeMarketplaceFromConfig,
  ensureConfigExists,
  getConfigPath,
  getToolInstances,
  updateToolInstanceConfig,
  getEnabledToolInstances,
  getCacheDir,
  loadConfig,
  setMarketplaceEnabled,
  setPiMarketplaceEnabled,
  addPiMarketplace as addPiMarketplaceToConfig,
  removePiMarketplace as removePiMarketplaceFromConfig,
  getPackageManager,
  getConfigRepoPath,
  getAssetsRepoPath,
} from "./config.js";
import { loadConfig as loadYamlConfig, getConfigPath as getYamlConfigPath } from "./config/loader.js";
import { saveConfig as saveYamlConfig } from "./config/writer.js";
import { resolveSourcePath, expandPath as expandConfigPath } from "./config/path.js";
import { pullSourceRepo, primeSourceRepoStatus, clearSourceStatusCache } from "./source-setup.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "./config/playbooks.js";
import { runCheck, runApply } from "./modules/orchestrator.js";
import { fileCopyModule } from "./modules/file-copy.js";
import { directorySyncModule } from "./modules/directory-sync.js";
import { globCopyModule } from "./modules/glob-copy.js";
import { buildFileDiffTarget, buildFileMissingSummary, buildSkillDiffTarget } from "./diff.js";
import { buildStateKey } from "./state.js";
import type { OrchestratorStep } from "./modules/orchestrator.js";
import { getManagedToolRows } from "./tool-view.js";
import { detectTool } from "./tool-detect.js";
import { TOOL_REGISTRY, getToolRegistryEntry } from "./tool-registry.js";
import { installTool, uninstallTool, updateTool, reinstallTool, detectInstallMethodMismatch, detectInstallMethodFromPath, type ProgressEvent } from "./tool-lifecycle.js";

import {
  getAllInstalledPlugins,
  getStandaloneSkills,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  getPluginToolStatus,
  syncPluginInstances,
  manifestPath,
  removeClaudeMarketplace,
  groupSkillsByNamespace,
} from "./install.js";
import { invalidatePluginToolStatusCache } from "./plugin-status.js";
import type { PluginDrift } from "./plugin-drift.js";
import { countStoreUpdate } from "./perf.js";
import { filesToManagedItems, piPackagesToManagedItems, pluginsToManagedItems } from "./managed-item.js";
import type { ManagedItem } from "./managed-item.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: (options?: { silent?: boolean }) => Promise<void>;
  loadFiles: (options?: { silent?: boolean }) => Promise<FileStatus[]>;
  loadTools: () => void;
  refreshManagedTools: () => void;
  refreshToolDetection: () => Promise<void>;
  installToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  updateToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  uninstallToolAction: (toolId: string) => Promise<boolean>;
  cancelToolAction: () => void;
  refreshAll: (options?: { silent?: boolean }) => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  trackPluginInSource: (plugin: Plugin) => Promise<boolean>;
  removePluginFromGit: (plugin: Plugin) => Promise<boolean>;
  setDetailPlugin: (plugin: Plugin | null) => void;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  /** Unified detail setter. Replaces setDetailPlugin/etc. */
  setDetail: (d: import("./types.js").DetailArtifact | null) => void;
  /** Re-resolve `detail` from current store state; close if artifact no longer exists. */
  refreshDetail: () => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => Promise<void>;
  updateMarketplace: (name: string) => Promise<void>;
  toggleMarketplaceEnabled: (name: string) => Promise<void>;
  toggleToolEnabled: (toolId: string, instanceId: string) => Promise<void>;
  updateToolConfigDir: (toolId: string, instanceId: string, configDir: string) => Promise<void>;
  getSyncPreview: () => SyncPreviewItem[];
  syncTools: (items: SyncPreviewItem[]) => Promise<void>;
  notify: (message: string, type?: Notification["type"], options?: { spinner?: boolean }) => string;
  clearNotification: (id: string) => void;
  // Pi package actions
  loadPiPackages: (options?: { silent?: boolean }) => Promise<void>;
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  repairPiPackage: (pkg: PiPackage) => Promise<boolean>;
  trackPiPackageInSource: (pkg: PiPackage) => Promise<boolean>;
  removePiPackageFromGit: (pkg: PiPackage) => Promise<boolean>;
  deletePiPackageEverywhere: (pkg: PiPackage) => Promise<boolean>;
  setDetailPiPackage: (pkg: PiPackage | null) => Promise<void>;
  togglePiMarketplaceEnabled: (name: string) => Promise<void>;
  addPiMarketplace: (name: string, source: string) => Promise<void>;
  removePiMarketplace: (name: string) => Promise<void>;
  // Section navigation
  setSortBy: (by: AppState["sortBy"]) => void;
  setSortDir: (dir: AppState["sortDir"]) => void;
  setCurrentSection: (section: DiscoverSection) => void;
  setDiscoverSubView: (subView: DiscoverSubView) => void;
  toggleSyncSelection: (key: string) => void;
  setSyncArmed: (armed: boolean) => void;
  setPluginDriftMap: (map: Record<string, PluginDrift>) => void;
  // Diff view actions
  openDiffForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openMissingSummaryForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openDiffFromSyncItem: (item: SyncPreviewItem) => void;
  closeDiff: () => void;
  closeMissingSummary: () => void;

  // Pullback actions
  pullbackFileInstance: (file: FileStatus, instance: DiffInstanceRef) => Promise<boolean>;
}

export type Store = AppState & Actions;

function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
}

function isDirectorySource(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const stat = lstatSync(path);
    if (stat.isDirectory()) return true;
    if (stat.isSymbolicLink()) {
      return statSync(path).isDirectory();
    }
  } catch {
    return false;
  }
  return false;
}

function isGlobPath(pathValue: string): boolean {
  return /[*?\[{]/.test(pathValue);
}

function getSyncModule(sourcePath: string) {
  if (isGlobPath(sourcePath)) return globCopyModule;
  return isDirectorySource(sourcePath) ? directorySyncModule : fileCopyModule;
}

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

function compareVersions(a?: string, b?: string): number {
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

function hasPluginUpdate(installedVersion?: string, latestVersion?: string): boolean {
  if (!installedVersion || !latestVersion) return false;
  const semantic = parseSemverParts(installedVersion) && parseSemverParts(latestVersion);
  return semantic ? compareVersions(installedVersion, latestVersion) < 0 : installedVersion !== latestVersion;
}

function uniqueStrings(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))].sort();
}

function newestMarketplacePluginFor(scannedPlugin: Plugin, marketplacePlugins: Plugin[]): Plugin | undefined {
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

function getInstallStatus(plugin: Plugin, installedAny: boolean): InstallStatus {
  const statuses = getPluginToolStatus(plugin);
  const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
  if (supportedEnabled.length === 0) return { installed: false, incomplete: false };

  const installedByToolStatus = supportedEnabled.some((status) => status.installed);
  if (!installedAny && !installedByToolStatus) return { installed: false, incomplete: false };

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

function buildInstalledPlugins(
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

  return result;
}

function composeManagedItems(
  installedPlugins: Plugin[],
  files: FileStatus[],
  piPackages: PiPackage[],
): ManagedItem[] {
  return [
    ...pluginsToManagedItems(installedPlugins),
    ...filesToManagedItems(files),
    ...piPackagesToManagedItems(piPackages),
  ];
}

function loadDesiredPiPackageSpecs(): PiPackageSpec[] {
  const result = loadYamlConfig();
  if (result.errors.length > 0) return [];
  return result.config.pi_packages;
}

function getSourceRepoBlackbookConfigPath(config: ReturnType<typeof loadYamlConfig>["config"]): string | null {
  const sourceRepo = config.settings.source_repo;
  if (!sourceRepo) return null;
  return join(expandConfigPath(sourceRepo), "config", "blackbook", "config.yaml");
}

function removePiPackageSpec(source: string, specs: PiPackageSpec[]): { specs: PiPackageSpec[]; removed: boolean } {
  const sourceKey = normalizePiPackageSource(source);
  const specsAfterDelete = specs.filter((entry) => normalizePiPackageSource(entry.source) !== sourceKey);
  return { specs: specsAfterDelete, removed: specsAfterDelete.length < specs.length };
}

function inferPackageNameFromSource(source: string): string {
  const trimmed = source.trim().replace(/\/$/, "");
  if (trimmed.startsWith("npm:")) return trimmed.slice(4);
  if (trimmed.startsWith("git:")) return inferPackageNameFromSource(trimmed.slice(4));

  const withoutGit = trimmed.replace(/\.git$/, "");

  // For filesystem paths, use the final path segment.
  if (withoutGit.startsWith("/") || withoutGit.startsWith("./") || withoutGit.startsWith("../")) {
    const parts = withoutGit.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? withoutGit;
  }

  const match = withoutGit.match(/([^/@:]+\/[^/@:]+|[^/@:]+)$/);
  return match ? match[1] : withoutGit;
}

function ensurePluginJson(pluginDir: string, plugin: Plugin): void {
  const pluginJsonPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (existsSync(pluginJsonPath)) return;
  mkdirSync(dirname(pluginJsonPath), { recursive: true });
  writeFileSync(pluginJsonPath, JSON.stringify({
    name: plugin.name,
    description: plugin.description,
    version: plugin.installedVersion ?? plugin.version ?? "1.0.0",
    skills: plugin.skills,
    commands: plugin.commands,
    agents: plugin.agents,
  }, null, 2));
}

function removeFromSourceRepoMarketplace(sourceRepo: string, pluginName: string): void {
  const marketplacePath = join(sourceRepo, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) return;
  try {
    const marketplace = JSON.parse(readFileSync(marketplacePath, "utf-8"));
    if (!Array.isArray(marketplace.plugins)) return;
    marketplace.plugins = (marketplace.plugins as Array<Record<string, unknown>>).filter(
      (p) => p.name !== pluginName,
    );
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
  } catch { /* ignore */ }
}

function upsertSourceRepoMarketplacePlugin(sourceRepo: string, plugin: Plugin): void {
  const marketplacePath = join(sourceRepo, ".claude-plugin", "marketplace.json");
  mkdirSync(dirname(marketplacePath), { recursive: true });

  let marketplace: Record<string, unknown> = {
    name: "playbook",
    plugins: [],
  };
  if (existsSync(marketplacePath)) {
    try {
      marketplace = JSON.parse(readFileSync(marketplacePath, "utf-8"));
    } catch {
      marketplace = { name: "playbook", plugins: [] };
    }
  }

  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins as Array<Record<string, unknown>> : [];
  const entry = {
    name: plugin.name,
    description: plugin.description,
    version: plugin.installedVersion ?? plugin.version ?? "1.0.0",
    source: `./plugins/${plugin.name}`,
  };
  const existingIndex = plugins.findIndex((p) => p.name === plugin.name);
  if (existingIndex >= 0) plugins[existingIndex] = { ...plugins[existingIndex], ...entry };
  else plugins.push(entry);
  marketplace.plugins = plugins;

  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
}

async function createPiPackageFromSpec(
  spec: PiPackageSpec,
  preferredManager: ReturnType<typeof getPackageManager>,
  settings: ReturnType<typeof loadPiSettings>,
  installInfo: ReturnType<typeof getGlobalPiPackageInstallInfo>,
): Promise<PiPackage> {
  const source = spec.source;
  const sourceType = getSourceType(source);
  const installed = isPackageInstalled(source, settings);
  const npmName = source.startsWith("npm:") ? source.slice(4) : null;
  const detected = npmName ? installInfo.get(npmName) : undefined;
  const details = npmName ? await fetchNpmPackageDetails(npmName) : null;
  const latestVersion = details?.version ?? "0.0.0";
  const installedVersion = detected?.version ?? undefined;

  return {
    name: spec.name ?? details?.name ?? (npmName ?? inferPackageNameFromSource(source)),
    description: spec.description ?? details?.description ?? "Repo-prescribed Pi package",
    version: latestVersion,
    source,
    sourceType,
    marketplace: spec.marketplace ?? (sourceType === "npm" ? "npm" : "source repo"),
    installed,
    recommended: true,
    installedVersion,
    hasUpdate: Boolean(installed && installedVersion && installedVersion !== latestVersion),
    installedVia: detected?.via,
    installedViaManagers: detected?.viaManagers,
    managerMismatch: Boolean(installed && detected?.managerMismatch),
    preferredManager,
    extensions: details?.extensions ?? [],
    skills: details?.skills ?? [],
    prompts: details?.prompts ?? [],
    themes: details?.themes ?? [],
    homepage: details?.homepage,
    repository: details?.repository,
    author: details?.author,
    license: details?.license,
  };
}


function buildSyncPreview(plugins: Plugin[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const plugin of plugins) {
    const statuses = getPluginToolStatus(plugin);
    const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
    if (supportedEnabled.length === 0) continue;
    const installedAny = supportedEnabled.some((status) => status.installed);
    if (!installedAny) continue;
    const missingInstances = supportedEnabled
      .filter((status) => !status.installed)
      .map((status) => status.name);
    if (missingInstances.length === 0) continue;

    preview.push({ kind: "plugin", plugin, missingInstances });
  }
  return preview;
}


function buildFileSyncPreview(files: FileStatus[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const file of files) {
    const missingInstances = file.instances
      .filter((i) => i.status === "missing")
      .map((i) => i.instanceName);
    const driftedInstances = file.instances
      .filter((i) => i.status === "drifted")
      .map((i) => i.instanceName);

    if (missingInstances.length === 0 && driftedInstances.length === 0) continue;

    preview.push({ kind: "file", file, missingInstances, driftedInstances });
  }
  return preview;
}

function buildSkillSyncPreview(
  skills: import("./install.js").StandaloneSkill[],
  toolInstances: ReturnType<typeof getToolInstances>,
): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  if (!skills || skills.length === 0) return preview;
  if (!toolInstances) return preview;
  // Tools that support skills (enabled, have skillsSubdir).
  const skillCapable = toolInstances.filter(
    (i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir,
  );
  for (const skill of skills) {
    if (!skill.sourcePath) continue; // can't sync without a source
    const installedKeys = new Set(
      skill.installations.map((i) => `${i.toolId}:${i.instanceId}`),
    );
    const missingInstances = skillCapable
      .filter((i) => !installedKeys.has(`${i.toolId}:${i.instanceId}`))
      .map((i) => i.name);
    const driftedInstances = skill.installations
      .filter((i) => i.drifted)
      .map((i) => i.instanceName);
    if (missingInstances.length === 0 && driftedInstances.length === 0) continue;
    preview.push({ kind: "skill", skill, missingInstances, driftedInstances });
  }
  return preview;
}

function buildPiPackageSyncPreview(packages: PiPackage[]): SyncPreviewItem[] {
  return packages
    .filter((pkg) => pkg.recommended && !pkg.installed)
    .map((pkg) => ({ kind: "piPackage" as const, piPackage: pkg }));
}

function buildToolSyncPreview(
  tools: ManagedToolRow[],
  toolDetection: Record<string, ToolDetectionResult>
): SyncPreviewItem[] {
  const uniqueByTool = new Map<string, ManagedToolRow>();
  for (const tool of tools) {
    if (!uniqueByTool.has(tool.toolId)) {
      uniqueByTool.set(tool.toolId, tool);
    }
  }

  const preview: SyncPreviewItem[] = [];
  for (const [toolId, tool] of uniqueByTool.entries()) {
    const detection = toolDetection[toolId];
    if (!detection) continue;
    if (!detection.installed) continue;
    if (!detection.hasUpdate) continue;
    if (!detection.installedVersion || !detection.latestVersion) continue;

    preview.push({
      kind: "tool",
      toolId,
      name: tool.displayName,
      installedVersion: detection.installedVersion,
      latestVersion: detection.latestVersion,
    });
  }

  return preview;
}

const TOOL_OUTPUT_MAX_LINES = 200;
let toolActionAbortController: AbortController | null = null;

/** Strip ANSI escape sequences so Ink doesn't re-interpret raw codes. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Append process output while handling carriage-return (\r) correctly.
 *
 * Terminal spinners (npm, pip, etc.) emit `\rNew text` to overwrite the
 * current line in-place.  The previous implementation only split on `\n`,
 * so every spinner frame was appended as a separate line, causing the
 * "stacking Upgrading" bug.
 *
 * Rules:
 *  - `\n` → new line (append)
 *  - bare `\r` (no following `\n`) → carriage return (replace last line)
 */
function appendToolOutput(existing: string[], chunk: string): string[] {
  if (!chunk) return existing;

  const clean = stripAnsi(chunk);
  const next = [...existing];
  const hasCarriageReturn = clean.includes("\r");

  // Split on actual newlines first
  const segments = clean.split("\n");

  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];

    // Within a segment, \r means "go back to start of line".
    // Keep only the text after the last \r (what the terminal would show).
    if (seg.includes("\r")) {
      const parts = seg.split("\r");
      seg = parts.filter((p) => p.length > 0).pop() || "";
    }

    const trimmed = seg.trim();
    if (trimmed.length === 0) continue;

    // First segment of a \r-containing chunk replaces the last output line
    // (simulates the terminal overwriting the current line).
    if (hasCarriageReturn && next.length > 0 && i === 0) {
      next[next.length - 1] = trimmed;
    } else {
      next.push(trimmed);
    }
  }

  if (next.length <= TOOL_OUTPUT_MAX_LINES) {
    return next;
  }
  return next.slice(next.length - TOOL_OUTPUT_MAX_LINES);
}

/** Run fn with a spinner notification, clear it on completion. Returns fn's result. */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  notifyFn: Store["notify"],
  clearFn: Store["clearNotification"],
): Promise<T> {
  const id = notifyFn(message, "info", { spinner: true });
  try {
    return await fn();
  } finally {
    clearFn(id);
  }
}

export const useStore = create<Store>((rawSet, get) => {
  const set: typeof rawSet = (arg) => {
    countStoreUpdate();
    return rawSet(arg as any);
  };
  return {
  tab: "installed",
  marketplaces: [],
  installedPlugins: [],
  installedPluginsLoaded: false,
  standaloneSkills: [] as import("./install.js").StandaloneSkill[],
  files: [],
  filesLoaded: false,
  tools: getToolInstances(),
  managedTools: getManagedToolRows(),
  toolDetection: {},
  toolDetectionPending: {},
  toolActionInProgress: null,
  toolActionOutput: [],
  search: "",
  selectedIndex: 0,
  loading: false,
  error: null,
  detailPlugin: null,
  detailMarketplace: null,
  detailPiPackage: null,
  detail: null,
  notifications: [],
  diffTarget: null,
  missingSummary: null,
  // Pi packages state
  piPackages: [],
  piPackagesLoaded: false,
  piMarketplaces: [],
  managedItems: [],
  // Sort state
  sortBy: "default" as AppState["sortBy"],
  sortDir: "asc" as AppState["sortDir"],
  // Sync tab state
  syncSelection: [] as string[],
  syncArmed: false,
  // Plugin drift cache
  pluginDriftMap: {} as Record<string, PluginDrift>,
  // Section navigation
  currentSection: "plugins" as DiscoverSection,
  discoverSubView: null as DiscoverSubView,

  setTab: (tab) =>
    set((state) =>
      state.tab === tab
        ? state
        : {
            tab,
            selectedIndex: 0,
            search: "",
            detailPlugin: null,
            detailMarketplace: null,
            discoverSubView: null,
            currentSection: "plugins",
            detail: null,
          }
    ),
  setSortBy: (by) => set({ sortBy: by }),
  setSortDir: (dir) => set({ sortDir: dir }),
  setSearch: (search) => set({ search, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setDetailPlugin: (plugin) => {
    // Mirror into the unified `detail` field.
    const prev = get().detail;
    set({
      detailPlugin: plugin,
      detail: plugin
        ? { kind: "plugin", data: plugin, drift: prev?.kind === "plugin" ? prev.drift : undefined }
        : null,
    });
  },
  setDetailMarketplace: (marketplace) => set({ detailMarketplace: marketplace }),
  /**
   * Unified detail setter. Replaces setDetailPlugin/setDetailFile/setDetailSkill/setDetailPiPackage.
   * Sets `detail` and mirrors plugin/piPackage data into the legacy detailPlugin/detailPiPackage
   * fields during the migration period (tests still reference those).
   */
  setDetail: (d) => {
    set({
      detail: d,
      detailPlugin: d?.kind === "plugin" ? d.data : null,
      detailPiPackage: d?.kind === "piPackage" ? d.data : null,
    });
  },
  /**
   * Re-resolve the active detail from the current store state. Used after a mutation
   * to pick up fresh data (e.g. drift updates, install status changes). Closes detail
   * if the artifact no longer exists.
   */
  refreshDetail: () => {
    const state = get();
    const d = state.detail;
    if (!d) return;
    switch (d.kind) {
      case "plugin": {
        // Prefer the installed copy — it has merged version/update metadata.
        // Fall back to marketplace row for not-yet-installed plugins.
        const fromInstalled = state.installedPlugins.find(
          (p) => p.name === d.data.name,
        );
        const fromMP = state.marketplaces
          .flatMap((m) => m.plugins)
          .find((p) => p.name === d.data.name);
        const resolved = fromInstalled || fromMP;
        if (resolved) {
          set({
            detail: { kind: "plugin", data: resolved, drift: d.drift },
            detailPlugin: resolved,
          });
        } else {
          set({ detail: null, detailPlugin: null });
        }
        return;
      }
      case "file": {
        const fresh = state.files.find((f) => f.name === d.data.name);
        set({ detail: fresh ? { kind: "file", data: fresh } : null });
        return;
      }
      case "skill": {
        const fresh = state.standaloneSkills.find((s) => s.name === d.data.name);
        set({ detail: fresh ? { kind: "skill", data: fresh } : null });
        return;
      }
      case "namespace": {
        const fresh = groupSkillsByNamespace(state.standaloneSkills).find(
          (n) => n.name === d.data.name
        );
        set({ detail: fresh ? { kind: "namespace", data: fresh } : null });
        return;
      }
      case "piPackage": {
        const fresh = state.piPackages.find(
          (p) => p.name === d.data.name && p.marketplace === d.data.marketplace,
        );
        if (fresh) {
          set({ detail: { kind: "piPackage", data: fresh }, detailPiPackage: fresh });
        } else {
          set({ detail: null, detailPiPackage: null });
        }
        return;
      }
    }
  },
  setDetailPiPackage: async (pkg) => {
    if (!pkg) {
      set({ detailPiPackage: null, detail: null });
      return;
    }

    // Set immediately so UI shows something. Mirror into unified `detail`.
    set({ detailPiPackage: pkg, detail: { kind: "piPackage", data: pkg } });

    // Fetch full details for npm packages
    if (pkg.sourceType === "npm") {
      const details = await fetchNpmPackageDetails(pkg.source);
      if (details) {
        // Merge details into the package (both mirrors)
        set((state) => {
          if (state.detailPiPackage?.source !== pkg.source) return {};
          const merged = { ...state.detailPiPackage, ...details };
          return {
            detailPiPackage: merged,
            detail: { kind: "piPackage", data: merged },
          };
        });
      }
    }
  },
  setCurrentSection: (section) => set({ currentSection: section }),
  setDiscoverSubView: (subView) => set({ discoverSubView: subView }),
  toggleSyncSelection: (key: string) =>
    set((state) => {
      const has = state.syncSelection.includes(key);
      const next = has
        ? state.syncSelection.filter((k) => k !== key)
        : [...state.syncSelection, key];
      return { syncSelection: next, syncArmed: false };
    }),
  setSyncArmed: (armed: boolean) => set({ syncArmed: armed }),
  setPluginDriftMap: (map) => set({ pluginDriftMap: map }),

  notify: (message, type = "info", options) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification: Notification = { id, message, type, timestamp: Date.now(), spinner: options?.spinner };
    set((state) => ({ notifications: [...state.notifications, notification] }));
    return id;
  },

  clearNotification: (id) => {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }));
  },

  loadTools: () => {
    set({ tools: getToolInstances(), managedTools: getManagedToolRows() });
  },

  refreshManagedTools: () => {
    set({ managedTools: getManagedToolRows() });
  },

  refreshToolDetection: async () => {
    const packageManager = getPackageManager();
    const entries = Object.values(TOOL_REGISTRY);
    const initialPending: Record<string, boolean> = {};
    for (const entry of entries) {
      initialPending[entry.toolId] = true;
    }

    set({ toolDetectionPending: initialPending });

    const nextDetection: Record<string, ToolDetectionResult> = {};
    const nextPending: Record<string, boolean> = {};

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const result = await detectTool(entry, packageManager);
          nextDetection[entry.toolId] = result;
          nextPending[entry.toolId] = false;
        } catch (error) {
          nextDetection[entry.toolId] = {
            toolId: entry.toolId,
            installed: false,
            binaryPath: null,
            installedVersion: null,
            latestVersion: null,
            hasUpdate: false,
            error: error instanceof Error ? error.message : String(error),
          };
          nextPending[entry.toolId] = false;
        }
      })
    );

    set((state) => ({
      toolDetection: { ...state.toolDetection, ...nextDetection },
      toolDetectionPending: { ...state.toolDetectionPending, ...nextPending },
    }));
  },

  installToolAction: async (toolId, options) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const onProgress = (event: ProgressEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
        return;
      }
      if (event.type === "error") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
        return;
      }
      if (event.type === "timeout") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
        return;
      }
      if (event.type === "cancelled") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
      }
    };

    const packageManager = getPackageManager();
    const mismatch = await detectInstallMethodMismatch(toolId, packageManager, before?.binaryPath);
    if (mismatch) {
      set((state) => ({
        toolActionOutput: appendToolOutput(state.toolActionOutput, mismatch.message),
      }));
    }

    const shouldMigrate = options?.migrate === true;
    const success = shouldMigrate
      ? await reinstallTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal })
      : await installTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal });

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    if (success && !after?.installed) {
      notify(
        `Install command succeeded but tool is still not detected in PATH (${after?.binaryPath || "no binary path"}).`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool installed successfully." : "Tool install failed.", success ? "success" : "error");
    return success;
  },

  updateToolAction: async (toolId, options) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const onProgress = (event: ProgressEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
        return;
      }
      if (event.type === "error") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
        return;
      }
      if (event.type === "timeout") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
        return;
      }
      if (event.type === "cancelled") {
        set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
      }
    };

    const packageManager = getPackageManager();
    const mismatch = await detectInstallMethodMismatch(toolId, packageManager, before?.binaryPath);
    if (mismatch) {
      set((state) => ({
        toolActionOutput: appendToolOutput(state.toolActionOutput, mismatch.message),
      }));
    }

    const shouldMigrate = options?.migrate === true;
    const success = shouldMigrate
      ? await reinstallTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal })
      : await updateTool(toolId, packageManager, onProgress, { signal: toolActionAbortController.signal });

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    const ineffectiveUpdate = Boolean(
      success &&
      after?.installed &&
      after.hasUpdate &&
      after.installedVersion === before?.installedVersion
    );

    if (ineffectiveUpdate || (!success && mismatch && !shouldMigrate)) {
      const migrationNote = getToolRegistryEntry(toolId)?.lifecycle?.migration_note;
      notify(
        `Update did not complete cleanly for the active binary (${after?.binaryPath || before?.binaryPath || "unknown path"}). ${migrationNote || "If install methods differ, retry and press m in the action modal to migrate methods."}`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool updated successfully." : "Tool update failed.", success ? "success" : "error");
    return success;
  },

  uninstallToolAction: async (toolId) => {
    const { notify } = get();
    if (get().toolActionInProgress) {
      notify("Another tool action is already running.", "warning");
      return false;
    }

    const before = get().toolDetection[toolId];

    toolActionAbortController = new AbortController();
    set({ toolActionInProgress: toolId, toolActionOutput: [] });

    const packageManager = getPackageManager();
    const detectedInstallMethod = detectInstallMethodFromPath(before?.binaryPath);
    const success = await uninstallTool(
      toolId,
      packageManager,
      (event: ProgressEvent) => {
        if (event.type === "stdout" || event.type === "stderr") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.data) }));
          return;
        }
        if (event.type === "error") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, event.message) }));
          return;
        }
        if (event.type === "timeout") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, `Timed out after ${event.timeoutMs}ms`) }));
          return;
        }
        if (event.type === "cancelled") {
          set((state) => ({ toolActionOutput: appendToolOutput(state.toolActionOutput, "Cancelled by user") }));
        }
      },
      { signal: toolActionAbortController.signal, detectedInstallMethod }
    );

    toolActionAbortController = null;
    set({ toolActionInProgress: null });
    await get().refreshToolDetection();

    const after = get().toolDetection[toolId];
    if (success && after?.installed) {
      notify(
        `Uninstall command completed but binary is still detected at ${after.binaryPath || "unknown path"}.`,
        "warning"
      );
      return false;
    }

    notify(success ? "Tool uninstalled successfully." : "Tool uninstall failed.", success ? "success" : "error");
    return success;
  },

  cancelToolAction: () => {
    if (toolActionAbortController) {
      toolActionAbortController.abort();
      toolActionAbortController = null;
    }
  },

  loadPiPackages: async (options) => {
    const silent = options?.silent === true;
    if (!silent && !get().piPackagesLoaded) set({ piPackagesLoaded: false });

    // Load Pi packages only when Pi is enabled in config or detected as installed.
    const tools = get().tools;
    const piEnabled = tools.some((t) => t.toolId === "pi" && t.enabled);
    const piInstalled = get().toolDetection.pi?.installed === true;
    if (!piEnabled && !piInstalled) {
      const state = get();
      set({
        piPackages: [],
        piPackagesLoaded: true,
        piMarketplaces: [],
        managedItems: composeManagedItems(state.installedPlugins, state.files, []),
      });
      return;
    }

    try {
      const marketplaces = await loadAllPiMarketplaces();
      const preferredManager = getPackageManager();
      let packages: PiPackage[] = getAllPiPackages(marketplaces).map((pkg) => ({ ...pkg, preferredManager }));

      const settings = loadPiSettings();
      const installInfo = getGlobalPiPackageInstallInfo();
      const desiredSpecs = loadDesiredPiPackageSpecs();
      const desiredBySource = new Map(
        desiredSpecs.map((spec) => [normalizePiPackageSource(spec.source), spec]),
      );

      packages = packages.map((pkg) => {
        const desired = desiredBySource.get(normalizePiPackageSource(pkg.source));
        if (!desired) return pkg;
        return {
          ...pkg,
          name: desired.name ?? pkg.name,
          description: desired.description ?? pkg.description,
          marketplace: desired.marketplace ?? pkg.marketplace,
          recommended: true,
        };
      });

      const existingSources = new Set(
        packages.map((p) => normalizePiPackageSource(p.source)),
      );

      // Add repo-prescribed packages that aren't in any marketplace or local scan.
      for (const spec of desiredSpecs) {
        const normalizedSource = normalizePiPackageSource(spec.source);
        if (existingSources.has(normalizedSource)) continue;
        const pkg = await createPiPackageFromSpec(spec, preferredManager, settings, installInfo);
        packages.push(pkg);
        existingSources.add(normalizedSource);
      }

      // Add installed packages that aren't in any marketplace or desired list.
      for (const source of settings.packages) {
        const normalizedSource = normalizePiPackageSource(source);
        if (existingSources.has(normalizedSource)) continue;

        const sourceType = getSourceType(source);
        if (sourceType === "npm") {
          // Fetch package details from npm when possible.
          const pkgName = source.slice(4);
          const details = await fetchNpmPackageDetails(pkgName);
          if (!details) continue;

          const detected = installInfo.get(pkgName);
          const installedVersion = detected?.version ?? undefined;
          const latestVersion = details.version ?? "0.0.0";

          const pkg: PiPackage = {
            name: details.name ?? pkgName,
            description: details.description ?? "",
            version: latestVersion,
            source,
            sourceType: "npm",
            marketplace: "npm",
            installed: true,
            installedVersion,
            hasUpdate: Boolean(installedVersion && installedVersion !== latestVersion),
            installedVia: detected?.via,
            installedViaManagers: detected?.viaManagers,
            managerMismatch: Boolean(detected?.managerMismatch),
            preferredManager,
            extensions: details.extensions ?? [],
            skills: details.skills ?? [],
            prompts: details.prompts ?? [],
            themes: details.themes ?? [],
            homepage: details.homepage,
            repository: details.repository,
            author: details.author,
            license: details.license,
          };
          packages.push(pkg);
          existingSources.add(normalizedSource);
          continue;
        }

        // Include installed git/local packages even when they are not marketplace-listed.
        packages.push({
          name: inferPackageNameFromSource(source),
          description: "Installed Pi package",
          version: "0.0.0",
          source,
          sourceType,
          marketplace: sourceType,
          installed: true,
          preferredManager,
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        });
        existingSources.add(normalizedSource);
      }

      const state = get();
      set({
        piPackages: packages,
        piPackagesLoaded: true,
        piMarketplaces: marketplaces,
        managedItems: composeManagedItems(state.installedPlugins, state.files, packages),
      });
    } catch (error) {
      console.error("Failed to load Pi packages:", error);
      const state = get();
      set({
        piPackages: [],
        piPackagesLoaded: true,
        piMarketplaces: [],
        managedItems: composeManagedItems(state.installedPlugins, state.files, []),
      });
    }
  },

  installPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const result = await withSpinner(`Installing ${pkg.name}...`, () => installPiPackage(pkg), notify, clearNotification);
      if (result.success) { notify(`Installed ${pkg.name}`, "success"); await get().loadPiPackages({ silent: true }); return true; }
      notify(`Failed to install ${pkg.name}: ${result.error}`, "error");
    } catch (error) { notify(`Error installing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  uninstallPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const result = await withSpinner(`Uninstalling ${pkg.name}...`, () => removePiPackage(pkg), notify, clearNotification);
      if (result.success) { notify(`Uninstalled ${pkg.name}`, "success"); await get().loadPiPackages({ silent: true }); return true; }
      notify(`Failed to uninstall ${pkg.name}: ${result.error}`, "error");
    } catch (error) { notify(`Error uninstalling ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  deletePiPackageEverywhere: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const configResult = loadYamlConfig();
      if (configResult.errors.length > 0) {
        notify(`Config load failed: ${configResult.errors[0].message}`, "error");
        return false;
      }

      const localDelete = removePiPackageSpec(pkg.source, configResult.config.pi_packages);
      const sourceConfigPath = getSourceRepoBlackbookConfigPath(configResult.config);
      const shouldUpdateSourceConfig = Boolean(
        sourceConfigPath &&
        sourceConfigPath !== configResult.configPath &&
        existsSync(sourceConfigPath),
      );
      const sourceConfigResult = shouldUpdateSourceConfig ? loadYamlConfig(sourceConfigPath!) : null;
      if (sourceConfigResult && sourceConfigResult.errors.length > 0) {
        notify(`Source config load failed: ${sourceConfigResult.errors[0].message}`, "error");
        return false;
      }
      const sourceDelete = sourceConfigResult
        ? removePiPackageSpec(pkg.source, sourceConfigResult.config.pi_packages)
        : { specs: [], removed: false };

      let localRemoved = false;
      if (pkg.installed) {
        const result = await withSpinner(`Deleting ${pkg.name} everywhere...`, () => removePiPackage(pkg), notify, clearNotification);
        if (!result.success) {
          notify(`Delete failed for ${pkg.name}: ${result.error}`, "error");
          return false;
        }
        localRemoved = true;
      }

      if (localDelete.removed) {
        saveYamlConfig({
          ...configResult.config,
          pi_packages: localDelete.specs,
        }, configResult.configPath);
      }

      if (sourceConfigResult && sourceDelete.removed) {
        saveYamlConfig({
          ...sourceConfigResult.config,
          pi_packages: sourceDelete.specs,
        }, sourceConfigResult.configPath);
      }

      await get().loadPiPackages({ silent: true });
      set({ detail: null, detailPiPackage: null });

      const parts: string[] = [];
      if (localRemoved) parts.push("local install");
      if (localDelete.removed) parts.push("config.yaml prescription");
      if (sourceDelete.removed) parts.push("source repo config");
      notify(`Deleted ${pkg.name}: ${parts.join(", ") || "nothing to remove"}`, "info");
      return true;
    } catch (error) {
      notify(`Delete failed for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  updatePiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    try {
      const beforeInstalledVersion = pkg.installedVersion;
      const result = await withSpinner(`Updating ${pkg.name}...`, () => updatePiPackage(pkg), notify, clearNotification);
      if (!result.success) {
        notify(`Failed to update ${pkg.name}: ${result.error}`, "error");
        return false;
      }

      await get().loadPiPackages({ silent: true });

      const refreshed = get().piPackages.find((p) =>
        p.source === pkg.source ||
        (p.name === pkg.name && p.marketplace === pkg.marketplace)
      );

      if (!refreshed) {
        notify(`Update command completed for ${pkg.name}, but refreshed package status could not be found.`, "warning");
        return false;
      }

      // For npm packages, verify effective update after refresh instead of trusting exit code.
      if (refreshed.sourceType === "npm") {
        const versionChanged = Boolean(beforeInstalledVersion && refreshed.installedVersion && refreshed.installedVersion !== beforeInstalledVersion);
        const updateCleared = refreshed.hasUpdate === false;
        if (!versionChanged && !updateCleared) {
          notify(
            `Update command completed for ${pkg.name}, but it still appears out of date (installed ${refreshed.installedVersion || "unknown"}, latest ${refreshed.version || "unknown"}).`,
            "warning"
          );
          return false;
        }
      }

      const from = beforeInstalledVersion || "unknown";
      const to = refreshed.installedVersion || refreshed.version || "unknown";
      notify(`Updated ${pkg.name} (${from} → ${to})`, "success");
      return true;
    } catch (error) { notify(`Error updating ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return false;
  },

  removePiPackageFromGit: async (pkg) => {
    const { notify } = get();
    const configResult = loadYamlConfig();
    if (configResult.errors.length > 0) {
      notify(`Config load failed: ${configResult.errors[0].message}`, "error");
      return false;
    }
    const localDelete = removePiPackageSpec(pkg.source, configResult.config.pi_packages);
    const sourceConfigPath = getSourceRepoBlackbookConfigPath(configResult.config);
    const shouldUpdateSource = Boolean(
      sourceConfigPath && sourceConfigPath !== configResult.configPath && existsSync(sourceConfigPath),
    );
    const sourceConfigResult = shouldUpdateSource ? loadYamlConfig(sourceConfigPath!) : null;
    const sourceDelete = sourceConfigResult
      ? removePiPackageSpec(pkg.source, sourceConfigResult.config.pi_packages)
      : { specs: [], removed: false };

    if (localDelete.removed) {
      saveYamlConfig({ ...configResult.config, pi_packages: localDelete.specs }, configResult.configPath);
    }
    if (sourceConfigResult && sourceDelete.removed) {
      saveYamlConfig({ ...sourceConfigResult.config, pi_packages: sourceDelete.specs }, sourceConfigResult.configPath);
    }

    // Auto-commit and push the source repo config change.
    if (sourceConfigPath && sourceDelete.removed && existsSync(join(dirname(sourceConfigPath), "..", "..", "..", ".git"))) {
      const sourceRepo = sourceConfigPath.replace(/\/config\/blackbook\/config\.yaml$/, "");
      if (existsSync(join(sourceRepo, ".git"))) {
        try {
          execFileSync("git", ["-C", sourceRepo, "add", sourceConfigPath], { encoding: "utf-8", timeout: 10000 });
          execFileSync("git", ["-C", sourceRepo, "commit", "-m", `remove: ${pkg.name} Pi package from git`], { encoding: "utf-8", timeout: 10000 });
          execFileSync("git", ["-C", sourceRepo, "push"], { encoding: "utf-8", timeout: 30000 });
        } catch { /* git failure non-fatal */ }
      }
    }

    await get().loadPiPackages({ silent: true });
    get().refreshDetail();

    const parts: string[] = [];
    if (localDelete.removed) parts.push("config.yaml");
    if (sourceDelete.removed) parts.push("source repo config");
    notify(
      `Removed ${pkg.name} from git: ${parts.join(", ") || "not found in config"}`,
      parts.length > 0 ? "info" : "warning",
    );
    return true;
  },

  trackPiPackageInSource: async (pkg) => {
    const { notify } = get();
    const result = loadYamlConfig();
    if (result.errors.length > 0) {
      notify(`Config load failed: ${result.errors[0].message}`, "error");
      return false;
    }

    const exists = result.config.pi_packages.some((entry) => entry.source.toLowerCase() === pkg.source.toLowerCase());
    if (exists) {
      notify(`${pkg.name} is already in git`, "info");
      return true;
    }

    saveYamlConfig({
      ...result.config,
      pi_packages: [
        ...result.config.pi_packages,
        {
          source: pkg.source,
          name: pkg.name,
          description: pkg.description || undefined,
          marketplace: pkg.marketplace || undefined,
        },
      ],
    }, result.configPath);

    await get().loadPiPackages({ silent: true });
    get().refreshDetail();
    notify(`Tracked ${pkg.name} in source repo`, "success");
    return true;
  },

  repairPiPackage: async (pkg) => {
    const { notify, clearNotification } = get();
    const preferred = getPackageManager();
    const from = pkg.installedVia;

    if (pkg.sourceType !== "npm") {
      notify(`Repair is only supported for npm packages (${pkg.name})`, "warning");
      return false;
    }
    if (!from) {
      notify(`Couldn't determine current install manager for ${pkg.name}`, "warning");
      return false;
    }

    try {
      const result = await withSpinner(
        `Repairing ${pkg.name} (${from} → ${preferred})...`,
        () => repairPiPackageManager(pkg, { from, to: preferred }),
        notify,
        clearNotification,
      );
      if (!result.success) {
        notify(`Failed to repair ${pkg.name}: ${result.error}`, "error");
        return false;
      }

      await get().loadPiPackages({ silent: true });
      const refreshed = get().piPackages.find((p) =>
        p.source === pkg.source ||
        (p.name === pkg.name && p.marketplace === pkg.marketplace)
      );
      if (!refreshed) {
        notify(`Repaired ${pkg.name}, but refreshed package status could not be found.`, "warning");
        return false;
      }

      if (refreshed.managerMismatch) {
        notify(`Repair completed for ${pkg.name}, but install manager mismatch remains.`, "warning");
        return false;
      }

      notify(`Repaired ${pkg.name} (${from} → ${preferred})`, "success");
      return true;
    } catch (error) {
      notify(`Error repairing ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  },

  togglePiMarketplaceEnabled: async (name) => {
    const { piMarketplaces, notify } = get();
    const marketplace = piMarketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const newEnabled = !marketplace.enabled;
    setPiMarketplaceEnabled(name, newEnabled);
    notify(`${name} Pi marketplace ${newEnabled ? "enabled" : "disabled"}`, "info");
    await get().loadPiPackages();
  },

  addPiMarketplace: async (name, source) => {
    const { notify } = get();
    const existing = get().piMarketplaces.find((m) => m.name === name);
    if (existing) {
      notify(`Pi marketplace "${name}" already exists`, "error");
      return;
    }
    addPiMarketplaceToConfig(name, source);
    notify(`Added Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },

  removePiMarketplace: async (name) => {
    const { notify } = get();
    removePiMarketplaceFromConfig(name);
    notify(`Removed Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },

  loadMarketplaces: async () => {
    invalidatePluginToolStatusCache();

    try {
      const marketplaces = parseMarketplaces();
      const tools = getToolInstances();

      // STEP 1: Fetch all marketplaces FIRST (get plugin metadata with skill names)
      const enrichedMarketplaces: Marketplace[] = await Promise.all(
        marketplaces.map(async (m) => {
          // Skip fetching plugins for disabled marketplaces
          if (!m.enabled) {
            return {
              ...m,
              plugins: [],
              availableCount: 0,
              installedCount: 0,
            };
          }
          
          const plugins = await fetchMarketplace(m);

          return {
            ...m,
            plugins: plugins.map((p) => ({
              ...p,
              installed: false, // Will be updated after scanning
            })),
            availableCount: plugins.length,
            installedCount: 0, // Will be updated after scanning
            updatedAt: new Date(),
          };
        })
      );

      // STEP 2: Extract all marketplace plugins for skill matching
      const allMarketplacePlugins = enrichedMarketplaces.flatMap((m) => m.plugins);

      // STEP 3: Scan installed plugins. Keep entries from removed marketplaces
      // so the UX can show them as orphaned instead of leaking their components
      // into standalone skills without explanation.
      const configuredMarketplaceNames = new Set(marketplaces.map((m) => m.name));
      const { plugins: scannedPlugins } = getAllInstalledPlugins();
      const configuredInstalledPlugins = scannedPlugins.filter((p) => configuredMarketplaceNames.has(p.marketplace));

      // STEP 4: Update marketplace installed counts and status
      const updatedMarketplaces = enrichedMarketplaces.map((m) => {
        const pluginsWithStatus = m.plugins.map((p) => ({
          ...p,
          ...getInstallStatus(p, configuredInstalledPlugins.some((ip) => ip.name === p.name)),
        }));
        return {
          ...m,
          plugins: pluginsWithStatus,
          installedCount: pluginsWithStatus.filter((p) => p.installed).length,
        };
      });

      // STEP 5: Build installed plugin list from both scanned install records
      // and marketplace-prescribed plugins whose components are present on disk.
      const installedWithStatus = buildInstalledPlugins(scannedPlugins, allMarketplacePlugins, configuredMarketplaceNames);

      const state = get();
      set({
        marketplaces: updatedMarketplaces,
        installedPlugins: installedWithStatus,
        installedPluginsLoaded: true,
        tools,
        managedTools: getManagedToolRows(),
        managedItems: composeManagedItems(installedWithStatus, state.files, state.piPackages),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadInstalledPlugins: async (options) => {
    invalidatePluginToolStatusCache();
    const silent = options?.silent === true;
    if (!silent && !get().installedPluginsLoaded) set({ installedPluginsLoaded: false });

    // Installed-plugin classification depends on marketplace prescriptions
    // (latest version + component names). If the user refreshes Installed before
    // visiting Discover/Marketplaces, load that metadata first instead of
    // classifying from stale installed-cache components alone.
    if (get().marketplaces.length === 0 || get().marketplaces.every((m) => m.plugins.length === 0)) {
      await get().loadMarketplaces();
    }

    const { plugins: allInstalled } = getAllInstalledPlugins();
    // Prefer store state when present so a marketplace refresh and an installed-plugin
    // refresh operate over the same marketplace set. Keep orphaned installed plugins
    // in the installed list with explicit status badges.
    const configuredNames = new Set(
      (get().marketplaces.length > 0 ? get().marketplaces : parseMarketplaces()).map((m) => m.name),
    );
    const configuredInstalled = allInstalled.filter((p) => configuredNames.has(p.marketplace));
    const marketplaces = get().marketplaces.map((m) => {
      const pluginsWithStatus = m.plugins.map((p) => ({
        ...p,
        ...getInstallStatus(p, configuredInstalled.some((ip) => ip.name === p.name)),
      }));
      return {
        ...m,
        plugins: pluginsWithStatus,
        installedCount: pluginsWithStatus.filter((p) => p.installed).length,
      };
    });
    const allMarketplacePlugins = marketplaces.flatMap((m) => m.plugins);
    const installedWithStatus = buildInstalledPlugins(allInstalled, allMarketplacePlugins, configuredNames);

    // For standalone-skill ownership, build a combined set from BOTH old installed
    // names and latest marketplace names so deployed artifacts under either naming
    // scheme are attributed to the plugin, not leaked as standalone.
    const ownershipPlugins = installedWithStatus.map((p) => {
      const mp = newestMarketplacePluginFor(p, allMarketplacePlugins);
      if (!mp) return p;
      return { ...p, skills: uniqueStrings(p.skills, mp.skills) };
    });

    const state = get();
    set({
      installedPlugins: installedWithStatus,
      installedPluginsLoaded: true,
      standaloneSkills: getStandaloneSkills(ownershipPlugins),
      marketplaces,
      tools: getToolInstances(),
      managedTools: getManagedToolRows(),
      managedItems: composeManagedItems(installedWithStatus, state.files, state.piPackages),
    });
  },

  loadFiles: async (options) => {
    const silent = options?.silent === true;
    if (!silent && !get().filesLoaded) set({ filesLoaded: false });

    // Only load files when YAML config exists
    const configPath = getYamlConfigPath();
    if (!configPath || !configPath.endsWith(".yaml")) {
      const state = get();
      set({
        files: [],
        filesLoaded: true,
        managedItems: composeManagedItems(state.installedPlugins, [], state.piPackages),
      });
      return [];
    }

    const configResult = loadYamlConfig(configPath);
    if (configResult.errors.length > 0) {
      const state = get();
      set({
        files: [],
        filesLoaded: true,
        managedItems: composeManagedItems(state.installedPlugins, [], state.piPackages),
      });
      return [];
    }

    const config = configResult.config;
    const configManagementEnabled = config.settings.config_management;

    const playbooks = getAllPlaybooks();
    const toolInstances = resolveToolInstances(config, playbooks);
    const sourceRepo = config.settings.source_repo
      ? expandConfigPath(config.settings.source_repo)
      : null;

    // Back-compat: if YAML doesn't specify source_repo, infer config/assets repos
    // from the legacy config to keep relative sources working.
    const legacyConfigRepo = getConfigRepoPath();
    const legacyAssetsRepo = getAssetsRepoPath();
    const effectiveRepo = sourceRepo || legacyAssetsRepo || undefined;

    const files: FileStatus[] = [];
    const coveredTargets = new Set<string>(); // "toolId:instanceId:targetRelPath"
    let checkCounter = 0;

    // Load files from config — ALL are files, always shown.
    // tools: field just scopes which tool instances the file targets.
    // Configs come ONLY from playbook config_files (injected below).
    for (const fileEntry of config.files) {
      const fileStatus: FileStatus = {
        name: fileEntry.name,
        source: fileEntry.source,
        target: fileEntry.target,
        tools: fileEntry.tools,
        instances: [],
        kind: "file",
      };

      // Determine which tool instances this file targets
      const targetToolIds = fileEntry.tools
        ? fileEntry.tools.filter((t) => isSyncTarget(t, playbooks))
        : [...toolInstances.keys()].filter((t) => isSyncTarget(t, playbooks));

      for (const toolId of targetToolIds) {
        const instances = toolInstances.get(toolId) || [];
        for (const inst of instances) {
          if (!inst.enabled) continue;

          const instanceConfigDir = expandConfigPath(inst.config_dir);
          const targetOverride = fileEntry.overrides?.[`${toolId}:${inst.id}`];
          const targetRelPath = targetOverride || fileEntry.target;

          const sourcePath = resolveSourcePath(fileEntry.source, effectiveRepo);
          const targetPath = `${instanceConfigDir}/${targetRelPath}`;

          // Build orchestrator step and run check
          const stateKey = buildStateKey(fileEntry.name, toolId, inst.id, targetRelPath);
          const steps: OrchestratorStep[] = [{
            label: `${fileEntry.name}:${toolId}:${inst.id}`,
            module: getSyncModule(sourcePath) as any,
            params: {
              sourcePath,
              targetPath,
              owner: `file:${fileEntry.name}`,
              stateKey,
              backupRetention: config.settings.backup_retention,
            },
          }];

          const result = await runCheck(steps);
          const stepResult = result.steps[0];

          checkCounter++;
          if (checkCounter % 5 === 0) await yieldToEventLoop();

          fileStatus.instances.push({
            toolId,
            instanceId: inst.id,
            instanceName: inst.name,
            configDir: instanceConfigDir,
            targetRelPath,
            sourcePath,
            targetPath,
            status: stepResult.check.status,
            message: stepResult.check.message,
            diff: stepResult.check.diff,
            driftKind: stepResult.check.driftKind,
          });
          coveredTargets.add(`${toolId}:${inst.id}:${targetRelPath}`);

          // Directory sync (target ".") covers all files in the tool's config dir,
          // including playbook-declared config_files. Mark them as covered so
          // auto-inject doesn't duplicate them.
          if (targetRelPath === ".") {
            const playbook = playbooks.get(toolId);
            if (playbook?.config_files) {
              for (const cf of playbook.config_files) {
                coveredTargets.add(`${toolId}:${inst.id}:${cf.path}`);
              }
            }
          }
        }
      }

      files.push(fileStatus);
    }

    // Load configs (tool-specific settings) only if config_management is enabled
    if (configManagementEnabled) {
      for (const configEntry of config.configs) {
        const fileStatus: FileStatus = {
          name: configEntry.name,
          source: configEntry.source,
          target: configEntry.target,
          tools: configEntry.tools,
          instances: [],
          kind: "config",
        };

        // Determine which tool instances this config targets
        const targetToolIds = configEntry.tools
          ? configEntry.tools.filter((t) => isSyncTarget(t, playbooks))
          : [...toolInstances.keys()].filter((t) => isSyncTarget(t, playbooks));

        for (const toolId of targetToolIds) {
          const instances = toolInstances.get(toolId) || [];
          for (const inst of instances) {
            if (!inst.enabled) continue;

            const instanceConfigDir = expandConfigPath(inst.config_dir);
            const targetOverride = configEntry.overrides?.[`${toolId}:${inst.id}`];
            const targetRelPath = targetOverride || configEntry.target;

            const sourcePath = resolveSourcePath(configEntry.source, effectiveRepo);
            const targetPath = `${instanceConfigDir}/${targetRelPath}`;

            // Build orchestrator step and run check
            const stateKey = buildStateKey(configEntry.name, toolId, inst.id, targetRelPath);
            const steps: OrchestratorStep[] = [{
              label: `${configEntry.name}:${toolId}:${inst.id}`,
              module: getSyncModule(sourcePath) as any,
              params: {
                sourcePath,
                targetPath,
                owner: `config:${configEntry.name}`,
                stateKey,
                backupRetention: config.settings.backup_retention,
              },
            }];

            const result = await runCheck(steps);
            const stepResult = result.steps[0];

            checkCounter++;
            if (checkCounter % 5 === 0) await yieldToEventLoop();

            fileStatus.instances.push({
              toolId,
              instanceId: inst.id,
              instanceName: inst.name,
              configDir: instanceConfigDir,
              targetRelPath,
              sourcePath,
              targetPath,
              status: stepResult.check.status,
              message: stepResult.check.message,
              diff: stepResult.check.diff,
              driftKind: stepResult.check.driftKind,
            });
            coveredTargets.add(`${toolId}:${inst.id}:${targetRelPath}`);

            // Directory sync (target ".") covers all files in the tool's config dir,
            // including playbook-declared config_files. Mark them as covered so
            // auto-inject doesn't duplicate them.
            if (targetRelPath === ".") {
              const playbook = playbooks.get(toolId);
              if (playbook?.config_files) {
                for (const cf of playbook.config_files) {
                  coveredTargets.add(`${toolId}:${inst.id}:${cf.path}`);
                }
              }
            }
          }
        }

        if (fileStatus.instances.length > 0) {
          files.push(fileStatus);
        }
      }
    }

    // Auto-inject playbook-declared config files not covered by explicit entries
    // Only when config_management is enabled
    if (configManagementEnabled) {
      for (const [toolId, playbook] of playbooks) {
        if (!playbook.config_files || playbook.config_files.length === 0) continue;
        if (!isSyncTarget(toolId, playbooks)) continue;

        const instances = toolInstances.get(toolId) || [];
        const enabledInstances = instances.filter((i) => i.enabled);
        if (enabledInstances.length === 0) continue;

        for (const configFile of playbook.config_files) {
          const uncoveredInstances = enabledInstances.filter(
            (inst) => !coveredTargets.has(`${toolId}:${inst.id}:${configFile.path}`)
          );
          if (uncoveredInstances.length === 0) continue;

          const conventionalSource = `config/${toolId}/${configFile.path}`;
          const sourcePath = resolveSourcePath(conventionalSource, effectiveRepo);

          const fileStatus: FileStatus = {
            name: configFile.name,
            source: conventionalSource,
            target: configFile.path,
            tools: [toolId],
            instances: [],
            kind: "config",
          };

          for (const inst of uncoveredInstances) {
            const instanceConfigDir = expandConfigPath(inst.config_dir);
            const targetPath = `${instanceConfigDir}/${configFile.path}`;
            const stateKey = buildStateKey(configFile.name, toolId, inst.id, configFile.path);
            const steps: OrchestratorStep[] = [{
              label: `${configFile.name}:${toolId}:${inst.id}`,
              module: getSyncModule(sourcePath) as any,
              params: {
                sourcePath,
                targetPath,
                owner: `file:${configFile.name}`,
                stateKey,
                backupRetention: config.settings.backup_retention,
              },
            }];

            const result = await runCheck(steps);
            const stepResult = result.steps[0];

            checkCounter++;
            if (checkCounter % 5 === 0) await yieldToEventLoop();

            fileStatus.instances.push({
              toolId,
              instanceId: inst.id,
              instanceName: inst.name,
              configDir: instanceConfigDir,
              targetRelPath: configFile.path,
              sourcePath,
              targetPath,
              status: stepResult.check.status,
              message: stepResult.check.message,
              diff: stepResult.check.diff,
              driftKind: stepResult.check.driftKind,
            });
          }

          if (fileStatus.instances.length > 0) {
            files.push(fileStatus);
          }
        }
      }
    }

    // Attach git status to each file by checking its source path in the source repo.
    if (effectiveRepo) {
      const { getRepoGitStatus, gitStatusForPath } = await import("./install.js");
      const repoStatus = getRepoGitStatus(effectiveRepo);
      for (const f of files) {
        const firstInst = f.instances[0];
        if (firstInst?.sourcePath) {
          f.gitStatus = gitStatusForPath(effectiveRepo, firstInst.sourcePath, repoStatus);
        }
      }
    }

    const state = get();
    set({
      files,
      filesLoaded: true,
      managedItems: composeManagedItems(state.installedPlugins, files, state.piPackages),
    });
    return files;
  },

  refreshAll: async (options) => {
    invalidatePluginToolStatusCache();
    const silent = options?.silent === true;
    clearSourceStatusCache();
    await get().loadMarketplaces();
    await get().loadInstalledPlugins({ silent });
    await get().refreshToolDetection();
    await get().loadPiPackages({ silent });
    await get().loadFiles({ silent });
    get().refreshManagedTools();
    get().refreshDetail();
  },

  installPlugin: async (plugin) => {
    invalidatePluginToolStatusCache();
    const { notify, clearNotification } = get();
    const marketplace = get().marketplaces.find((m) => m.name === plugin.marketplace);
    if (!marketplace) { notify(`Marketplace not found for ${plugin.name}`, "error"); return false; }
    const result = await withSpinner(`Installing ${plugin.name}...`,
      () => installPlugin(plugin, marketplace.url), notify, clearNotification);
    
    if (result.success) {
      await get().refreshAll({ silent: true });
      
      const parts: string[] = [];
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Installed ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
      } else {
        notify(`⚠ Install ran but no items linked for ${plugin.name}`, "error");
      }
    } else {
      notify(`✗ Failed to install ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  uninstallPlugin: async (plugin) => {
    invalidatePluginToolStatusCache();
    const { notify, clearNotification } = get();
    const enabledInstances = getEnabledToolInstances();
    if (enabledInstances.length === 0) { notify("No tools enabled in config.", "error"); return false; }
    const success = await withSpinner(`Uninstalling ${plugin.name}...`, () => uninstallPlugin(plugin), notify, clearNotification);
    await get().refreshAll({ silent: true });
    notify(success ? `✓ Uninstalled ${plugin.name}` : `✓ Removed ${plugin.name} from other tools`, "success");
    return success;
  },

  updatePlugin: async (plugin) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    notify(`Updating ${plugin.name}...`, "info");
    const result = await updatePlugin(plugin, marketplace.url);
    
    if (result.success) {
      await get().refreshAll({ silent: true });
      get().refreshDetail();
      
      const parts: string[] = [];
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Updated ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
      } else {
        notify(`✓ Updated ${plugin.name}`, "success");
      }
    } else {
      notify(`✗ Failed to update ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  removePluginFromGit: async (plugin) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured.", "error");
      return false;
    }
    const pluginDir = join(sourceRepo, "plugins", plugin.name);
    const marketplacePath = join(sourceRepo, ".claude-plugin", "marketplace.json");
    const commitPaths: string[] = [];
    if (existsSync(pluginDir)) {
      try {
        rmSync(pluginDir, { recursive: true, force: true });
        commitPaths.push(pluginDir);
      } catch (e) {
        notify(`Failed to remove plugin dir: ${e instanceof Error ? e.message : String(e)}`, "error");
        return false;
      }
    }
    removeFromSourceRepoMarketplace(sourceRepo, plugin.name);
    if (existsSync(marketplacePath)) commitPaths.push(marketplacePath);
    if (commitPaths.length > 0 && existsSync(join(sourceRepo, ".git"))) {
      try {
        for (const p of commitPaths) {
          execFileSync("git", ["-C", sourceRepo, "add", p], { encoding: "utf-8", timeout: 10000 });
        }
        execFileSync("git", ["-C", sourceRepo, "commit", "-m", `remove: ${plugin.name} from git`], { encoding: "utf-8", timeout: 10000 });
        execFileSync("git", ["-C", sourceRepo, "push"], { encoding: "utf-8", timeout: 30000 });
      } catch { /* git failure non-fatal */ }
    }
    await get().refreshAll({ silent: true });
    notify(`Removed ${plugin.name} from git`, "info");
    return true;
  },

  trackPluginInSource: async (plugin) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured.", "error");
      return false;
    }
    if (typeof plugin.source !== "string" || !existsSync(plugin.source)) {
      notify(`No recoverable source found for ${plugin.name}.`, "error");
      return false;
    }

    const destDir = join(sourceRepo, "plugins", plugin.name);
    try {
      if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
      mkdirSync(dirname(destDir), { recursive: true });
      cpSync(plugin.source, destDir, { recursive: true });
      ensurePluginJson(destDir, plugin);
      upsertSourceRepoMarketplacePlugin(sourceRepo, plugin);
    } catch (error) {
      notify(`Failed to track ${plugin.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }

    await get().refreshAll({ silent: true });
    get().refreshDetail();
    notify(`Tracked ${plugin.name} in source repo`, "success");
    return true;
  },

  toggleToolEnabled: async (toolId, instanceId) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    const configuredFromState = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const configuredTool = configuredFromState || (getToolInstances() || []).find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const managedTool = get().managedTools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    if (!configuredTool && !managedTool) {
      notify(`Unknown tool instance: ${toolId}:${instanceId}`, "error");
      return;
    }

    const displayName = configuredTool?.name || managedTool?.displayName || `${toolId}:${instanceId}`;
    const currentEnabled = configuredTool?.enabled ?? managedTool?.enabled ?? false;
    const currentConfigDir = configuredTool?.configDir || managedTool?.configDir;

    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: displayName,
      configDir: currentConfigDir,
      enabled: !currentEnabled,
    });
    await get().refreshAll({ silent: true });
    notify(`${displayName} ${currentEnabled ? "disabled" : "enabled"}`, "success");
  },

  updateToolConfigDir: async (toolId, instanceId, configDir) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    const trimmed = configDir.trim();
    if (!trimmed) {
      notify("Config directory cannot be empty.", "error");
      return;
    }

    const configuredFromState = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const configuredTool = configuredFromState || (getToolInstances() || []).find((t) => t.toolId === toolId && t.instanceId === instanceId);
    const managedTool = get().managedTools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    updateToolInstanceConfig(toolId, instanceId, {
      id: instanceId,
      name: configuredTool?.name || managedTool?.displayName,
      configDir: trimmed,
      enabled: configuredTool?.enabled ?? managedTool?.enabled,
    });
    await get().refreshAll({ silent: true });
    notify(`Updated ${(configuredTool?.name || managedTool?.displayName) ?? `${toolId}:${instanceId}`} config_dir`, "success");
  },

  getSyncPreview: () => {
    const { plugins: installedPlugins } = getAllInstalledPlugins();
    const allMarketplacePlugins = get().marketplaces.flatMap((m) => m.plugins);

    // Use marketplace plugin for accurate component lists (skills, commands, agents)
    // Scanned plugins may have incomplete component lists if only partially installed
    const pluginsForSync = installedPlugins.map((scanned) => {
      const marketplace = allMarketplacePlugins.find((mp) => mp.name === scanned.name);
      return marketplace || scanned; // Prefer marketplace, fallback to scanned for local-only
    });

    const files = get().files;
    const toolSync = buildToolSyncPreview(get().managedTools, get().toolDetection);
    const standaloneSkills = get().standaloneSkills;
    const toolInstances = getToolInstances();
    return [
      ...toolSync,
      ...buildFileSyncPreview(files),
      ...buildSkillSyncPreview(standaloneSkills, toolInstances),
      ...buildPiPackageSyncPreview(get().piPackages),
      ...buildSyncPreview(pluginsForSync),
    ];
  },

  syncTools: async (items) => {
    invalidatePluginToolStatusCache();
    const { notify } = get();
    if (items.length === 0) {
      notify("All enabled instances are in sync.", "success");
      return;
    }

    const marketplaces = get().marketplaces;
    notify(`Syncing ${items.length} items...`, "info");

    const errors: string[] = [];
    let syncedItems = 0;

    for (const item of items) {
      if (item.kind === "plugin") {
        const marketplaceUrl = marketplaces.find((m) => m.name === item.plugin.marketplace)?.url;
        const statuses = getPluginToolStatus(item.plugin)
          .filter((status) => status.enabled && status.supported && !status.installed);
        if (statuses.length === 0) continue;

        const result = await syncPluginInstances(item.plugin, marketplaceUrl, statuses);
        if (result.success) syncedItems += 1;
        errors.push(...result.errors);
      } else if (item.kind === "file") {
        // Build orchestrator steps for non-ok instances
        const configResult = loadYamlConfig();
        if (configResult.errors.length > 0) {
          errors.push(`Config load failed: ${configResult.errors[0].message}`);
          continue;
        }

        // Only forward-sync instances (skip conflicts and pullback targets unless forceBothChanged)
        const forceBothChanged = item.forceBothChanged ?? false;
        const steps: OrchestratorStep[] = item.file.instances
          .filter((i) => {
            if (i.status !== "missing" && i.status !== "drifted") return false;
            // Allow both-changed instances when forceBothChanged is true
            if (i.driftKind === "both-changed" && forceBothChanged) return true;
            // Skip both-changed and target-changed by default (conflicts and pullback targets)
            if (i.driftKind === "both-changed" || i.driftKind === "target-changed") return false;
            return true;
          })
          .map((i) => {
            const sourcePath = i.sourcePath;
            const targetPath = i.targetPath;
            const stateKey = buildStateKey(item.file.name, i.toolId, i.instanceId, i.targetRelPath);
            return {
              label: `${item.file.name}:${i.toolId}:${i.instanceId}`,
              module: getSyncModule(sourcePath) as any,
              params: { sourcePath, targetPath, owner: `file:${item.file.name}`, stateKey, backupRetention: configResult.config.settings.backup_retention },
            };
          });

        if (steps.length > 0) {
          const result = await runApply(steps);
          if (result.summary.changed > 0) syncedItems += 1;
          for (const step of result.steps) {
            if (step.apply?.error) errors.push(step.apply.error);
          }
        }
      } else if (item.kind === "piPackage") {
        const success = await get().installPiPackage(item.piPackage);
        if (success) {
          syncedItems += 1;
        } else {
          errors.push(`Failed to install ${item.piPackage.name}`);
        }
      } else if (item.kind === "tool") {
        const success = await get().updateToolAction(item.toolId);
        if (success) {
          syncedItems += 1;
        } else {
          errors.push(`Failed to update ${item.name}`);
        }
      } else if (item.kind === "skill") {
        // Sync the skill to every missing+drifted tool. installSkillToInstance
        // overwrites the disk copy with the source-repo version.
        const { installSkillToInstance } = await import("./install.js");
        const installedKeys = new Set(
          item.skill.installations.map((i) => `${i.toolId}:${i.instanceId}`),
        );
        const toolInstances = getToolInstances().filter(
          (i) => i.kind === "tool" && i.enabled && !!i.skillsSubdir,
        );
        let any = false;
        for (const inst of toolInstances) {
          const key = `${inst.toolId}:${inst.instanceId}`;
          const isMissing = !installedKeys.has(key);
          const installation = item.skill.installations.find(
            (i) => i.toolId === inst.toolId && i.instanceId === inst.instanceId,
          );
          const isDrifted = installation?.drifted === true;
          if (!isMissing && !isDrifted) continue;
          if (installSkillToInstance(item.skill, inst.toolId, inst.instanceId)) any = true;
          else errors.push(`Failed to sync ${item.skill.name} to ${inst.name}`);
        }
        if (any) syncedItems += 1;
      }
    }

    if (syncedItems > 0) {
      notify(`✓ Synced ${syncedItems} items`, "success");
    }
    if (errors.length > 0) {
      notify(`⚠ Sync completed with errors: ${errors.slice(0, 3).join("; ")}`, "error");
    }

    // Refresh only what's needed - files for file syncs, plugins for plugin syncs
    // Don't do a full refreshAll which is slow
    const hadFiles = items.some((item) => item.kind === "file");
    const hadPlugins = items.some((item) => item.kind === "plugin");
    const hadPiPackages = items.some((item) => item.kind === "piPackage");
    const hadSkills = items.some((item) => item.kind === "skill");

    if (hadFiles) {
      await get().loadFiles({ silent: true });
    }
    if (hadPlugins || hadSkills) {
      await get().loadInstalledPlugins({ silent: true });
    }
    if (hadPiPackages) {
      await get().loadPiPackages({ silent: true });
    }

    get().refreshDetail();
  },

  addMarketplace: (name, url) => {
    const { notify } = get();
    const marketplaces = get().marketplaces;
    if (marketplaces.some((m) => m.name === name)) {
      notify(`Marketplace "${name}" already exists`, "error");
      return;
    }

    // Save to config file
    addMarketplaceToConfig(name, url);

    // Update state
    set({
      marketplaces: [
        ...marketplaces,
        {
          name,
          url,
          isLocal:
            url.startsWith("/") ||
            url.startsWith("~") ||
            url.startsWith("./") ||
            url.startsWith("../") ||
            url.startsWith("file://"),
          plugins: [],
          availableCount: 0,
          installedCount: 0,
          autoUpdate: false,
          source: "blackbook",
          enabled: true,
        },
      ],
    });
    
    notify(`Added marketplace "${name}"`, "success");
    
    // Fetch plugins for the new marketplace
    get()
      .updateMarketplace(name)
      .catch((error) => {
        notify(
          `Added marketplace "${name}" but failed to fetch plugins: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      });
  },

  removeMarketplace: async (name) => {
    const { notify } = get();
    const marketplace = get().marketplaces.find((m) => m.name === name);

    try {
      // For Claude-discovered marketplaces, run the native Claude CLI command to
      // remove it from known_marketplaces.json on every Claude instance.
      if (marketplace?.source === "claude") {
        await removeClaudeMarketplace(name);
      }

      // Remove from Blackbook config (no-op if it wasn't user-added).
      removeMarketplaceFromConfig(name);

      set({
        marketplaces: get().marketplaces.filter((m) => m.name !== name),
      });

      notify(`Removed marketplace "${name}"`, "success");
    } catch (error) {
      notify(
        `Failed to remove marketplace "${name}": ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  },

  updateMarketplace: async (name) => {
    const { notify, clearNotification } = get();
    const marketplace = get().marketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const loadingId = notify(`Updating marketplace \"${name}\"...`, "info", { spinner: true });
    try {
      const plugins = await fetchMarketplace(marketplace, { forceRefresh: true });
      const installedPlugins = get().installedPlugins;

      set({
        marketplaces: get().marketplaces.map((m) => {
          if (m.name !== name) return m;
          const pluginsWithStatus = plugins.map((p) => ({
            ...p,
            ...getInstallStatus(p, installedPlugins.some((ip) => ip.name === p.name)),
          }));
          return {
            ...m,
            plugins: pluginsWithStatus,
            availableCount: plugins.length,
            installedCount: pluginsWithStatus.filter((p) => p.installed).length,
            updatedAt: new Date(),
          };
        }),
      });

      notify(`Updated marketplace \"${name}\" (${plugins.length} plugin${plugins.length === 1 ? "" : "s"})`, "success");
    } catch (error) {
      notify(`Failed to update marketplace \"${name}\": ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      clearNotification(loadingId);
    }
  },

  toggleMarketplaceEnabled: async (name) => {
    const { marketplaces, notify } = get();
    const marketplace = marketplaces.find((m) => m.name === name);
    if (!marketplace) return;
    
    const newEnabled = !marketplace.enabled;
    setMarketplaceEnabled(name, newEnabled);
    notify(`${name} marketplace ${newEnabled ? "enabled" : "disabled"}`, "info");
    await get().loadMarketplaces();
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Diff view actions
  // ─────────────────────────────────────────────────────────────────────────────

  openDiffForFile: (file, instance) => {
    const driftedInstances = file.instances.filter((i) => i.status === "drifted");
    if (driftedInstances.length === 0) {
      get().notify("No drifted instances found for this file.", "warning");
      return;
    }

    const picked =
      instance
        ? driftedInstances.find(
            (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
          ) || driftedInstances[0]
        : driftedInstances[0];

    const targetInstance: DiffInstanceRef = instance || {
      toolId: picked.toolId,
      instanceId: picked.instanceId,
      instanceName: picked.instanceName,
      configDir: picked.configDir,
    };

    const diffTarget = buildFileDiffTarget(
      file.name,
      picked.targetRelPath,
      picked.sourcePath,
      picked.targetPath,
      targetInstance,
    );

    set({
      diffTarget,
      missingSummary: null,
    });
  },

  openMissingSummaryForFile: (file, instance) => {
    const missingInstances = file.instances.filter((i) => i.status === "missing");
    if (missingInstances.length === 0) {
      get().notify("No missing instances found for this file.", "warning");
      return;
    }

    const picked =
      instance
        ? missingInstances.find(
            (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
          ) || missingInstances[0]
        : missingInstances[0];

    const targetInstance: DiffInstanceRef = instance || {
      toolId: picked.toolId,
      instanceId: picked.instanceId,
      instanceName: picked.instanceName,
      configDir: picked.configDir,
    };

    const missingSummary = buildFileMissingSummary(
      file.name,
      picked.targetRelPath,
      picked.sourcePath,
      picked.targetPath,
      targetInstance,
    );

    set({
      missingSummary,
      diffTarget: null,
    });
  },

  openDiffFromSyncItem: (item) => {
    if (item.kind === "plugin") {
      get().notify("Plugins do not support drift diff.", "warning");
      return;
    }

    if (item.kind === "tool") {
      get().notify("Tool updates do not have a diff view.", "warning");
      return;
    }

    if (item.kind === "skill") {
      const driftedInst = item.skill.installations.find((i) => i.drifted);
      if (!driftedInst) {
        get().notify("No drifted instance found for this skill.", "warning");
        return;
      }
      const diffTarget = buildSkillDiffTarget(item.skill, driftedInst.toolId, driftedInst.instanceId);
      if (!diffTarget) {
        get().notify("Skill has no source repo path to diff against.", "warning");
        return;
      }
      set({ diffTarget });
      return;
    }

    if (item.kind === "file") {
      const drifted = item.file.instances.filter((i) => i.status === "drifted");
      const missing = item.file.instances.filter((i) => i.status === "missing");

      if (drifted.length > 0) {
        get().openDiffForFile(item.file);
        return;
      }
      if (missing.length > 0) {
        get().openMissingSummaryForFile(item.file);
        return;
      }

      get().notify("No diff or missing summary available for this file.", "warning");
      return;
    }
  },

  closeDiff: () => {
    set({ diffTarget: null });
  },

  closeMissingSummary: () => {
    set({ missingSummary: null });
  },

  pullbackFileInstance: async (file, instance) => {
    const { notify } = get();
    const picked = file.instances.find(
      (i) => i.toolId === instance.toolId && i.instanceId === instance.instanceId,
    );
    if (!picked) {
      notify(`Unknown instance: ${instance.toolId}:${instance.instanceId}`, "error");
      return false;
    }

    try {
      const stateKey = buildStateKey(file.name, picked.toolId, picked.instanceId, picked.targetRelPath);
      const configResult = loadYamlConfig();
      const backupRetention = configResult.errors.length === 0
        ? configResult.config.settings.backup_retention
        : undefined;

      // Glob sources cannot be pulled back by swapping paths (the destination is a pattern).
      // Instead, let glob-copy interpret pullback=true as target→source.
      const isGlob = isGlobPath(picked.sourcePath);

      const step: OrchestratorStep = isGlob
        ? {
            label: `pullback:${file.name}:${picked.toolId}:${picked.instanceId}`,
            module: globCopyModule as any,
            params: {
              sourcePath: picked.sourcePath,
              targetPath: picked.targetPath,
              owner: `file:${file.name}`,
              pullback: true,
              backupRetention,
            },
          }
        : {
            label: `pullback:${file.name}:${picked.toolId}:${picked.instanceId}`,
            module: getSyncModule(picked.targetPath) as any,
            params: {
              sourcePath: picked.targetPath,
              targetPath: picked.sourcePath,
              owner: `file:${file.name}`,
              stateKey,
              pullback: true,
              backupRetention,
            },
          };

      notify(`Pulling ${file.name} from ${picked.instanceName}...`, "info");
      const result = await runApply([step]);
      const hadError = result.steps.some((s) => s.apply?.error);
      if (hadError) {
        const msg = result.steps.find((s) => s.apply?.error)?.apply?.error;
        notify(`Pull failed: ${msg || "unknown error"}`, "error");
        await get().refreshAll({ silent: true });
        return false;
      }

      notify(`✓ Pulled ${file.name} from ${picked.instanceName}`, "success");
      await get().refreshAll({ silent: true });
      return true;
    } catch (error) {
      notify(`Pull failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      await get().refreshAll({ silent: true });
      return false;
    }
  },
  };
});

let watchersStarted = false;
let refreshTimer: NodeJS.Timeout | null = null;

function scheduleRefresh(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refresh().catch((error) => {
      notify(`Failed to refresh after file change: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, 250);
}

function startFileWatchers(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (watchersStarted) return;
  watchersStarted = true;

  const configPath = getConfigPath();
  const cacheDir = getCacheDir();
  const manifestFile = manifestPath();

  try {
    if (existsSync(configPath)) {
      watch(configPath, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch config file: ${error instanceof Error ? error.message : String(error)}`, "error");
  }

  try {
    if (existsSync(cacheDir)) {
      watch(cacheDir, { persistent: false }, (event, filename) => {
        if (filename && filename.toString() === "installed_items.json") {
          scheduleRefresh(refresh, notify);
        }
      });
    } else if (existsSync(manifestFile)) {
      watch(manifestFile, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch cache directory: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

export async function initializeStore(): Promise<void> {
  ensureConfigExists();
  // Pull source repo before any data loads so skills/files reflect the latest.
  await pullSourceRepo();
  // Prime source repo status cache during startup so Settings tab renders immediately.
  void primeSourceRepoStatus();
}
