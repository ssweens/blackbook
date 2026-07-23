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
import { isSharedSubdirPath, agentsComponentDir } from "./path-utils.js";
import { pluginSkillStorePath, skillPresentForInstance } from "./adapters/shared.js";
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
  // Retained for signature compatibility with the caller; the consolidated
  // component-centric view no longer enumerates per-tool status.
  _toolStatuses: ToolInstallStatus[],
  isIncomplete?: boolean,
  // Retained for signature compatibility; drift is now computed directly
  // against the single shared-store copy (see perComponentDrift) rather than
  // from a precomputed per-tool drift map.
  _drift?: PluginDrift,
): PluginAction[] {
  const actions: PluginAction[] = [];

  if (plugin.installed) {
    const sourcePaths = resolvePluginSourcePaths(plugin);

    // ── Component status (consolidated on ~/.agents — NOT per-tool) ──
    // Every artifact resolves through the shared ~/.agents convention: skills
    // in ~/.agents/skills (Claude via overlay symlink), commands/agents copied
    // into each tool's dir but from one shared source. Users don't manage
    // tools individually, so show ONE status row per component type, computed
    // once against source — never an N-tool enumeration.
    let anyDrift = false;

    let anyMissing = false;

    // Skills: diff the shared-store copy against source. A skill absent from
    // the store entirely is "Missing", not "In sync" — the plugin may still be
    // installed on some other tool/component, so it can't be silently treated
    // as up to date.
    //
    // Flat-install tools (Claude) additionally need their OWN derived-view
    // symlink materialized inside THEIR OWN config dir — the shared store
    // being populated once is not enough. A tool can have multiple enabled
    // instances with separate config dirs (e.g. two Claude profiles); each
    // one needs its own symlink, so a skill present in the store but missing
    // from one flat instance's overlay is still "Missing" overall.
    if (plugin.skills.length > 0) {
      let added = 0;
      let removed = 0;
      let drifted = false;
      // A DISTINCT set of skill names that are missing somewhere they must be
      // present — either absent from the shared store, or absent from an
      // enabled flat-install instance's own overlay (a second Claude profile
      // needs its own symlink). A set can never exceed plugin.skills.length,
      // so the row count can't overflow (was "Missing (87/85)").
      const missingSkills = new Set<string>();
      const flatInstances = getToolInstances().filter(
        (t) => t.kind === "tool" && t.enabled && t.pluginFlatInstall,
      );
      for (const skill of plugin.skills) {
        const storePath = pluginSkillStorePath(plugin.name, skill);
        if (!storePath) { missingSkills.add(skill); continue; }
        for (const inst of flatInstances) {
          if (!skillPresentForInstance(plugin.name, skill, inst)) { missingSkills.add(skill); break; }
        }
        if (!sourcePaths) continue;
        try {
          const dt = buildFileDiffTarget(`${plugin.name}/${skill}`, skill,
            join(sourcePaths.pluginDir, "skills", skill), storePath, SHARED_REF);
          if (dt.files.length > 0) {
            added += dt.files.reduce((s, f) => s + f.linesAdded, 0);
            removed += dt.files.reduce((s, f) => s + f.linesRemoved, 0);
            drifted = true;
          }
        } catch { /* treat as in-sync */ }
      }
      const missing = missingSkills.size;
      if (drifted) anyDrift = true;
      if (missing > 0) anyMissing = true;
      actions.push(componentStatusRow("skills", "Skills", plugin.skills.length, drifted, added, removed, missing));
    }

    // Commands/agents: one row each, diffed once against the single shared
    // ~/.agents/{commands,agents} copy — every tool (Claude included) reads
    // the same physical file, so there is nothing to enumerate per-tool.
    for (const [kind, label] of [["command", "Commands"], ["agent", "Agents"]] as const) {
      const names = kind === "command" ? plugin.commands : plugin.agents;
      if (names.length === 0) continue;
      const { drifted, added, removed, missing } = perComponentDrift(plugin, kind, names, sourcePaths);
      if (drifted) anyDrift = true;
      if (missing > 0) anyMissing = true;
      actions.push(componentStatusRow(`${kind}s`, label, names.length, drifted, added, removed, missing));
    }

    if (plugin.hooks.length > 0) {
      actions.push({
        id: "status_hooks", type: "status", statusColor: "green",
        label: `Hooks (${plugin.hooks.length})`, statusLabel: "Installed",
      });
    }

    // ── Bulk actions (all operate across every tool via ~/.agents) ──
    if (plugin.prescriptionStatus === "no-longer-in-marketplace" || plugin.prescriptionStatus === "marketplace-removed") {
      actions.push({ id: "track", label: "Track in source repo", type: "track" });
    }
    if (plugin.prescriptionStatus === "in-git") {
      actions.push({ id: "remove_from_git", label: "Remove from git (source repo prescription)", type: "remove_from_git" });
    }
    if (isIncomplete || anyDrift || anyMissing) {
      actions.push({ id: "install_all", label: "Install missing + fix drift from source repo", type: "install" });
    }
    if (anyDrift && sourcePaths) {
      actions.push({ id: "pullback_shared", label: "Update source repo from disk", type: "pullback", instance: SHARED_REF });
    }
    const updateLabel = plugin.hasUpdate && plugin.installedVersion && plugin.latestVersion
      ? `Update ${plugin.installedVersion} → ${plugin.latestVersion}`
      : "Update now";
    actions.push({ id: "update", label: updateLabel, type: "update" });
    actions.push({ id: "uninstall", label: "Remove from all tools (keeps source repo)", type: "uninstall" });
    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
    actions.push({
      id: "delete_everywhere",
      label: "🗑  Delete from everything (tools + source repo + manifest)",
      type: "delete_everywhere",
      statusColor: "red",
    });
  } else {
    // Not installed: one Install action (goes to every tool via ~/.agents).
    actions.push({ id: "install", label: "Install", type: "install" });
    actions.push({ id: "back", label: "Back to plugin list", type: "back" });
  }

  return actions;
}

/** Shared-store diff instance ref — the single "location" every tool reads from. */
const SHARED_REF: DiffInstanceRef = {
  toolId: "agents", instanceId: "shared", instanceName: "Shared store", configDir: "",
};

/**
 * One consolidated status row for a component type against ~/.agents.
 * "Missing" (component absent from the shared store entirely) takes priority
 * over "Drifted" — a component that isn't installed anywhere can't also be
 * reported as up to date.
 */
function componentStatusRow(
  idKind: string,
  label: string,
  count: number,
  drifted: boolean,
  added: number,
  removed: number,
  missing: number,
): PluginAction {
  const rowLabel = `${label} (${count})`;
  if (missing > 0) {
    return {
      id: `status_${idKind}`,
      type: "status",
      label: rowLabel,
      statusColor: "red",
      statusLabel: missing === count ? "Missing" : `Missing (${missing}/${count})`,
    };
  }
  if (drifted) {
    return {
      id: `status_${idKind}`,
      type: "diff",
      label: rowLabel,
      instance: { ...SHARED_REF, totalAdded: added, totalRemoved: removed },
      statusColor: "yellow",
      statusLabel: "Drifted",
    };
  }
  return { id: `status_${idKind}`, type: "status", label: rowLabel, statusColor: "green", statusLabel: "In sync" };
}

/**
 * Drift (and missing-ness) for a command/agent component type, diffed once
 * against the single shared `~/.agents/{commands,agents}/<plugin>/<name>.md`
 * copy every tool reads — there is exactly one physical file per component
 * now (same convention as skills), so no per-tool enumeration is needed.
 */
function perComponentDrift(
  plugin: Plugin,
  kind: "command" | "agent",
  names: string[],
  sourcePaths: { pluginDir: string; repoRoot: string } | null,
): { drifted: boolean; added: number; removed: number; missing: number } {
  let drifted = false;
  let added = 0;
  let removed = 0;
  let missing = 0;
  for (const name of names) {
    const destPath = agentsComponentDir(kind, plugin.name, name);
    if (!existsSync(destPath)) { missing++; continue; }
    if (!sourcePaths) continue;
    const srcSuffix = `${name}.md`;
    const srcPath = join(sourcePaths.pluginDir, `${kind}s`, srcSuffix);
    try {
      const dt = buildFileDiffTarget(`${plugin.name}/${name}`, srcSuffix, srcPath, destPath, SHARED_REF);
      if (dt.files.length > 0) {
        drifted = true;
        added += dt.files.reduce((s, f) => s + f.linesAdded, 0);
        removed += dt.files.reduce((s, f) => s + f.linesRemoved, 0);
      }
    } catch { /* ignore */ }
  }
  return { drifted, added, removed, missing };
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
      } else if (inst.driftKind === "never-synced") {
        statusLabel = "Untracked target";
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
    label: "🗑  Delete from everything (tools + source repo + config)",
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
    if (!pkg.recommended) actions.push({ id: "track", label: "Add to source repo", type: "track" });
    if (pkg.hasUpdate) actions.push({ id: "update", label: "Update", type: "update" });
    actions.push({ id: "uninstall", label: "Remove from all tools (keeps source repo)", type: "uninstall" });
  } else {
    actions.push({ id: "install", label: "Install", type: "install" });
  }
  actions.push({ id: "back", label: "Back to list", type: "back" });

  if (pkg.recommended) {
    actions.push({
      id: "remove_from_git",
      label: "Remove from source repo (config prescription only)",
      type: "remove_from_git",
    });
  }

  if (pkg.installed || pkg.recommended) {
    actions.push({
      id: "delete_everywhere",
      label: "🗑  Delete from everything (tools + source repo + config)",
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
  const isInstalled = skill.installations.length > 0;
  const isDrifted = skill.installations.some((i) => i.drifted);

  // ONE status line — installed or not, drifted or synced.
  if (isInstalled) {
    actions.push({
      id: "status",
      label: skill.name,
      type: isDrifted ? "diff" : "status",
      statusColor: isDrifted ? "yellow" : "green",
      statusLabel: isDrifted ? "Drifted" : "In sync",
      instance: isDrifted && skill.diskPath ? {
        toolId: skill.toolId,
        instanceId: skill.instanceId,
        instanceName: skill.instanceName,
        configDir: skill.diskPath,
      } : undefined,
    });
  } else {
    actions.push({
      id: "status",
      label: skill.name,
      type: "status",
      statusColor: "gray",
      statusLabel: "Not installed",
    });
  }

  // Sync (install missing + fix drift) — ONE action.
  if (!isInstalled || isDrifted) {
    actions.push({ id: "install_all", label: "Install from source repo", type: "install" });
  }

  // Pull disk changes to source repo — ONE action. Opposite of sync.
  if (isInstalled && skill.sourcePath) {
    actions.push({ id: "pullback", label: "Update source repo from disk", type: "pullback", instance: {
      toolId: skill.toolId, instanceId: skill.instanceId, instanceName: skill.instanceName, configDir: skill.diskPath,
    }});
  } else if (isInstalled && !skill.sourcePath) {
    actions.push({ id: "pullback", label: "Add to source repo", type: "pullback", instance: {
      toolId: skill.toolId, instanceId: skill.instanceId, instanceName: skill.instanceName, configDir: skill.diskPath,
    }});
  }

  // Uninstall — ONE action, removes from all tools. Source repo stays.
  if (isInstalled) {
    actions.push({ id: "uninstall", label: "Remove from all tools", type: "uninstall" });
  }

  actions.push({ id: "back", label: "Back to list", type: "back" });

  // Destructive delete — last item, intentional.
  actions.push({
    id: "delete_everywhere",
    label: "🗑  Delete from everything (tools + source repo)",
    type: "delete_everywhere",
    statusColor: "red",
  });
  return actions;
}

/**
 * Actions for a namespace group: ONE sync, ONE uninstall, ONE delete.
 */
export function getNamespaceActions(ns: import("../lib/install.js").NamespaceGroup): ItemAction[] {
  const actions: ItemAction[] = [];
  const anyInstalled = ns.skills.some((s) => s.installations.length > 0);
  const needsSync = ns.missingCount > 0 || ns.driftedCount > 0;

  // ONE sync action.
  if (needsSync) {
    actions.push({
      id: "sync_missing",
      label: `Install all ${ns.skills.length} skills from source repo`,
      type: "sync",
    });
  }

  // ONE pull-to-source action (opposite of sync).
  const anyDrifted = ns.skills.some((s) => s.installations.some((i) => i.drifted));
  if (anyDrifted) {
    actions.push({
      id: "pullback_all",
      label: `Update source repo from all ${ns.skills.length} disk copies`,
      type: "pullback",
    });
  }

  // ONE uninstall action.
  if (anyInstalled) {
    actions.push({
      id: "uninstall_all",
      label: `Remove all ${ns.skills.length} skills from tools (keeps source repo)`,
      type: "uninstall",
    });
  }

  // Individual skills — pick one to drill into its detail view.
  actions.push({ id: "_skills_header", label: `Skills in ${ns.name}:`, type: "status", statusLabel: "" });
  for (const skill of ns.skills) {
    const display = skill.namespace ? `${skill.namespace}/${skill.name}` : skill.name;
    const isInstalled = skill.installations.length > 0;
    const isDrifted = skill.installations.some((i) => i.drifted);
    const statusLabel = !isInstalled ? "not installed" : isDrifted ? "drifted" : "in sync";
    actions.push({
      id: skill.name,
      label: `${display}  (${statusLabel})`,
      type: "open_skill",
    });
  }

  actions.push({ id: "back", label: "Back to list", type: "back" });

  // Destructive delete — last item, intentional.
  actions.push({
    id: "delete_everywhere",
    label: `🗑  Delete all ${ns.skills.length} skills from everything (tools + source repo)`,
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
