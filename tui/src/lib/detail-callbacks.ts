import { rmSync } from "fs";
import { useStore, withSpinner } from "./store.js";
import { buildSkillDiffTarget } from "./diff.js";
import {
  installSkillToInstance,
  uninstallSkillAllInstances,
  uninstallSkillFromInstance,
  installSkillToAllNonSynced,
  pullbackSkillToSource,
  deleteSkillEverywhere,
  deletePluginEverywhere,
  deleteFileEverywhere,
  removeFileFromGit,
  removeSkillFromGit,
  removeNamespaceFromGit,
  syncNamespaceToAllMissing,
  resyncNamespaceDrifted,
  deleteNamespaceEverywhere,
  uninstallNamespaceAll,
  uninstallNamespaceFromInstance,
  pullbackNamespaceToSource,
  type StandaloneSkill,
} from "./install.js";
import type { DispatchCallbacks } from "./action-dispatch.js";
import type { PluginDrift } from "./plugin-drift.js";
import type { DetailArtifact, Plugin, PiPackage } from "./types.js";

/**
 * Shared mutation runner capturing the repeated shape of the item-detail callbacks:
 * show a spinner while running `fn`, then reload the affected store area.
 *
 * `refresh` selects which store slice to re-read after the mutation:
 *  - "plugins" → loadInstalledPlugins (covers skills/namespaces/plugins)
 *  - "files"   → loadFiles
 * Both reloads are silent (no toast) — matching the pre-refactor behavior.
 */
export async function runMutation(
  label: string,
  fn: () => Promise<void>,
  opts: { refresh: "plugins" | "files" },
): Promise<void> {
  const store = useStore.getState();
  await withSpinner(label, fn, store.notify, store.clearNotification);
  if (opts.refresh === "plugins") {
    await useStore.getState().loadInstalledPlugins({ silent: true });
  } else {
    await useStore.getState().loadFiles({ silent: true });
  }
}

/**
 * Dependencies the factory needs from App — the local closures and store-action
 * references that can't be reconstructed here. `detail` is captured by value at
 * build time (identical to the previous inline object literal, which closed over
 * the same render-time `detail`).
 */
export interface DetailCallbackDeps {
  detail: DetailArtifact | null;
  setDetail: (d: DetailArtifact | null) => void;
  setDetailPluginDrift: (drift: PluginDrift | null) => void;
  closeDetail: () => void;
  openSkillDetail: (skill: StandaloneSkill) => void;
  openDiffForFile: DispatchCallbacks["openDiffForFile"];
  openMissingSummaryForFile: DispatchCallbacks["openMissingSummaryForFile"];
  installPlugin: DispatchCallbacks["installPlugin"];
  uninstallPlugin: DispatchCallbacks["uninstallPlugin"];
  updatePlugin: DispatchCallbacks["updatePlugin"];
  trackPluginInSource: DispatchCallbacks["trackPluginInSource"];
  removePluginFromGit: (plugin: Plugin) => Promise<boolean>;
  installPluginToInstance: DispatchCallbacks["installPluginToInstance"];
  uninstallPluginFromInstance: DispatchCallbacks["uninstallPluginFromInstance"];
  refreshDetailPlugin: DispatchCallbacks["refreshDetailPlugin"];
  syncFiles: DispatchCallbacks["syncFiles"];
  pullbackFileInstance: DispatchCallbacks["pullbackFileInstance"];
  pullbackPluginInstance: DispatchCallbacks["pullbackPluginInstance"];
  installPiPackage: DispatchCallbacks["installPiPackage"];
  uninstallPiPackage: DispatchCallbacks["uninstallPiPackage"];
  updatePiPackage: DispatchCallbacks["updatePiPackage"];
  trackPiPackageInSource: DispatchCallbacks["trackPiPackageInSource"];
  removePiPackageFromGit: (pkg: PiPackage) => Promise<boolean>;
  deletePiPackageEverywhere: DispatchCallbacks["deletePiPackageEverywhere"];
  refreshDetailPiPackage: DispatchCallbacks["refreshDetailPiPackage"];
  buildPluginDiffTarget: DispatchCallbacks["buildPluginDiffTarget"];
}

/**
 * Builds the callback object passed to `handleItemAction` for file / plugin /
 * skill / namespace / pi-package detail actions.
 *
 * Pure relocation of the inline object previously in App.tsx's handleEntityAction —
 * behavior is unchanged. The bulk of the skill/namespace/file mutations share the
 * withSpinner → mutate → reload shape and route through `runMutation`; a few genuine
 * outliers (installSkillToAll, removeRedundantSkillInstallations) keep an explicit
 * implementation because they emit a summary notification *between* the spinner and
 * the reload, an ordering that must be preserved.
 */
export function buildDetailCallbacks(deps: DetailCallbackDeps): DispatchCallbacks {
  const { detail, setDetail, setDetailPluginDrift, closeDetail, openSkillDetail } = deps;

  return {
    // ── Pass-through navigation / plugin / file / pi-package handlers ──
    closeDetail: () => { setDetail(null); closeDetail(); },
    openDiffForFile: deps.openDiffForFile,
    openMissingSummaryForFile: deps.openMissingSummaryForFile,
    setDiffTarget: (target) => useStore.setState({ diffTarget: target }),
    installPlugin: deps.installPlugin,
    uninstallPlugin: deps.uninstallPlugin,
    updatePlugin: deps.updatePlugin,
    trackPluginInSource: deps.trackPluginInSource,
    removePluginFromGit: async (plugin) => {
      await deps.removePluginFromGit(plugin);
    },
    installPluginToInstance: deps.installPluginToInstance,
    uninstallPluginFromInstance: deps.uninstallPluginFromInstance,
    refreshDetailPlugin: deps.refreshDetailPlugin,
    syncFiles: deps.syncFiles,
    pullbackFileInstance: deps.pullbackFileInstance,
    pullbackPluginInstance: deps.pullbackPluginInstance,
    installPiPackage: deps.installPiPackage,
    uninstallPiPackage: deps.uninstallPiPackage,
    updatePiPackage: deps.updatePiPackage,
    trackPiPackageInSource: deps.trackPiPackageInSource,
    removePiPackageFromGit: async (pkg) => {
      await deps.removePiPackageFromGit(pkg);
    },
    deletePiPackageEverywhere: deps.deletePiPackageEverywhere,
    refreshDetailPiPackage: deps.refreshDetailPiPackage,
    buildPluginDiffTarget: deps.buildPluginDiffTarget,

    // ── Skill mutations — wrap with spinner since copies may be slow for large skills. ──
    uninstallSkillAll: (skill) =>
      runMutation(
        `Uninstalling ${skill.name} from all tools...`,
        async () => { uninstallSkillAllInstances(skill); },
        { refresh: "plugins" },
      ),
    uninstallSkillFromInstance: (skill, toolId, instanceId) =>
      runMutation(
        `Uninstalling ${skill.name} from ${toolId}...`,
        async () => { uninstallSkillFromInstance(skill, toolId, instanceId); },
        { refresh: "plugins" },
      ),
    installSkillToInstance: (skill, toolId, instanceId) =>
      runMutation(
        `Syncing ${skill.name} to ${toolId}...`,
        async () => { installSkillToInstance(skill, toolId, instanceId); },
        { refresh: "plugins" },
      ),
    installSkillToAll: async (skill) => {
      const store = useStore.getState();
      // Cover missing AND drifted instances in one action. Uses installSkillToAllNonSynced
      // which inspects each tool: install if missing, overwrite if drifted, skip if synced.
      // Outlier: emits a summary notification between the spinner and the reload.
      let result: { installed: number; resynced: number; skipped: number; failed: number } = { installed: 0, resynced: 0, skipped: 0, failed: 0 };
      await withSpinner(
        `Syncing ${skill.name} from source to all tools...`,
        async () => { result = installSkillToAllNonSynced(skill); },
        store.notify, store.clearNotification,
      );
      const parts: string[] = [];
      if (result.installed > 0) parts.push(`installed to ${result.installed}`);
      if (result.resynced > 0) parts.push(`re-synced ${result.resynced}`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      store.notify(`${skill.name}: ${parts.join(", ") || "nothing to do"}`, result.failed > 0 ? "warning" : "info");
      await useStore.getState().loadInstalledPlugins({ silent: true });
    },
    pullbackSkillFromInstance: (skill, toolId, instanceId) =>
      runMutation(
        `Pulling ${skill.name} from ${toolId} to source repo...`,
        async () => {
          const ok = pullbackSkillToSource(skill, toolId, instanceId);
          if (!ok) {
            useStore.getState().notify(`Failed to pull ${skill.name} to source repo`, "error");
          }
        },
        { refresh: "plugins" },
      ),
    removeRedundantSkillInstallations: async (skill, redundant) => {
      const store = useStore.getState();
      // Outlier: emits a summary notification between the spinner and the reload.
      await withSpinner(
        `Removing ${skill.name} from Pi (${redundant.length} redundant copy${redundant.length === 1 ? "" : "ies"})...`,
        async () => {
          for (const inst of redundant) {
            try {
              rmSync(inst.diskPath, { recursive: true, force: true });
            } catch { /* skip */ }
          }
        },
        store.notify, store.clearNotification,
      );
      store.notify(`Removed redundant Pi copies of ${skill.name}`, "info");
      await useStore.getState().loadInstalledPlugins({ silent: true });
    },
    deleteSkillEverywhere: async (skill) => {
      await runMutation(
        `Deleting ${skill.name} everywhere...`,
        async () => {
          const result = deleteSkillEverywhere(skill);
          if (result.ok) {
            const parts = [`${result.tools} tool installs`];
            if (result.source) parts.push(`source repo (uncommitted — review & commit manually)`);
            useStore.getState().notify(`Deleted ${skill.name}: ${parts.join(", ")}`, "info");
          } else {
            useStore.getState().notify(`Delete failed: ${result.error}`, "error");
          }
        },
        { refresh: "plugins" },
      );
      if (detail?.kind === "skill") setDetail(null);
      closeDetail();
    },

    // ── Namespace bulk operations ──
    syncNamespace: (ns) =>
      runMutation(
        `Syncing missing skills in ${ns.name}...`,
        async () => { syncNamespaceToAllMissing(ns); },
        { refresh: "plugins" },
      ),
    resyncNamespace: (ns) =>
      runMutation(
        `Re-syncing drifted skills in ${ns.name}...`,
        async () => { resyncNamespaceDrifted(ns); },
        { refresh: "plugins" },
      ),
    deleteNamespaceEverywhere: async (ns) => {
      await runMutation(
        `Deleting all skills in ${ns.name}...`,
        async () => {
          const result = deleteNamespaceEverywhere(ns);
          const parts: string[] = [`${result.deleted} skills deleted`];
          if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
          useStore.getState().notify(`Deleted ${ns.name}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
        },
        { refresh: "plugins" },
      );
      if (detail?.kind === "namespace") setDetail(null);
      closeDetail();
    },
    uninstallNamespaceAll: (ns) =>
      runMutation(
        `Uninstalling all skills in ${ns.name}...`,
        async () => {
          const result = uninstallNamespaceAll(ns);
          const parts: string[] = [`${result.uninstalled} uninstalled`];
          if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
          useStore.getState().notify(`Uninstalled ${ns.name}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
        },
        { refresh: "plugins" },
      ),
    uninstallNamespaceFromInstance: (ns, toolId, instanceId) =>
      runMutation(
        `Uninstalling ${ns.name} from ${toolId}...`,
        async () => {
          const result = uninstallNamespaceFromInstance(ns, toolId, instanceId);
          const parts: string[] = [`${result.uninstalled} uninstalled`];
          if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
          useStore.getState().notify(`Uninstalled ${ns.name} from ${toolId}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
        },
        { refresh: "plugins" },
      ),
    pullbackNamespaceFromInstance: (ns, toolId, instanceId) =>
      runMutation(
        `Pulling back ${ns.name} from ${toolId}...`,
        async () => {
          const result = pullbackNamespaceToSource(ns, toolId, instanceId);
          const parts: string[] = [`${result.pulled} pulled back`];
          if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
          useStore.getState().notify(`Pulled back ${ns.name} from ${toolId}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
        },
        { refresh: "plugins" },
      ),
    openSkillDetail,
    openSkillDiff: (skill, toolId, instanceId) => {
      const diffTarget = buildSkillDiffTarget(skill, toolId, instanceId);
      if (!diffTarget) {
        useStore.getState().notify("Skill has no source repo path to diff against.", "warning");
        return;
      }
      useStore.setState({ diffTarget });
    },
    deletePluginEverywhere: async (plugin) => {
      await runMutation(
        `Deleting ${plugin.name} everywhere...`,
        async () => {
          const result = await deletePluginEverywhere(plugin);
          if (result.ok) {
            const parts = [`${result.tools} tool installs`];
            if (result.cache) parts.push("plugin cache");
            useStore.getState().notify(`Deleted ${plugin.name}: ${parts.join(", ")}`, "info");
          } else {
            useStore.getState().notify(`Delete failed: ${result.error}`, "error");
          }
        },
        { refresh: "plugins" },
      );
      if (detail?.kind === "plugin") setDetail(null);
      setDetailPluginDrift(null);
      closeDetail();
    },
    deleteFileEverywhere: async (file) => {
      await runMutation(
        `Deleting ${file.name} everywhere...`,
        async () => {
          const result = deleteFileEverywhere(file);
          if (result.ok) {
            const parts = [`${result.targets} tool targets`];
            if (result.source) parts.push("source file (uncommitted)");
            if (result.config) parts.push("config.yaml entry");
            useStore.getState().notify(`Deleted ${file.name}: ${parts.join(", ")}`, "info");
          } else {
            useStore.getState().notify(`Delete failed: ${result.error}`, "error");
          }
        },
        { refresh: "files" },
      );
      if (detail?.kind === "file") setDetail(null);
      closeDetail();
    },
    removeFileFromGit: (file) =>
      runMutation(
        `Removing ${file.name} from git...`,
        async () => {
          const result = removeFileFromGit(file);
          if (result.ok) {
            const parts: string[] = [];
            if (result.source) parts.push("source file");
            if (result.config) parts.push("config entry");
            useStore.getState().notify(
              `Removed ${file.name} from git: ${parts.join(", ") || "nothing found"}`,
              "info",
            );
            if (result.pushError) {
              useStore.getState().notify(`Committed locally but push failed: ${result.pushError}`, "warning");
            }
          } else {
            useStore.getState().notify(`Remove from git failed: ${result.error}`, "error");
          }
        },
        { refresh: "files" },
      ),
    removeSkillFromGit: (skill) =>
      runMutation(
        `Removing ${skill.name} from git...`,
        async () => {
          const result = removeSkillFromGit(skill);
          if (result.ok) {
            useStore.getState().notify(
              result.source
                ? `Removed ${skill.name} from git`
                : `${skill.name} has no source repo path to remove`,
              result.source ? "info" : "warning",
            );
            if (result.pushError) {
              useStore.getState().notify(`Committed locally but push failed: ${result.pushError}`, "warning");
            }
          } else {
            useStore.getState().notify(`Remove from git failed: ${result.error}`, "error");
          }
        },
        { refresh: "plugins" },
      ),
    removeNamespaceFromGit: (ns) =>
      runMutation(
        `Removing ${ns.name} from git...`,
        async () => {
          const result = removeNamespaceFromGit(ns);
          const parts = [`${result.removed} skill${result.removed === 1 ? "" : "s"} removed`];
          if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
          useStore.getState().notify(
            `Removed ${ns.name} from git: ${parts.join(", ")}`,
            result.errors.length > 0 ? "warning" : "info",
          );
        },
        { refresh: "plugins" },
      ),
    refreshDetailSkill: (skill) => {
      const refreshed = useStore.getState().standaloneSkills.find((s) => s.name === skill.name);
      if (refreshed) setDetail({ kind: "skill", data: refreshed });
      else { if (detail?.kind === "skill") setDetail(null); closeDetail(); }
    },
  };
}
