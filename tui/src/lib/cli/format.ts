import type {
  SyncPreviewItem,
  Plugin,
  FileStatus,
  PiPackage,
} from "../types.js";
import type { StandaloneSkill } from "../install.js";

// ─────────────────────────────────────────────────────────────────────────────
// status (drift report)
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusRow {
  kind: SyncPreviewItem["kind"];
  name: string;
  missingInstances: string[];
  driftedInstances: string[];
}

export function toStatusRows(items: SyncPreviewItem[]): StatusRow[] {
  return items.map((item) => {
    switch (item.kind) {
      case "plugin":
        return { kind: "plugin", name: item.plugin.name, missingInstances: item.missingInstances, driftedInstances: [] };
      case "file":
        return { kind: "file", name: item.file.name, missingInstances: item.missingInstances, driftedInstances: item.driftedInstances };
      case "skill":
        return { kind: "skill", name: item.skill.name, missingInstances: item.missingInstances, driftedInstances: item.driftedInstances };
      case "tool":
        return { kind: "tool", name: item.name, missingInstances: [], driftedInstances: [`${item.installedVersion} → ${item.latestVersion}`] };
      case "piPackage":
        return { kind: "piPackage", name: item.piPackage.name, missingInstances: ["not installed"], driftedInstances: [] };
    }
  });
}

export function formatStatusText(rows: StatusRow[]): string {
  if (rows.length === 0) return "Everything is in sync.";
  const lines = rows.map((r) => {
    const parts: string[] = [];
    if (r.missingInstances.length > 0) parts.push(`missing: ${r.missingInstances.join(", ")}`);
    if (r.driftedInstances.length > 0) parts.push(`drifted: ${r.driftedInstances.join(", ")}`);
    return `  [${r.kind}] ${r.name} — ${parts.join("; ")}`;
  });
  return [`${rows.length} item(s) need attention:`, ...lines].join("\n");
}

export function formatStatusJson(rows: StatusRow[]): string {
  return JSON.stringify({ total: rows.length, items: rows }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// list (full inventory)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListResult {
  plugins: Array<{ name: string; marketplace: string; installed: boolean; incomplete: boolean; hasUpdate?: boolean }>;
  skills: Array<{ name: string; namespace?: string; installations: Array<{ toolId: string; instanceId: string; drifted?: boolean }> }>;
  files: Array<{ name: string; kind: FileStatus["kind"]; instances: Array<{ toolId: string; instanceId: string; status: string }> }>;
  piPackages: Array<{ name: string; installed: boolean; hasUpdate?: boolean }>;
}

export function toListResult(
  plugins: Plugin[],
  skills: StandaloneSkill[],
  files: FileStatus[],
  piPackages: PiPackage[],
): ListResult {
  return {
    plugins: plugins.map((p) => ({ name: p.name, marketplace: p.marketplace, installed: p.installed, incomplete: p.incomplete ?? false, hasUpdate: p.hasUpdate })),
    skills: skills.map((s) => ({
      name: s.name,
      namespace: s.namespace,
      installations: s.installations.map((i) => ({ toolId: i.toolId, instanceId: i.instanceId, drifted: i.drifted })),
    })),
    files: files.map((f) => ({
      name: f.name,
      kind: f.kind,
      instances: f.instances.map((i) => ({ toolId: i.toolId, instanceId: i.instanceId, status: i.status })),
    })),
    piPackages: piPackages.map((p) => ({ name: p.name, installed: p.installed, hasUpdate: p.hasUpdate })),
  };
}

export function formatListText(result: ListResult): string {
  const lines: string[] = [];
  lines.push(`Plugins (${result.plugins.length}):`);
  for (const p of result.plugins) {
    lines.push(`  ${p.installed ? "✓" : "○"} ${p.name} (${p.marketplace})${p.incomplete ? " [incomplete]" : ""}${p.hasUpdate ? " [update available]" : ""}`);
  }
  lines.push(`Skills (${result.skills.length}):`);
  for (const s of result.skills) {
    const displayName = s.namespace ? `${s.namespace}/${s.name}` : s.name;
    lines.push(`  ${displayName} — ${s.installations.length} installation(s)`);
  }
  lines.push(`Files (${result.files.length}):`);
  for (const f of result.files) {
    lines.push(`  ${f.name} [${f.kind}] — ${f.instances.length} instance(s)`);
  }
  lines.push(`Pi packages (${result.piPackages.length}):`);
  for (const p of result.piPackages) {
    lines.push(`  ${p.installed ? "✓" : "○"} ${p.name}${p.hasUpdate ? " [update available]" : ""}`);
  }
  return lines.join("\n");
}

export function formatListJson(result: ListResult): string {
  return JSON.stringify(result, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// sync result
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncResultSummary {
  attempted: number;
  remaining: number;
  errors: string[];
}

export function formatSyncText(summary: SyncResultSummary): string {
  const lines = [`Synced ${summary.attempted - summary.remaining}/${summary.attempted} item(s).`];
  if (summary.remaining > 0) lines.push(`${summary.remaining} item(s) still need attention (re-run with --yes to force conflicts/untracked targets, or check errors).`);
  for (const e of summary.errors) lines.push(`  ✗ ${e}`);
  return lines.join("\n");
}

export function formatSyncJson(summary: SyncResultSummary): string {
  return JSON.stringify(summary, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// install/uninstall result
// ─────────────────────────────────────────────────────────────────────────────

export interface InstallResultSummary {
  name: string;
  kind: "plugin" | "skill";
  success: boolean;
  detail: string;
}

export function formatInstallText(summary: InstallResultSummary): string {
  return `${summary.success ? "✓" : "✗"} ${summary.name} — ${summary.detail}`;
}

export function formatInstallJson(summary: InstallResultSummary): string {
  return JSON.stringify(summary, null, 2);
}
