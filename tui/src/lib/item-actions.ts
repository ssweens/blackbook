/**
 * Unified Action Builders — extracted from PluginDetail.tsx and FileDetail.tsx
 *
 * These functions compute the action list for plugin/file/pi-package detail
 * views.  They were previously co-located with render components; now they
 * live here so the render components (PluginDetail, FileDetail) can be deleted.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { Plugin, FileStatus, PiPackage, DiffInstanceRef, DiffInstanceSummary } from "./types.js";
import type { ToolInstallStatus } from "./plugin-status.js";
import { getToolInstances } from "./config.js";
import { resolvePluginSourcePaths, type PluginDrift } from "./plugin-drift.js";
import { buildFileDiffTarget } from "./diff.js";
import { resolveInstalledPluginComponentPath } from "./pi-bridge.js";
import { loadManifest } from "./manifest.js";
import { buildManifestItemKey, instanceKey } from "./plugin-helpers.js";
import type { ItemAction } from "../components/ItemDetail.js";

// PluginAction is now an alias for ItemAction — PluginAction type eliminated
export type PluginAction = ItemAction;

// ─────────────────────────────────────────────────────────────────────────────
// FileAction type
// ─────────────────────────────────────────────────────────────────────────────

export interface FileAction {
  label: string;
  type: "diff" | "missing" | "sync" | "pullback" | "back" | "status" | "remove_from_git" | "delete_everywhere";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Action Builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildPluginActions(
  plugin: Plugin,
  toolStatuses: ToolInstallStatus[],
  isIncomplete?: boolean,
  drift?: PluginDrift,
): PluginAction[] {
  const actions: PluginAction[] = [];

  if (plugin.installed) {
    const sourcePaths = resolvePluginSourcePaths(plugin);
    const allInstances = getToolInstances();
    const changedInstances: DiffInstanceRef[] = [];
    const manifest = loadManifest();

    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      if (!status.installed) continue;

      const inst = allInstances.find(
        (t) => t.toolId === status.toolId && t.instanceId === status.instanceId,
      );
      if (!inst) continue;

      const instance: DiffInstanceRef = {
        toolId: status.toolId,
        instanceId: status.instanceId,
        instanceName: status.name,
        configDir: inst.configDir,
      };

      let totalAdded = 0;
      let totalRemoved = 0;
      let hasDrift = false;

      if (sourcePaths && drift) {
        const ikey = instanceKey(inst);
        for (const [key, driftStatus] of Object.entries(drift)) {
          if (driftStatus === "in-sync") continue;
          const [kind, name] = key.split(":");
          const srcSuffix = kind === "skill" ? name : `${name}.md`;
          const srcPath = join(sourcePaths.pluginDir, `${kind}s`, srcSuffix);
          const manifestKey = buildManifestItemKey(plugin.name, kind, name);
          const manifestItem = manifest.tools[ikey]?.items[manifestKey];
          const destPath = resolveInstalledPluginComponentPath(inst, plugin, kind as "skill" | "command" | "agent", name, manifestItem?.dest);
          if (!destPath) continue;
          // Pi skills/commands with no manifest record resolve to an ephemeral
          // tmpdir staging path (see resolveInstalledPluginComponentPath) that
          // rarely still exists by the time drift is displayed. Treating a
          // missing staging path as "entire file deleted" produces line counts
          // in the thousands — skip the stat but keep the drift-map's status.
          if (inst.toolId === "pi" && kind !== "agent" && !existsSync(destPath)) {
            hasDrift = true;
            continue;
          }

          try {
            const dt = buildFileDiffTarget(
              `${plugin.name}/${name}`, srcSuffix, srcPath, destPath, instance,
            );
            if (dt.files.length > 0) {
              totalAdded += dt.files.reduce((sum, f) => sum + f.linesAdded, 0);
              totalRemoved += dt.files.reduce((sum, f) => sum + f.linesRemoved, 0);
              hasDrift = true;
            }
          } catch {
            // Ignore errors
          }
        }
      }

      if (hasDrift) {
        const summary: DiffInstanceSummary = { ...instance, totalAdded, totalRemoved };
        changedInstances.push(instance);
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "diff",
          toolStatus: status,
          instance: summary,
          statusColor: "yellow",
          statusLabel: "Drifted",
        });
      } else {
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "diff",
          toolStatus: status,
          instance,
          statusColor: "green",
          statusLabel: "Synced",
        });
      }
    }

    // Not-installed + unsupported instances
    for (const status of toolStatuses) {
      if (!status.enabled) continue;
      if (!status.supported) {
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "status",
          statusColor: "gray",
          statusLabel: status.supportReason || "Unsupported",
        });
        continue;
      }
      if (status.installed) continue;
      actions.push({
        id: `status_${status.toolId}:${status.instanceId}`,
        label: status.name,
        type: "diff",
        statusColor: "yellow",
        statusLabel: "Not installed",
      });
    }

    // Bulk actions
    if (plugin.prescriptionStatus === "no-longer-in-marketplace" || plugin.prescriptionStatus === "marketplace-removed") {
      actions.push({ id: "track", label: "Track in source repo", type: "track" });
    }
    if (plugin.prescriptionStatus === "in-git") {
      actions.push({ id: "remove_from_git", label: "Remove from git (source repo prescription)", type: "remove_from_git" });
    }
    actions.push({ id: "uninstall", label: "Uninstall from all tools", type: "uninstall" });
    const updateLabel = plugin.hasUpdate && plugin.installedVersion && plugin.latestVersion
      ? `Update ${plugin.installedVersion} → ${plugin.latestVersion}`
      : "Update now";
    actions.push({ id: "update", label: updateLabel, type: "update" });

    if (isIncomplete) {
      actions.push({ id: "install_all", label: "Install to all tools", type: "install" });
    }

    // Per-tool install/uninstall
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      const inst = allInstances.find(
        (t) => t.toolId === status.toolId && t.instanceId === status.instanceId,
      );
      const instance = inst
        ? {
            toolId: inst.toolId,
            instanceId: inst.instanceId,
            instanceName: inst.name,
            configDir: inst.configDir,
          }
        : undefined;

      if (status.installed) {
        actions.push({
          id: `uninstall_${status.toolId}:${status.instanceId}`,
          label: `Uninstall from ${status.name}`,
          type: "uninstall_tool",
          toolStatus: status,
          instance,
        });
      } else {
        actions.push({
          id: `install_${status.toolId}:${status.instanceId}`,
          label: `Install to ${status.name}`,
          type: "install_tool",
          toolStatus: status,
          instance,
        });
      }
    }

    if (sourcePaths && changedInstances.length > 0) {
      for (const instance of changedInstances) {
        actions.push({
          id: `pullback_${instance.toolId}:${instance.instanceId}`,
          label: `Pull to source from ${instance.instanceName}`,
          type: "pullback",
          instance,
        });
      }
    }

    actions.push({ id: "back", label: "Back to plugin list", type: "back" });

    // Destructive "delete everywhere" — nukes tool installs + plugin cache + manifest entries.
    actions.push({
      id: "delete_everywhere",
      label: "🗑  Delete everywhere (all tools + plugin cache + manifest)",
      type: "delete_everywhere",
      statusColor: "red",
    });
  } else {
    actions.push({ id: "install", label: "Install to all tools", type: "install" });

    const allInstances = getToolInstances();
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      const inst = allInstances.find(
        (t) => t.toolId === status.toolId && t.instanceId === status.instanceId,
      );
      actions.push({
        id: `install_${status.toolId}:${status.instanceId}`,
        label: `Install to ${status.name}`,
        type: "install_tool",
        toolStatus: status,
        instance: inst
          ? {
              toolId: inst.toolId,
              instanceId: inst.instanceId,
              instanceName: inst.name,
              configDir: inst.configDir,
            }
          : undefined,
      });
    }

    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// File Action Builder
// ─────────────────────────────────────────────────────────────────────────────

export function getFileActions(file: FileStatus): FileAction[] {
  const actions: FileAction[] = [];

  for (const inst of file.instances) {
    const instance: DiffInstanceRef = {
      toolId: inst.toolId,
      instanceId: inst.instanceId,
      instanceName: inst.instanceName,
      configDir: inst.configDir,
    };

    if (inst.status === "drifted") {
      const diffTarget = buildFileDiffTarget(
        file.name, inst.targetRelPath, inst.sourcePath, inst.targetPath, instance,
      );
      const totalAdded = diffTarget.files.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalRemoved = diffTarget.files.reduce((sum, f) => sum + f.linesRemoved, 0);
      const summary: DiffInstanceSummary = { ...instance, totalAdded, totalRemoved };

      let statusLabel = "Source drifted";
      let statusColor: "yellow" | "magenta" | "red" = "yellow";
      if (inst.driftKind === "target-changed") {
        statusLabel = "Target drifted";
        statusColor = "magenta";
      } else if (inst.driftKind === "both-changed") {
        statusLabel = "Both drifted";
        statusColor = "red";
      }

      actions.push({ label: inst.instanceName, type: "diff", instance: summary, statusColor, statusLabel });
      continue;
    }

    if (inst.status === "missing") {
      actions.push({ label: inst.instanceName, type: "missing", instance, statusColor: "yellow", statusLabel: "Missing" });
      continue;
    }

    if (inst.status === "failed") {
      actions.push({ label: inst.instanceName, type: "status", statusColor: "red", statusLabel: "Failed" });
      continue;
    }

    actions.push({ label: inst.instanceName, type: "status", statusColor: "green", statusLabel: "Synced" });
  }

  const needsSync = file.instances.some((i) => i.status === "missing" || i.status === "drifted");
  if (needsSync) {
    actions.push({ label: "Sync to tool", type: "sync" });
  }

  const drifted = file.instances.filter((i) => i.status === "drifted");
  const pullbackTargets = drifted.length > 0 ? drifted : file.instances;
  for (const inst of pullbackTargets) {
    actions.push({
      label: `Pull to source from ${inst.instanceName}`,
      type: "pullback",
      instance: {
        toolId: inst.toolId,
        instanceId: inst.instanceId,
        instanceName: inst.instanceName,
        configDir: inst.configDir,
      },
    });
  }

  actions.push({ label: "Back to list", type: "back" });

  actions.push({
    label: "Remove from git (source file + config entry)",
    type: "remove_from_git",
  });

  actions.push({
    label: "🗑  Delete everywhere (all tools + source repo + config.yaml entry)",
    type: "delete_everywhere",
    statusColor: "red",
  });
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Package Action Builder
// ─────────────────────────────────────────────────────────────────────────────

export function getPiPackageActions(pkg: PiPackage): ItemAction[] {
  const actions: ItemAction[] = [];
  if (pkg.installed) {
    if (!pkg.recommended) actions.push({ id: "track", label: "Track in source repo", type: "track" });
    if (pkg.hasUpdate) actions.push({ id: "update", label: "Update", type: "update" });
    actions.push({ id: "uninstall", label: "Uninstall", type: "uninstall" });
  } else {
    actions.push({ id: "install", label: "Install", type: "install" });
  }
  actions.push({ id: "back", label: "Back to list", type: "back" });

  if (pkg.recommended) {
    actions.push({
      id: "remove_from_git",
      label: "Remove from git (config prescription only)",
      type: "remove_from_git",
    });
  }

  if (pkg.installed || pkg.recommended) {
    actions.push({
      id: "delete_everywhere",
      label: "🗑  Delete everywhere (local install + config.yaml prescription)",
      type: "delete_everywhere",
      statusColor: "red",
    });
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Entry Point
// ─────────────────────────────────────────────────────────────────────────────

import type { ManagedItem } from "./managed-item.js";
import { getPluginToolStatus } from "./plugin-status.js";
import type { StandaloneSkill } from "./install.js";

/**
 * Actions for a standalone skill: per-tool sync/uninstall, plus uninstall-all.
 */
export function getSkillActions(skill: StandaloneSkill): ItemAction[] {
  const actions: ItemAction[] = [];

  for (const inst of skill.installations) {
    // Status combines presence + drift in one label so the user sees the
    // complete state at a glance. Yellow when drifted (still installed but
    // out of sync with source); green when synced.
    // Drifted rows are `type: "diff"` so Enter opens the unified skill diff view
    // (same path as Sync tab and Namespace tree).
    const isDrifted = inst.drifted === true;
    actions.push({
      id: `status_${inst.toolId}_${inst.instanceId}`,
      label: inst.instanceName,
      type: isDrifted ? "diff" : "status",
      statusColor: isDrifted ? "yellow" : "green",
      statusLabel: isDrifted ? "Installed (drifted)" : "Installed (synced)",
      instance: isDrifted
        ? {
            toolId: inst.toolId,
            instanceId: inst.instanceId,
            instanceName: inst.instanceName,
            configDir: inst.diskPath,
          }
        : undefined,
    });
  }

  // Compute who's missing and who's drifted up front so we can order actions:
  //   1) Bulk action first (most prominent)
  //   2) Per-tool re-sync (drifted)
  //   3) Per-tool sync (missing)
  //   4) Per-tool pullback
  const installedKeys = new Set(
    skill.installations.map((i) => `${i.toolId}:${i.instanceId}`),
  );
  const missingInstances = getToolInstances().filter(
    (i) =>
      i.kind === "tool" &&
      i.enabled &&
      !!i.skillsSubdir &&
      !installedKeys.has(`${i.toolId}:${i.instanceId}`),
  );
  const driftedCount = skill.installations.filter((i) => i.drifted).length;
  const missingCount = missingInstances.length;

  // Bulk action: covers BOTH missing and drifted in one keystroke. Label adapts.
  if (missingCount + driftedCount > 0 && (missingCount + driftedCount > 1 || (missingCount > 0 && driftedCount > 0))) {
    let label: string;
    if (missingCount > 0 && driftedCount > 0) {
      label = `Sync from source to all (${missingCount} missing, ${driftedCount} drifted)`;
    } else if (missingCount > 1) {
      label = `Sync to all ${missingCount} missing tools`;
    } else {
      label = `Re-sync from source to all ${driftedCount} drifted tools (overwrites disk)`;
    }
    actions.push({ id: "install_all", label, type: "install" });
  }

  // For drifted installations, offer BOTH directions of resolution per-tool:
  //   - 'Re-sync from source' (source -> disk): overwrites disk copy
  //   - 'Pull to source'     (disk -> source): overwrites source copy
  // When no sourcePath exists yet, pullback doubles as "Track in source repo"
  // — it creates the skill in the source repo for the first time.
  if (skill.sourcePath) {
    const drifted = skill.installations.filter((i) => i.drifted);
    for (const inst of drifted) {
      actions.push({
        id: `install_tool_${inst.toolId}_${inst.instanceId}`,
        label: `Re-sync from source to ${inst.instanceName} (overwrites disk)`,
        type: "install_tool",
        toolStatus: {
          toolId: inst.toolId,
          instanceId: inst.instanceId,
          name: inst.instanceName,
          installed: true,
          enabled: true,
          supported: true,
        },
      });
    }
    for (const inst of skill.installations) {
      actions.push({
        id: `pullback_${inst.toolId}_${inst.instanceId}`,
        label: `Pull to source from ${inst.instanceName}${inst.drifted ? " (drifted)" : ""}`,
        type: "pullback",
        instance: {
          toolId: inst.toolId,
          instanceId: inst.instanceId,
          instanceName: inst.instanceName,
          configDir: inst.diskPath,
        },
      });
    }
  } else if (skill.installations.length > 0) {
    // No source-repo path — offer "Track in source repo" which is a pullback
    // that creates the skill in <source_repo>/skills/<name>/ for the first time.
    const first = skill.installations[0];
    actions.push({
      id: `pullback_${first.toolId}_${first.instanceId}`,
      label: "Track in source repo",
      type: "pullback",
      instance: {
        toolId: first.toolId,
        instanceId: first.instanceId,
        instanceName: first.instanceName,
        configDir: first.diskPath,
      },
    });
  }
  for (const inst of missingInstances) {
    actions.push({
      id: `install_tool_${inst.toolId}_${inst.instanceId}`,
      label: `Sync to ${inst.name}`,
      type: "install_tool",
      toolStatus: {
        toolId: inst.toolId,
        instanceId: inst.instanceId,
        name: inst.name,
        installed: false,
        enabled: true,
        supported: true,
      },
    });
  }

  if (skill.installations.length > 1) {
    for (const inst of skill.installations) {
      actions.push({
        id: `uninstall_tool_${inst.toolId}_${inst.instanceId}`,
        label: `Uninstall from ${inst.instanceName}`,
        type: "uninstall_tool",
        toolStatus: {
          toolId: inst.toolId,
          instanceId: inst.instanceId,
          name: inst.instanceName,
          installed: true,
          enabled: true,
          supported: true,
        },
      });
    }
  }

  actions.push({
    id: "uninstall",
    label: skill.installations.length > 1 ? "Uninstall from all tools" : "Uninstall",
    type: "uninstall",
  });

  // Remove redundant Pi installations (duplicates of skills that also
  // exist in `.agents/skills/`). The `redundant` flag is set by
  // `getStandaloneSkills` during collision detection.
  const redundantPiInsts = skill.installations.filter((i) => i.redundant);
  if (redundantPiInsts.length > 0) {
    actions.push({
      id: "remove_redundant",
      label: redundantPiInsts.length === 1
        ? `Remove from ${redundantPiInsts[0].instanceName} (duplicated in .agents)`
        : `Remove redundant copies (${redundantPiInsts.length} in Pi, use .agents instead)`,
      type: "remove_redundant",
    });
  }

  actions.push({ id: "back", label: "Back to list", type: "back" });

  if (skill.sourcePath) {
    actions.push({
      id: "remove_from_git",
      label: "Remove from git (source repo copy only)",
      type: "remove_from_git",
    });
  }

  // Destructive "delete everywhere" — placed AFTER "Back to list" so it's the last
  // item, requiring intentional navigation to reach.
  const sourceFragment = skill.sourcePath ? " + source repo" : "";
  actions.push({
    id: "delete_everywhere",
    label: `🗑  Delete everywhere (all tools${sourceFragment})`,
    type: "delete_everywhere",
    statusColor: "red",
  });
  return actions;
}

/**
 * Actions for a namespace group: bulk sync, re-sync, delete.
 */
export function getNamespaceActions(ns: import("./install.js").NamespaceGroup): ItemAction[] {
  const actions: ItemAction[] = [];

  for (const inst of ns.toolIds) {
    actions.push({
      id: `status_${inst}`,
      label: inst,
      type: "status",
      statusColor: "green",
      statusLabel: "Enabled",
    });
  }

  if (ns.missingCount > 0) {
    actions.push({
      id: "sync_missing",
      label: `Sync all ${ns.missingCount} missing skill${ns.missingCount === 1 ? "" : "s"}`,
      type: "sync",
    });
  }

  if (ns.driftedCount > 0) {
    actions.push({
      id: "resync_drifted",
      label: `Re-sync all ${ns.driftedCount} drifted skill${ns.driftedCount === 1 ? "" : "s"} (overwrites disk)`,
      type: "sync",
    });
  }

  // Individual skills — pick one to drill into its detail view
  actions.push({ id: "_skills_header", label: `Skills in ${ns.name}:`, type: "status", statusLabel: "" });
  for (const skill of ns.skills) {
    const display = skill.namespace ? `${skill.namespace}/${skill.name}` : skill.name;
    const toolCount = skill.installations.length;
    const label = toolCount > 0 ? `${display}  (${toolCount} tool${toolCount === 1 ? "" : "s"})` : `${display}  (not installed)`;
    actions.push({
      id: skill.name,
      label,
      type: "open_skill",
    });
  }

  // Per-tool bulk uninstalls (only for tools that have something installed)
  for (const toolId of ns.toolIds) {
    const installedCount = ns.skills.filter((s) => s.installations.some((i) => i.toolId === toolId)).length;
    if (installedCount > 0) {
      actions.push({
        id: `uninstall_${toolId}`,
        label: `Uninstall all from ${toolId}`,
        type: "uninstall_tool",
        instance: { toolId, instanceId: "default", instanceName: toolId, configDir: "" },
      });
    }
  }

  // Uninstall from all tools
  const anyInstalled = ns.skills.some((s) => s.installations.length > 0);
  if (anyInstalled) {
    actions.push({
      id: "uninstall_all",
      label: "Uninstall from all tools",
      type: "uninstall",
    });
  }

  actions.push({ id: "back", label: "Back to list", type: "back" });

  const trackedCount = ns.skills.filter((s) => s.sourcePath).length;
  if (trackedCount > 0) {
    actions.push({
      id: "remove_from_git",
      label: `Remove from git (${trackedCount} source repo skill${trackedCount === 1 ? "" : "s"})`,
      type: "remove_from_git",
    });
  }

  actions.push({
    id: "delete_everywhere",
    label: `🗑  Delete all ${ns.skills.length} skills in ${ns.name}`,
    type: "delete_everywhere",
    statusColor: "red",
  });

  return actions;
}

/**
 * Build actions for any ManagedItem — routes to the kind-specific builder.
 * Pass drift for plugin items to get per-instance diff status.
 */
export function buildItemActions(item: ManagedItem, drift?: PluginDrift): ItemAction[] {
  if (item._plugin) {
    const toolStatuses = getPluginToolStatus(item._plugin);
    const isIncomplete = item._plugin.installed && item._plugin.incomplete;
    return buildPluginActions(item._plugin, toolStatuses, isIncomplete, drift);
  }
  if (item._file) {
    return getFileActions(item._file).map((a, i) => ({ id: `${a.type}_${i}`, ...a }));
  }
  if (item._piPackage) {
    return getPiPackageActions(item._piPackage);
  }
  if (item._skill) {
    return getSkillActions(item._skill);
  }
  if (item._namespace) {
    return getNamespaceActions(item._namespace);
  }
  return [];
}
