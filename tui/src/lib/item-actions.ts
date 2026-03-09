/**
 * Unified Action Builders — extracted from PluginDetail.tsx and FileDetail.tsx
 *
 * These functions compute the action list for plugin/file/pi-package detail
 * views.  They were previously co-located with render components; now they
 * live here so the render components (PluginDetail, FileDetail) can be deleted.
 */

import { join } from "path";
import type { Plugin, FileStatus, PiPackage, DiffInstanceRef, DiffInstanceSummary } from "./types.js";
import type { ToolInstallStatus } from "./plugin-status.js";
import { getToolInstances } from "./config.js";
import { resolvePluginSourcePaths, type PluginDrift } from "./plugin-drift.js";
import { buildFileDiffTarget } from "./diff.js";
import type { ItemAction } from "../components/ItemDetail.js";

// ─────────────────────────────────────────────────────────────────────────────
// PluginAction type (kept for backward compat with App.tsx action counting)
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginAction {
  id: string;
  label: string;
  type: "install" | "uninstall" | "update" | "install_tool" | "uninstall_tool" | "diff" | "back";
  toolStatus?: ToolInstallStatus;
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FileAction type
// ─────────────────────────────────────────────────────────────────────────────

export interface FileAction {
  label: string;
  type: "diff" | "missing" | "sync" | "pullback" | "back" | "status";
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
        for (const [key, driftStatus] of Object.entries(drift)) {
          if (driftStatus === "in-sync") continue;
          const [kind, name] = key.split(":");
          const subdir =
            kind === "skill" ? inst.skillsSubdir
            : kind === "command" ? inst.commandsSubdir
            : inst.agentsSubdir;
          if (!subdir) continue;

          const srcSuffix = kind === "skill" ? name : `${name}.md`;
          const srcPath = join(sourcePaths.pluginDir, `${kind}s`, srcSuffix);
          const destPath = join(inst.configDir, subdir, srcSuffix);

          try {
            const dt = buildFileDiffTarget(
              `${plugin.name}/${name}`, srcSuffix, srcPath, destPath, instance,
            );
            totalAdded += dt.files.reduce((sum, f) => sum + f.linesAdded, 0);
            totalRemoved += dt.files.reduce((sum, f) => sum + f.linesRemoved, 0);
            hasDrift = true;
          } catch {
            // Ignore errors
          }
        }
      }

      if (hasDrift) {
        const summary: DiffInstanceSummary = { ...instance, totalAdded, totalRemoved };
        actions.push({
          id: `status_${status.toolId}:${status.instanceId}`,
          label: status.name,
          type: "diff",
          toolStatus: status,
          instance: summary,
          statusColor: "yellow",
          statusLabel: "Changed",
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

    // Not-installed instances
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
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
    actions.push({ id: "uninstall", label: "Uninstall from all tools", type: "uninstall" });
    actions.push({ id: "update", label: "Update now", type: "update" });

    if (isIncomplete) {
      actions.push({ id: "install_all", label: "Install to all tools", type: "install" });
    }

    // Per-tool install/uninstall
    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      if (status.installed) {
        actions.push({
          id: `uninstall_${status.toolId}:${status.instanceId}`,
          label: `Uninstall from ${status.name}`,
          type: "uninstall_tool",
          toolStatus: status,
        });
      } else {
        actions.push({
          id: `install_${status.toolId}:${status.instanceId}`,
          label: `Install to ${status.name}`,
          type: "install_tool",
          toolStatus: status,
        });
      }
    }

    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
  } else {
    actions.push({ id: "install", label: "Install to all tools", type: "install" });

    for (const status of toolStatuses) {
      if (!status.enabled || !status.supported) continue;
      actions.push({
        id: `install_${status.toolId}:${status.instanceId}`,
        label: `Install to ${status.name}`,
        type: "install_tool",
        toolStatus: status,
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

      let statusLabel = "Source changed";
      let statusColor: "yellow" | "magenta" | "red" = "yellow";
      if (inst.driftKind === "target-changed") {
        statusLabel = "Target changed";
        statusColor = "magenta";
      } else if (inst.driftKind === "both-changed") {
        statusLabel = "Both changed";
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
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Package Action Builder
// ─────────────────────────────────────────────────────────────────────────────

export function getPiPackageActions(pkg: PiPackage): ItemAction[] {
  const actions: ItemAction[] = [];
  if (pkg.installed) {
    if (pkg.hasUpdate) actions.push({ id: "update", label: "Update", type: "update" });
    actions.push({ id: "uninstall", label: "Uninstall", type: "uninstall" });
  } else {
    actions.push({ id: "install", label: "Install", type: "install" });
  }
  actions.push({ id: "back", label: "Back to list", type: "back" });
  return actions;
}
