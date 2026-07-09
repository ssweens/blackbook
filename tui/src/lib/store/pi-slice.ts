import { existsSync } from "fs";
import type { PiPackage, PiPackageSpec } from "../types.js";
import {
  loadAllPiMarketplaces,
  getAllPiPackages,
  loadPiSettings,
  isPackageInstalled,
  fetchNpmPackageDetails,
  getGlobalPiPackageInstallInfo,
  getSourceType,
  normalizePiPackageSource,
  resetFetchErrors,
  getFetchErrors,
} from "../marketplace.js";
import { installPiPackage, removePiPackage, updatePiPackage, repairPiPackageManager } from "../pi-install.js";
import {
  getPackageManager,
  setPiMarketplaceEnabled,
  addPiMarketplace as addPiMarketplaceToConfig,
  removePiMarketplace as removePiMarketplaceFromConfig,
} from "../config.js";
import { loadConfig as loadYamlConfig } from "../config/loader.js";
import { saveConfig as saveYamlConfig } from "../config/writer.js";
import {
  getSourceRepoBlackbookConfigPath,
  isRemoteSourceRepo,
  prepareWritableSourceRepoConfig,
  removePiPackageSpec,
  commitAndPushWritableSourceRepo,
  invalidateSourceRepoPiPackagesCache,
  loadDesiredPiPackageSpecs,
  type SourceRepoConfigLoad,
} from "../source-repo-config.js";
import { composeManagedItems, withSpinner } from "./shared.js";
import type { Store, SliceCreator } from "./types.js";

// Monotonic run-token guards loadPiPackages against stale overwrites. A slow
// loader call (network) can resolve AFTER a newer call already wrote fresh
// state — the older call's set() would then clobber the newer data.
let loadPiPackagesRunToken = 0;

function inferPackageNameFromSource(source: string): string {
  const trimmed = source.trim().replace(/\/$/, "");
  if (trimmed.startsWith("npm:")) return trimmed.slice(4);
  if (trimmed.startsWith("git:")) return inferPackageNameFromSource(trimmed.slice(4));

  // Strip trailing @version or #ref suffix (e.g. repo@1.0.3, repo#main)
  const withoutRefOrVersion = trimmed.replace(/[@#][^/]*$/, "");
  const withoutGit = withoutRefOrVersion.replace(/\.git$/, "");

  // For filesystem paths, use the final path segment.
  if (withoutGit.startsWith("/") || withoutGit.startsWith("./") || withoutGit.startsWith("../")) {
    const parts = withoutGit.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? withoutGit;
  }

  const match = withoutGit.match(/([^/@:]+\/[^/@:]+|[^/@:]+)$/);
  return match ? match[1] : withoutGit;
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

export type PiSlice = Pick<
  Store,
  // state
  | "piPackages"
  | "piPackagesLoaded"
  | "piMarketplaces"
  // actions
  | "loadPiPackages"
  | "installPiPackage"
  | "uninstallPiPackage"
  | "updatePiPackage"
  | "repairPiPackage"
  | "trackPiPackageInSource"
  | "removePiPackageFromGit"
  | "deletePiPackageEverywhere"
  | "togglePiMarketplaceEnabled"
  | "addPiMarketplace"
  | "removePiMarketplace"
>;

export const createPiSlice: SliceCreator<PiSlice> = (set, get) => ({
  piPackages: [],
  piPackagesLoaded: false,
  piMarketplaces: [],

  loadPiPackages: async (options) => {
    const runToken = ++loadPiPackagesRunToken;
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
      // Clear prior fetch errors so an offline npm/git marketplace is
      // distinguishable from a genuinely empty package list below.
      resetFetchErrors();
      const marketplaces = await loadAllPiMarketplaces();
      const preferredManager = getPackageManager();
      let packages: PiPackage[] = getAllPiPackages(marketplaces).map((pkg) => ({ ...pkg, preferredManager }));

      const settings = loadPiSettings();
      const installInfo = getGlobalPiPackageInstallInfo();
      const desiredSpecs = await loadDesiredPiPackageSpecs();
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

      // Add repo-prescribed packages that aren't in any marketplace or local scan — in parallel.
      const newDesiredSpecs = desiredSpecs.filter((spec) => !existingSources.has(normalizePiPackageSource(spec.source)));
      const newDesiredPkgs = await Promise.all(
        newDesiredSpecs.map((spec) => createPiPackageFromSpec(spec, preferredManager, settings, installInfo)),
      );
      for (let i = 0; i < newDesiredPkgs.length; i++) {
        packages.push(newDesiredPkgs[i]);
        existingSources.add(normalizePiPackageSource(newDesiredSpecs[i].source));
      }

      // Add installed packages that aren't in any marketplace or desired list — in parallel.
      // `settings.packages` (~/.pi/agent/settings.json, Pi's own state — not ours) can
      // itself contain the same source listed more than once (observed in the wild); dedupe
      // by normalized source so a single duplicated entry there doesn't produce two rows
      // with an identical React key downstream.
      const seenUnlistedSources = new Set<string>();
      const unlistedSources = settings.packages.filter((source) => {
        const normalized = normalizePiPackageSource(source);
        if (existingSources.has(normalized) || seenUnlistedSources.has(normalized)) return false;
        seenUnlistedSources.add(normalized);
        return true;
      });

      const unlistedResults = await Promise.all(
        unlistedSources.map(async (source) => {
          const sourceType = getSourceType(source);
          if (sourceType === "npm") {
            const pkgName = source.slice(4);
            const details = await fetchNpmPackageDetails(pkgName);
            if (!details) return null;
            const detected = installInfo.get(pkgName);
            const installedVersion = detected?.version ?? undefined;
            const latestVersion = details.version ?? "0.0.0";
            return {
              source,
              pkg: {
                name: details.name ?? pkgName,
                description: details.description ?? "",
                version: latestVersion,
                source,
                sourceType: "npm" as const,
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
              } satisfies PiPackage,
            };
          }
          // git/local packages — no network call needed.
          return {
            source,
            pkg: {
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
            } satisfies PiPackage,
          };
        }),
      );

      for (const result of unlistedResults) {
        if (!result) continue;
        packages.push(result.pkg);
        existingSources.add(normalizePiPackageSource(result.source));
      }

      // A newer loadPiPackages call has started while our awaits were in flight;
      // let it own the final state rather than overwriting it with our staler scan.
      if (runToken !== loadPiPackagesRunToken) return;
      const state = get();
      set({
        piPackages: packages,
        piPackagesLoaded: true,
        piMarketplaces: marketplaces,
        managedItems: composeManagedItems(state.installedPlugins, state.files, packages),
      });

      // Surface fetch failures distinctly (unless caller asked for silence) so
      // an offline registry doesn't look like "no packages available".
      const errors = getFetchErrors();
      if (errors.length > 0 && !silent) {
        const summary = errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
        get().notify(`Failed to fetch Pi packages: ${summary}`, "error");
      }
    } catch (error) {
      console.error("Failed to load Pi packages:", error);
      if (runToken !== loadPiPackagesRunToken) return;
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

      const sourceConfigPath = getSourceRepoBlackbookConfigPath(configResult.config);
      const shouldUpdateSourceConfig = Boolean(
        sourceConfigPath &&
        sourceConfigPath !== configResult.configPath &&
        existsSync(sourceConfigPath),
      );
      let sourceConfigResult = shouldUpdateSourceConfig ? loadYamlConfig(sourceConfigPath!) : null;
      let remoteWritable: SourceRepoConfigLoad | null = null;
      if (!sourceConfigResult && configResult.config.settings.source_repo && isRemoteSourceRepo(configResult.config.settings.source_repo)) {
        try {
          remoteWritable = await prepareWritableSourceRepoConfig(configResult.config);
          if (remoteWritable) {
            sourceConfigResult = { config: remoteWritable.config, configPath: remoteWritable.configPath, errors: [] } as ReturnType<typeof loadYamlConfig>;
          }
        } catch (error) {
          notify(`Source repo write prep failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          return false;
        }
      }
      if (!sourceConfigResult || sourceConfigResult.errors.length > 0) {
        notify(`Source config load failed: ${sourceConfigResult?.errors[0]?.message ?? "missing source repo config"}`, "error");
        return false;
      }
      const sourceDelete = removePiPackageSpec(pkg.source, sourceConfigResult.config.pi_packages);

      let localRemoved = false;
      if (pkg.installed) {
        const result = await withSpinner(`Deleting ${pkg.name} everywhere...`, () => removePiPackage(pkg), notify, clearNotification);
        if (!result.success) {
          notify(`Delete failed for ${pkg.name}: ${result.error}`, "error");
          return false;
        }
        localRemoved = true;
      }

      if (sourceDelete.removed) {
        saveYamlConfig({
          ...sourceConfigResult.config,
          pi_packages: sourceDelete.specs,
        }, sourceConfigResult.configPath);
        if (remoteWritable?.isRemote) {
          await commitAndPushWritableSourceRepo(sourceConfigResult.configPath, `remove: ${pkg.name} Pi package from git`);
          invalidateSourceRepoPiPackagesCache(configResult.config.settings.source_repo || "");
        }
      }

      await get().loadPiPackages({ silent: true });
      set({ detail: null, detailPiPackage: null });

      const parts: string[] = [];
      if (localRemoved) parts.push("local install");
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
    const sourceConfigPath = getSourceRepoBlackbookConfigPath(configResult.config);
    const shouldUpdateSource = Boolean(
      sourceConfigPath && sourceConfigPath !== configResult.configPath && existsSync(sourceConfigPath),
    );
    let sourceConfigResult = shouldUpdateSource ? loadYamlConfig(sourceConfigPath!) : null;
    let remoteWritable: SourceRepoConfigLoad | null = null;
    if (!sourceConfigResult && configResult.config.settings.source_repo && isRemoteSourceRepo(configResult.config.settings.source_repo)) {
      remoteWritable = await prepareWritableSourceRepoConfig(configResult.config);
      if (remoteWritable) {
        sourceConfigResult = { config: remoteWritable.config, configPath: remoteWritable.configPath, errors: [] } as ReturnType<typeof loadYamlConfig>;
      }
    }
    if (!sourceConfigResult) {
      notify(`Removed ${pkg.name} from git: source repo config not available`, "warning");
      return true;
    }

    const sourceDelete = removePiPackageSpec(pkg.source, sourceConfigResult.config.pi_packages);

    if (sourceDelete.removed) {
      saveYamlConfig({ ...sourceConfigResult.config, pi_packages: sourceDelete.specs }, sourceConfigResult.configPath);
      try {
        await commitAndPushWritableSourceRepo(sourceConfigResult.configPath, `remove: ${pkg.name} Pi package from git`);
        invalidateSourceRepoPiPackagesCache(configResult.config.settings.source_repo || "");
      } catch { /* git failure non-fatal */ }
    }

    await get().loadPiPackages({ silent: true });
    get().refreshDetail();

    const parts: string[] = [];
    if (sourceDelete.removed) parts.push("source repo config");
    notify(
      `Removed ${pkg.name} from git: ${parts.join(", ") || "not found in source repo config"}`,
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

    const sourceKey = normalizePiPackageSource(pkg.source);

    const writable = result.config.settings.source_repo
      ? await prepareWritableSourceRepoConfig(result.config)
      : null;

    if (!writable) {
      notify(`Source repo not configured for tracking ${pkg.name}`, "error");
      return false;
    }

    let sourceAdded = false;
    const sourceExists = writable.config.pi_packages.some(
      (entry) => normalizePiPackageSource(entry.source) === sourceKey,
    );
    if (!sourceExists) {
      saveYamlConfig({
        ...writable.config,
        pi_packages: [
          ...writable.config.pi_packages,
          {
            source: pkg.source,
            name: pkg.name,
            description: pkg.description || undefined,
            marketplace: pkg.marketplace || undefined,
          },
        ],
      }, writable.configPath);
      if (writable.isRemote) {
        await commitAndPushWritableSourceRepo(writable.configPath, `track: ${pkg.name} Pi package in git`);
        invalidateSourceRepoPiPackagesCache(result.config.settings.source_repo || "");
      }
      sourceAdded = true;
    }

    if (!sourceAdded) {
      notify(`${pkg.name} is already in git`, "info");
      return true;
    }

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
    try {
      setPiMarketplaceEnabled(name, newEnabled);
    } catch (error) {
      notify(`Failed to update "${name}": ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
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
    try {
      addPiMarketplaceToConfig(name, source);
    } catch (error) {
      notify(`Failed to add Pi marketplace "${name}": ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    notify(`Added Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },

  removePiMarketplace: async (name) => {
    const { notify } = get();
    try {
      removePiMarketplaceFromConfig(name);
    } catch (error) {
      notify(`Failed to remove Pi marketplace "${name}": ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    notify(`Removed Pi marketplace "${name}"`, "success");
    await get().loadPiPackages();
  },
});
