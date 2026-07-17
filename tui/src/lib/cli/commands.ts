import { useStore, initializeStore } from "../store.js";
import { getToolInstances } from "../config.js";
import { installSkillToAllMissing, uninstallSkillAllInstances } from "../install.js";
import { resolveToolFilter, type ToolFilter } from "./tool-filter.js";
import type { SyncPreviewItem } from "../types.js";
import {
  toStatusRows,
  formatStatusText,
  formatStatusJson,
  toListResult,
  formatListText,
  formatListJson,
  formatSyncText,
  formatSyncJson,
  formatInstallText,
  formatInstallJson,
  type SyncResultSummary,
  type InstallResultSummary,
} from "./format.js";

export interface CommandOptions {
  tool?: string;
  json?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

/**
 * Load everything the CLI's commands need. Deliberately narrower than the
 * TUI's `refreshAll()`: skips `refreshToolDetection` (spawns a subprocess per
 * registered tool to check installed/latest binary versions — slow, network-
 * dependent, and only feeds the "tool" kind of sync-preview item) and the
 * TUI-only `refreshManagedTools`/`refreshDetail`. A scriptable, non-
 * interactive command shouldn't pay for a background version-check network
 * round-trip on every invocation; tool-binary updates remain a TUI concern.
 */
async function bootstrap(): Promise<void> {
  await initializeStore();
  const state = useStore.getState();
  await state.loadMarketplaces();
  await state.loadInstalledPlugins({ silent: true });
  await state.loadPiPackages({ silent: true });
  await state.loadFiles({ silent: true });
}

function resolveFilterOrFail(toolArg: string | undefined): { filter?: ToolFilter } | { error: string } {
  const instances = getToolInstances();
  const result = resolveToolFilter(toolArg, instances);
  if (!result.ok) return { error: result.error };
  return { filter: result.filter ?? undefined };
}

/**
 * Scope a SyncPreviewItem's per-instance targeting to a tool filter, for
 * both display (status) and real sync scoping. `file`/`tool`/`piPackage`
 * carry real toolId/instanceId or a single toolId already, so they filter
 * directly. `plugin`/`skill` only carry display NAMES here (missingInstances/
 * driftedInstances) — the real per-instance targeting for those two kinds is
 * resolved fresh inside syncTools via its own toolFilter param (see
 * files-slice.ts), so this just filters the display strings by matched
 * instance name to keep status/list output consistent with what sync would
 * actually touch.
 */
function scopeSyncPreviewItem(item: SyncPreviewItem, filter: ToolFilter): SyncPreviewItem | null {
  const matchedNames = new Set(filter.matchedInstances.map((i) => i.name));
  switch (item.kind) {
    case "plugin": {
      const missingInstances = item.missingInstances.filter((n) => matchedNames.has(n));
      if (missingInstances.length === 0) return null;
      return { ...item, missingInstances };
    }
    case "file": {
      const instances = item.file.instances.filter((i) => filter.predicate(i.toolId, i.instanceId));
      if (instances.length === 0) return null;
      return { ...item, file: { ...item.file, instances } };
    }
    case "skill": {
      const missingInstances = item.missingInstances.filter((n) => matchedNames.has(n));
      const driftedInstances = item.driftedInstances.filter((n) => matchedNames.has(n));
      if (missingInstances.length === 0 && driftedInstances.length === 0) return null;
      return { ...item, missingInstances, driftedInstances };
    }
    case "tool":
      return filter.predicate(item.toolId) ? item : null;
    case "piPackage":
      return filter.predicate("pi") ? item : null;
  }
}

function scopeItems(items: SyncPreviewItem[], filter: ToolFilter | undefined): SyncPreviewItem[] {
  if (!filter) return items;
  return items
    .map((item) => scopeSyncPreviewItem(item, filter))
    .filter((item): item is SyncPreviewItem => item !== null);
}

export async function runStatus(options: CommandOptions): Promise<CommandResult> {
  await bootstrap();
  const filterResult = resolveFilterOrFail(options.tool);
  if ("error" in filterResult) return { exitCode: 1, output: filterResult.error };

  const items = scopeItems(useStore.getState().getSyncPreview(), filterResult.filter);
  const rows = toStatusRows(items);
  const output = options.json ? formatStatusJson(rows) : formatStatusText(rows);
  return { exitCode: 0, output };
}

export async function runList(options: CommandOptions): Promise<CommandResult> {
  await bootstrap();
  const filterResult = resolveFilterOrFail(options.tool);
  if ("error" in filterResult) return { exitCode: 1, output: filterResult.error };

  const state = useStore.getState();
  const filter = filterResult.filter;

  const skills = filter
    ? state.standaloneSkills
        .map((s) => ({ ...s, installations: s.installations.filter((i) => filter.predicate(i.toolId, i.instanceId)) }))
        .filter((s) => s.installations.length > 0)
    : state.standaloneSkills;
  const files = filter
    ? state.files
        .map((f) => ({ ...f, instances: f.instances.filter((i) => filter.predicate(i.toolId, i.instanceId)) }))
        .filter((f) => f.instances.length > 0)
    : state.files;

  const result = toListResult(state.installedPlugins, skills, files, state.piPackages);
  const output = options.json ? formatListJson(result) : formatListText(result);
  return { exitCode: 0, output };
}

export async function runSync(options: CommandOptions): Promise<CommandResult> {
  await bootstrap();
  const filterResult = resolveFilterOrFail(options.tool);
  if ("error" in filterResult) return { exitCode: 1, output: filterResult.error };
  const filter = filterResult.filter;

  let items = scopeItems(useStore.getState().getSyncPreview(), filter);
  if (options.yes) {
    items = items.map((item) => (item.kind === "file" ? { ...item, forceOverwrite: true } : item));
  }

  if (items.length === 0) {
    const summary: SyncResultSummary = { attempted: 0, remaining: 0, errors: [] };
    return { exitCode: 0, output: options.json ? formatSyncJson(summary) : "Everything is in sync." };
  }

  if (options.dryRun) {
    const rows = toStatusRows(items);
    const output = options.json
      ? JSON.stringify({ dryRun: true, wouldSync: rows }, null, 2)
      : [`Would sync ${items.length} item(s):`, formatStatusText(rows)].join("\n");
    return { exitCode: 0, output };
  }

  const notificationsBefore = useStore.getState().notifications.length;
  await useStore.getState().syncTools(items, filter ? { toolFilter: filter.predicate } : undefined);
  const errors = useStore
    .getState()
    .notifications.slice(notificationsBefore)
    .filter((n) => n.type === "error")
    .map((n) => n.message);

  const remaining = scopeItems(useStore.getState().getSyncPreview(), filter);
  const summary: SyncResultSummary = { attempted: items.length, remaining: remaining.length, errors };
  const output = options.json ? formatSyncJson(summary) : formatSyncText(summary);
  return { exitCode: errors.length > 0 ? 1 : 0, output };
}

function parseNameArg(nameArg: string): { name: string; marketplace?: string } {
  const at = nameArg.lastIndexOf("@");
  if (at <= 0) return { name: nameArg };
  return { name: nameArg.slice(0, at), marketplace: nameArg.slice(at + 1) };
}

export async function runInstall(nameArg: string, options: CommandOptions): Promise<CommandResult> {
  await bootstrap();
  const { name, marketplace } = parseNameArg(nameArg);
  const state = useStore.getState();

  const allPlugins = state.marketplaces.flatMap((m) => m.plugins);
  const plugin = allPlugins.find((p) => p.name === name && (!marketplace || p.marketplace === marketplace));
  if (plugin) {
    const success = await state.installPlugin(plugin);
    const summary: InstallResultSummary = {
      name: plugin.name,
      kind: "plugin",
      success,
      detail: success ? "installed" : "install failed — see notifications for detail",
    };
    return { exitCode: success ? 0 : 1, output: options.json ? formatInstallJson(summary) : formatInstallText(summary) };
  }

  const skill = state.standaloneSkills.find((s) => s.name === name);
  if (skill) {
    const result = installSkillToAllMissing(skill);
    const success = result.failed === 0;
    const summary: InstallResultSummary = {
      name: skill.name,
      kind: "skill",
      success,
      detail: `installed: ${result.installed}, skipped: ${result.skipped}, failed: ${result.failed}`,
    };
    return { exitCode: success ? 0 : 1, output: options.json ? formatInstallJson(summary) : formatInstallText(summary) };
  }

  return { exitCode: 1, output: `No plugin or skill found matching "${nameArg}".` };
}

export async function runUninstall(nameArg: string, options: CommandOptions): Promise<CommandResult> {
  await bootstrap();
  const { name, marketplace } = parseNameArg(nameArg);
  const state = useStore.getState();

  const plugin = state.installedPlugins.find((p) => p.name === name && (!marketplace || p.marketplace === marketplace));
  if (plugin) {
    const success = await state.uninstallPlugin(plugin);
    const summary: InstallResultSummary = {
      name: plugin.name,
      kind: "plugin",
      success,
      detail: success ? "uninstalled" : "uninstall failed — see notifications for detail",
    };
    return { exitCode: success ? 0 : 1, output: options.json ? formatInstallJson(summary) : formatInstallText(summary) };
  }

  const skill = state.standaloneSkills.find((s) => s.name === name);
  if (skill) {
    const removed = uninstallSkillAllInstances(skill);
    const success = removed > 0;
    const summary: InstallResultSummary = {
      name: skill.name,
      kind: "skill",
      success,
      detail: `removed from ${removed} instance(s)`,
    };
    return { exitCode: success ? 0 : 1, output: options.json ? formatInstallJson(summary) : formatInstallText(summary) };
  }

  return { exitCode: 1, output: `No installed plugin or skill found matching "${nameArg}".` };
}
