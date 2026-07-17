import { existsSync, lstatSync, statSync } from "fs";
import type {
  FileStatus,
  SyncPreviewItem,
  DiffInstanceRef,
  PiPackage,
  ManagedToolRow,
  ToolDetectionResult,
} from "../types.js";
import { loadConfig as loadYamlConfig, getConfigPath as getYamlConfigPath } from "../config/loader.js";
import { getToolInstances, getConfigRepoPath, getAssetsRepoPath } from "../config.js";
import { resolveSourcePath, expandPath as expandConfigPath } from "../config/path.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "../config/playbooks.js";
import { runCheck, runApply } from "../modules/orchestrator.js";
import type { OrchestratorStep } from "../modules/orchestrator.js";
import { fileCopyModule } from "../modules/file-copy.js";
import { directorySyncModule } from "../modules/directory-sync.js";
import { globCopyModule } from "../modules/glob-copy.js";
import { buildFileDiffTarget, buildFileMissingSummary, buildSkillDiffTarget } from "../diff.js";
import { buildStateKey } from "../state.js";
import { getAllInstalledPlugins, getPluginToolStatus, syncPluginInstances } from "../install.js";
import { invalidatePluginToolStatusCache } from "../plugin-status.js";
import { composeManagedItems, pluginActionInFlight, SYNC_TOOLS_KEY } from "./shared.js";
import type { Store, SliceCreator } from "./types.js";

/**
 * Yield to the event loop so Ink can process keyboard input between
 * synchronous filesystem checks. Without this, tight loops of fs.existsSync
 * and fs.readFileSync block the event loop for hundreds of milliseconds,
 * making the TUI feel frozen.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// Monotonic run-token guards loadFiles against stale overwrites (see loader).
let loadFilesRunToken = 0;

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

function buildSyncPreview(plugins: import("../types.js").Plugin[]): SyncPreviewItem[] {
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
  skills: import("../install.js").StandaloneSkill[],
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
    // No source match (deleted, or never tracked) but real disk installations
    // exist: unlike a normal not-yet-synced skill, there's nothing to sync FROM,
    // so skip the missing-instance computation entirely and treat every current
    // installation as needing attention — mirrors how a file with a deleted
    // source but a surviving target is always surfaced as drift (never silently
    // dropped), instead of vanishing from the one tab meant to show everything
    // that needs a look. Previously this `continue`d here, unconditionally,
    // making such a skill invisible on the Sync tab (still visible elsewhere,
    // e.g. Installed's "not in git" tag).
    if (!skill.sourcePath) {
      if (skill.installations.length === 0) continue;
      preview.push({
        kind: "skill",
        skill,
        missingInstances: [],
        driftedInstances: skill.installations.map((i) => i.instanceName),
      });
      continue;
    }
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

export type FilesSlice = Pick<
  Store,
  // state
  | "files"
  | "filesLoaded"
  | "diffTarget"
  | "missingSummary"
  // actions
  | "loadFiles"
  | "getSyncPreview"
  | "syncTools"
  | "openDiffForFile"
  | "openMissingSummaryForFile"
  | "openDiffFromSyncItem"
  | "closeDiff"
  | "closeMissingSummary"
  | "pullbackFileInstance"
>;

export const createFilesSlice: SliceCreator<FilesSlice> = (set, get) => ({
  files: [],
  filesLoaded: false,
  diffTarget: null,
  missingSummary: null,

  loadFiles: async (options) => {
    const runToken = ++loadFilesRunToken;
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
      const { getRepoGitStatus, gitStatusForPath } = await import("../install.js");
      const repoStatus = getRepoGitStatus(effectiveRepo);
      for (const f of files) {
        const firstInst = f.instances[0];
        if (firstInst?.sourcePath) {
          f.gitStatus = gitStatusForPath(effectiveRepo, firstInst.sourcePath, repoStatus);
        }
      }
    }

    // A newer loadFiles call started while we were running per-file checks; skip
    // our write so the newer (fresher) scan's state isn't clobbered by ours.
    if (runToken !== loadFilesRunToken) return files;
    const state = get();
    set({
      files,
      filesLoaded: true,
      managedItems: composeManagedItems(state.installedPlugins, files, state.piPackages),
    });
    return files;
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
    // Single-flight guard: a second Enter-press before this batch resolves would
    // otherwise run overlapping syncs, racing file copies and manifest writes.
    if (pluginActionInFlight.has(SYNC_TOOLS_KEY)) {
      notify("A sync is already running...", "warning");
      return;
    }
    pluginActionInFlight.add(SYNC_TOOLS_KEY);
    try {

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

        // Only forward-sync safe instances by default. Risky overwrites run only
        // on an explicit per-item push (forceOverwrite).
        const forceOverwrite = item.forceOverwrite ?? false;
        const steps: OrchestratorStep[] = item.file.instances
          .filter((i) => {
            if (i.status !== "missing" && i.status !== "drifted") return false;
            // "Untracked target": the tool file exists but was never tracked (or
            // state was lost), so a forward sync overwrites content Blackbook
            // didn't place. Treat it like a conflict — gate it behind an explicit
            // push. A never-synced instance whose target is MISSING is a safe new
            // install (status "missing") and is not gated here.
            const untrackedTarget = i.status === "drifted" && i.driftKind === "never-synced";
            // An explicit push overwrites conflicts and untracked targets alike.
            if ((i.driftKind === "both-changed" || untrackedTarget) && forceOverwrite) return true;
            // Skip conflicts and pullback targets by default.
            if (i.driftKind === "both-changed" || i.driftKind === "target-changed") return false;
            if (untrackedTarget) return false;
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
        // Only auto-sync MISSING installations here. Unlike files, skills have
        // no three-way state (no recorded last-synced baseline), so "drifted"
        // is a pure binary source!=disk comparison — there's no way to tell
        // whether the DISK side changed (a local edit worth keeping) from the
        // source side changing, from both. Silently overwriting a drifted
        // instance here risked destroying a real, uncaptured local edit with
        // zero indication (a backup is taken, but nothing tells the user one
        // was needed). A drifted skill still shows up in this list — resolving
        // it is a deliberate action via the skill's own detail view, which
        // already labels itself "(overwrites disk)".
        const { installSkillToInstance } = await import("../install.js");
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
          if (!isMissing) continue;
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
    } finally {
      pluginActionInFlight.delete(SYNC_TOOLS_KEY);
    }
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
      const label = `pullback:${file.name}:${picked.toolId}:${picked.instanceId}`;
      const owner = `file:${file.name}`;
      const syncModule = getSyncModule(picked.sourcePath);

      let step: OrchestratorStep;
      if (isGlob) {
        step = {
          label,
          module: globCopyModule as any,
          params: {
            sourcePath: picked.sourcePath,
            targetPath: picked.targetPath,
            owner,
            pullback: true,
            backupRetention,
          },
        };
      } else if (syncModule === fileCopyModule) {
        // File pullback: keep source/target in canonical orientation (source =
        // repo, target = tool) and let file-copy's pullback mode copy the bytes
        // target→source. This ensures recordSync stores the correct orientation,
        // unlike swapping the paths into a forward apply().
        step = {
          label,
          module: fileCopyModule as any,
          params: {
            sourcePath: picked.sourcePath,
            targetPath: picked.targetPath,
            owner,
            stateKey,
            pullback: true,
            backupRetention,
          },
        };
      } else {
        // Directory pullback: directory-sync has no pullback mode and records no
        // sync state, so we swap the paths to copy tool→repo via its forward
        // apply(). No state orientation concern applies here.
        step = {
          label,
          module: syncModule as any,
          params: {
            sourcePath: picked.targetPath,
            targetPath: picked.sourcePath,
            owner,
            backupRetention,
          },
        };
      }

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
});
