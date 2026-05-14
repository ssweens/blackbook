/**
 * Unified Item Model — Phase 1 of Architecture Refactor
 *
 * Defines a single type hierarchy (`ManagedItem`) for everything Blackbook
 * manages: plugins, files, configs, assets, and Pi packages.  Adapter
 * functions convert the existing domain types (`Plugin`, `FileStatus`,
 * `PiPackage`) into `ManagedItem` so downstream generic components can
 * consume a single interface.
 *
 * This module is additive — existing types and components continue to work
 * unchanged.  Phases 2-4 will migrate list/detail/action code onto these
 * types.
 */

import type {
  Plugin,
  FileStatus,
  FileInstanceStatus,
  PiPackage,
  DriftKind,
} from "./types.js";
import type { ToolInstallStatus } from "./plugin-status.js";
import { getPluginToolStatus } from "./plugin-status.js";
import { getToolInstances } from "./config.js";
import { countPluginToManagedItem } from "./perf.js";

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/** The kind of managed entity. */
export type ItemKind = "plugin" | "file" | "config" | "asset" | "pi-package";

/** Per-tool-instance installation / drift status for one managed item. */
export interface ItemInstanceStatus {
  toolId: string;
  instanceId: string;
  instanceName: string;
  configDir: string;
  status: "synced" | "changed" | "missing" | "failed" | "not-installed" | "not-supported";
  driftKind?: DriftKind;
  sourcePath: string | null;
  targetPath: string | null;
  linesAdded: number;
  linesRemoved: number;
}

/** Unified model for anything Blackbook manages. */
export interface ManagedItem {
  /** Display name (e.g., plugin name, filename). */
  name: string;
  /** Entity kind — drives rendering and action dispatch. */
  kind: ItemKind;
  /** Source marketplace / origin label. */
  marketplace: string;
  /** Human-readable description. */
  description: string;
  /** Whether this item has at least one installed instance. */
  installed: boolean;
  /** Whether some (but not all) enabled+supported instances are installed. */
  incomplete: boolean;
  /** User vs project scope. */
  scope: "user" | "project";
  /** Per-tool-instance statuses — one entry per enabled tool instance. */
  instances: ItemInstanceStatus[];

  // ── Plugin-specific (populated only when kind === "plugin") ──────────
  skills?: string[];
  commands?: string[];
  agents?: string[];
  hooks?: string[];
  hasMcp?: boolean;
  hasLsp?: boolean;
  homepage?: string;
  source?: string | { source: string; url?: string; repo?: string; ref?: string };
  updatedAt?: Date;

  // ── File/config/asset-specific (populated only for those kinds) ──────
  fileSource?: string;     // raw source path from config
  fileTarget?: string;     // raw target path from config
  tools?: string[];        // which tools this file targets

  // ── Pi-package-specific (populated only when kind === "pi-package") ──
  version?: string;
  sourceType?: "npm" | "git" | "local";
  installedVersion?: string;
  hasUpdate?: boolean;
  installedVia?: import("./types.js").PackageManager;
  installedViaManagers?: import("./types.js").PackageManager[];
  managerMismatch?: boolean;
  preferredManager?: import("./types.js").PackageManager;
  extensions?: string[];
  prompts?: string[];
  themes?: string[];
  weeklyDownloads?: number;
  popularity?: number;
  author?: string;
  license?: string;
  repository?: string;

  // ── Original reference (for passing to existing functions) ───────────
  _plugin?: Plugin;
  _file?: FileStatus;
  _piPackage?: PiPackage;
  _skill?: import("./install.js").StandaloneSkill;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter: Plugin → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a `Plugin` (with optional tool statuses) into a `ManagedItem`.
 *
 * Tool statuses can be passed to avoid recomputation; if omitted they are
 * fetched via `getPluginToolStatus`.
 */
export function pluginToManagedItem(
  plugin: Plugin,
  toolStatuses?: ToolInstallStatus[],
): ManagedItem {
  countPluginToManagedItem();
  const statuses = toolStatuses ?? getPluginToolStatus(plugin);
  const allTools = getToolInstances();

  const instances: ItemInstanceStatus[] = statuses
    .filter((s) => s.enabled)
    .map((s) => {
      const tool = allTools.find(
        (t) => t.toolId === s.toolId && t.instanceId === s.instanceId,
      );
      let status: ItemInstanceStatus["status"];
      if (!s.supported) {
        status = "not-supported";
      } else if (!s.installed) {
        status = "not-installed";
      } else {
        status = "synced"; // default; drift overlay updates this later
      }

      return {
        toolId: s.toolId,
        instanceId: s.instanceId,
        instanceName: s.name,
        configDir: tool?.configDir ?? "",
        status,
        sourcePath: null,
        targetPath: null,
        linesAdded: 0,
        linesRemoved: 0,
      };
    });

  return {
    name: plugin.name,
    kind: "plugin",
    marketplace: plugin.marketplace,
    description: plugin.description,
    installed: plugin.installed,
    incomplete: plugin.incomplete ?? false,
    scope: plugin.scope,
    instances,
    // Plugin-specific
    skills: plugin.skills,
    commands: plugin.commands,
    agents: plugin.agents,
    hooks: plugin.hooks,
    hasMcp: plugin.hasMcp,
    hasLsp: plugin.hasLsp,
    homepage: plugin.homepage,
    source: plugin.source,
    updatedAt: plugin.updatedAt,
    // Original reference
    _plugin: plugin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter: FileStatus → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

function fileInstanceToItemInstance(fi: FileInstanceStatus): ItemInstanceStatus {
  let status: ItemInstanceStatus["status"];
  switch (fi.status) {
    case "ok":
      status = "synced";
      break;
    case "missing":
      status = "missing";
      break;
    case "drifted":
      status = "changed";
      break;
    case "failed":
      status = "failed";
      break;
    default:
      status = "failed";
  }

  // Extract line counts from diff string if available
  let linesAdded = 0;
  let linesRemoved = 0;
  if (fi.diff) {
    for (const line of fi.diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++;
      if (line.startsWith("-") && !line.startsWith("---")) linesRemoved++;
    }
  }

  return {
    toolId: fi.toolId,
    instanceId: fi.instanceId,
    instanceName: fi.instanceName,
    configDir: fi.configDir,
    status,
    driftKind: fi.driftKind,
    sourcePath: fi.sourcePath,
    targetPath: fi.targetPath,
    linesAdded,
    linesRemoved,
  };
}

/**
 * Convert a `FileStatus` into a `ManagedItem`.
 *
 * The `kind` field on `FileStatus` already distinguishes "file" from "config";
 * assets are files whose target is a directory or glob — the caller should pass
 * the appropriate `ItemKind` if they want "asset" vs "file".
 */
export function fileToManagedItem(
  file: FileStatus,
  kindOverride?: ItemKind,
): ManagedItem {
  const instances = file.instances.map(fileInstanceToItemInstance);
  const installed = instances.some((i) => i.status === "synced" || i.status === "changed");
  const incomplete = installed && instances.some((i) => i.status === "missing");

  return {
    name: file.name,
    kind: kindOverride ?? (file.kind === "config" ? "config" : "file"),
    marketplace: "local",
    description: `${file.source} → ${file.target}`,
    installed,
    incomplete,
    scope: "user",
    instances,
    // File-specific
    fileSource: file.source,
    fileTarget: file.target,
    tools: file.tools,
    // Original reference
    _file: file,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter: PiPackage → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a `PiPackage` into a `ManagedItem`.
 *
 * Pi packages don't have per-instance status (they install globally into
 * `~/.pi/`), so `instances` is a single-element array representing Pi.
 */
export function piPackageToManagedItem(pkg: PiPackage): ManagedItem {
  const instances: ItemInstanceStatus[] = [{
    toolId: "pi",
    instanceId: "pi",
    instanceName: "Pi",
    configDir: "~/.pi",
    status: pkg.installed ? "synced" : "not-installed",
    sourcePath: null,
    targetPath: null,
    linesAdded: 0,
    linesRemoved: 0,
  }];

  return {
    name: pkg.name,
    kind: "pi-package",
    marketplace: pkg.marketplace,
    description: pkg.description,
    installed: pkg.installed,
    incomplete: false,
    scope: "user",
    instances,
    // Pi-package-specific
    version: pkg.version,
    source: pkg.source,
    sourceType: pkg.sourceType,
    installedVersion: pkg.installedVersion,
    hasUpdate: pkg.hasUpdate,
    installedVia: pkg.installedVia,
    installedViaManagers: pkg.installedViaManagers,
    managerMismatch: pkg.managerMismatch,
    preferredManager: pkg.preferredManager,
    extensions: pkg.extensions,
    skills: pkg.skills,
    prompts: pkg.prompts,
    themes: pkg.themes,
    weeklyDownloads: pkg.weeklyDownloads,
    popularity: pkg.popularity,
    author: pkg.author,
    license: pkg.license,
    repository: pkg.repository,
    homepage: pkg.homepage,
    // Original reference
    _piPackage: pkg,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Conversion Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert an array of plugins to managed items. */
export function pluginsToManagedItems(plugins: Plugin[]): ManagedItem[] {
  return plugins.map((p) => pluginToManagedItem(p));
}

/** Convert an array of file statuses to managed items. */
export function filesToManagedItems(files: FileStatus[]): ManagedItem[] {
  return files.map((f) => fileToManagedItem(f));
}

/** Convert an array of Pi packages to managed items. */
export function piPackagesToManagedItems(packages: PiPackage[]): ManagedItem[] {
  return packages.map((p) => piPackageToManagedItem(p));
}
