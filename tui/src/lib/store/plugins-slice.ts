import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { atomicWriteFileSync } from "../fs-utils.js";
import { safePath } from "../validation.js";
import type { Plugin } from "../types.js";
import { fetchMarketplace, resetFetchErrors, getFetchErrors } from "../marketplace.js";
import {
  parseMarketplaces,
  addMarketplace as addMarketplaceToConfig,
  removeMarketplace as removeMarketplaceFromConfig,
  getEnabledToolInstances,
  getToolInstances,
  setMarketplaceEnabled,
  getConfigRepoPath,
} from "../config.js";
import { clearSourceStatusCache } from "../source-setup.js";
import {
  getAllInstalledPlugins,
  getStandaloneSkills,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  removeClaudeMarketplace,
} from "../install.js";
import { invalidatePluginToolStatusCache } from "../plugin-status.js";
import { getManagedToolRows } from "../tool-view.js";
import {
  getInstallStatus,
  buildInstalledPlugins,
  newestMarketplacePluginFor,
  uniqueStrings,
} from "../plugin-merge.js";
import { composeManagedItems, withSpinner, pluginActionInFlight } from "./shared.js";
import type { Store, SliceCreator } from "./types.js";

const execFileAsync = promisify(execFile);

// Monotonic run-tokens guard the loaders against stale overwrites (see loaders).
let loadMarketplacesRunToken = 0;
let loadInstalledPluginsRunToken = 0;

function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
}

function ensurePluginJson(pluginDir: string, plugin: Plugin): void {
  const pluginJsonPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (existsSync(pluginJsonPath)) return;
  mkdirSync(dirname(pluginJsonPath), { recursive: true });
  atomicWriteFileSync(pluginJsonPath, JSON.stringify({
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
    atomicWriteFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
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
    } catch (error) {
      // An existing-but-unparseable marketplace.json holds the user's real
      // plugin entries. Resetting it to an empty scaffold would silently
      // destroy every other entry, so abort and let the caller surface it
      // rather than overwriting real data with defaults.
      throw new Error(
        `Refusing to overwrite corrupt ${marketplacePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  atomicWriteFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
}

export type PluginsSlice = Pick<
  Store,
  // state
  | "marketplaces"
  | "installedPlugins"
  | "installedPluginsLoaded"
  | "standaloneSkills"
  | "managedItems"
  // actions
  | "loadMarketplaces"
  | "loadInstalledPlugins"
  | "refreshAll"
  | "installPlugin"
  | "uninstallPlugin"
  | "updatePlugin"
  | "removePluginFromGit"
  | "trackPluginInSource"
  | "addMarketplace"
  | "removeMarketplace"
  | "updateMarketplace"
  | "toggleMarketplaceEnabled"
>;

export const createPluginsSlice: SliceCreator<PluginsSlice> = (set, get) => ({
  marketplaces: [],
  installedPlugins: [],
  installedPluginsLoaded: false,
  standaloneSkills: [] as import("../install.js").StandaloneSkill[],
  managedItems: [],

  loadMarketplaces: async () => {
    const runToken = ++loadMarketplacesRunToken;
    invalidatePluginToolStatusCache();

    try {
      const marketplaces = parseMarketplaces();
      const tools = getToolInstances();

      // Clear any prior fetch errors so we can tell "offline" apart from
      // "genuinely empty" after the fetches below complete.
      resetFetchErrors();

      // STEP 1: Fetch all marketplaces FIRST (get plugin metadata with skill names)
      const enrichedMarketplaces = await Promise.all(
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

      // A newer loadMarketplaces call started during our fetches — let it win.
      if (runToken !== loadMarketplacesRunToken) return;
      const state = get();
      set({
        marketplaces: updatedMarketplaces,
        installedPlugins: installedWithStatus,
        installedPluginsLoaded: true,
        tools,
        managedTools: getManagedToolRows(),
        managedItems: composeManagedItems(installedWithStatus, state.files, state.piPackages),
      });

      // Surface fetch failures distinctly from a genuinely empty marketplace so
      // "offline" doesn't silently render as "0 plugins available".
      const errors = getFetchErrors();
      if (errors.length > 0) {
        const summary = errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
        get().notify(`Failed to fetch marketplace data: ${summary}`, "error");
      }
    } catch (e) {
      if (runToken !== loadMarketplacesRunToken) return;
      set({ error: String(e) });
    }
  },

  loadInstalledPlugins: async (options) => {
    const runToken = ++loadInstalledPluginsRunToken;
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

    // A newer loadInstalledPlugins call started (it may have awaited loadMarketplaces
    // above); let it own the final state rather than overwriting with staler data.
    if (runToken !== loadInstalledPluginsRunToken) return;
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
    const { notify, clearNotification } = get();
    if (pluginActionInFlight.has(plugin.name)) {
      notify(`Already installing ${plugin.name}...`, "warning");
      return false;
    }
    pluginActionInFlight.add(plugin.name);
    try {
      invalidatePluginToolStatusCache();
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
    } finally {
      pluginActionInFlight.delete(plugin.name);
    }
  },

  uninstallPlugin: async (plugin) => {
    const { notify, clearNotification } = get();
    if (pluginActionInFlight.has(plugin.name)) {
      notify(`Already uninstalling ${plugin.name}...`, "warning");
      return false;
    }
    pluginActionInFlight.add(plugin.name);
    try {
      invalidatePluginToolStatusCache();
      const enabledInstances = getEnabledToolInstances();
      if (enabledInstances.length === 0) { notify("No tools enabled in config.", "error"); return false; }
      const success = await withSpinner(`Uninstalling ${plugin.name}...`, () => uninstallPlugin(plugin), notify, clearNotification);
      await get().refreshAll({ silent: true });
      // uninstallPlugin() returns false when nothing was removed from any enabled
      // tool (every removal failed, or the plugin wasn't present). Reporting that
      // as a green "success" hides a real failure — surface it as an error instead.
      // Underlying per-tool errors are only logged (install.ts logs via logError),
      // so the message points the user there rather than inventing details.
      if (success) {
        notify(`✓ Uninstalled ${plugin.name}`, "success");
      } else {
        notify(`✗ Failed to uninstall ${plugin.name} — nothing was removed (see logs)`, "error");
      }
      return success;
    } finally {
      pluginActionInFlight.delete(plugin.name);
    }
  },

  updatePlugin: async (plugin) => {
    const { notify } = get();
    if (pluginActionInFlight.has(plugin.name)) {
      notify(`Already updating ${plugin.name}...`, "warning");
      return false;
    }
    pluginActionInFlight.add(plugin.name);
    try {
      invalidatePluginToolStatusCache();
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
    } finally {
      pluginActionInFlight.delete(plugin.name);
    }
  },

  removePluginFromGit: async (plugin) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured.", "error");
      return false;
    }
    // plugin.name originates from marketplace manifest data (potentially from
    // an untrusted source). safePath rejects traversal so a name like "../.."
    // can never resolve outside the repo's plugins/ dir before rmSync runs.
    let pluginDir: string;
    try {
      pluginDir = safePath(join(sourceRepo, "plugins"), plugin.name);
    } catch (e) {
      notify(`Invalid plugin name: ${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    }
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
    let pushError: string | undefined;
    if (commitPaths.length > 0 && existsSync(join(sourceRepo, ".git"))) {
      let committed = false;
      try {
        for (const p of commitPaths) {
          await execFileAsync("git", ["-C", sourceRepo, "add", p], { encoding: "utf-8", timeout: 10000 });
        }
        // Scope the commit to the paths we touched so unrelated local changes
        // in the repo are never swept into it.
        await execFileAsync("git", ["-C", sourceRepo, "commit", "-m", `remove: ${plugin.name} from git`, "--", ...commitPaths], { encoding: "utf-8", timeout: 10000 });
        committed = true;
      } catch { /* commit failed (e.g. nothing to commit) — non-fatal, nothing to push */ }
      if (committed) {
        try {
          await execFileAsync("git", ["-C", sourceRepo, "push"], { encoding: "utf-8", timeout: 30000 });
        } catch (e) {
          // Do NOT swallow: the removal is committed locally but never reached origin.
          pushError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    await get().refreshAll({ silent: true });
    if (pushError) {
      notify(`Removed ${plugin.name} locally, but git push failed: ${pushError}`, "warning");
    } else {
      notify(`Removed ${plugin.name} from git`, "info");
    }
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

    try {
      // Reject path traversal in plugin.name before any destructive rmSync/cpSync.
      const destDir = safePath(join(sourceRepo, "plugins"), plugin.name);
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

  addMarketplace: (name, url) => {
    const { notify } = get();
    const marketplaces = get().marketplaces;
    if (marketplaces.some((m) => m.name === name)) {
      notify(`Marketplace "${name}" already exists`, "error");
      return;
    }

    // Save to config file
    try {
      addMarketplaceToConfig(name, url);
    } catch (error) {
      notify(`Failed to add marketplace "${name}": ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }

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
});
