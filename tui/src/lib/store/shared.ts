import type { Plugin, FileStatus, PiPackage } from "../types.js";
import { filesToManagedItems, piPackagesToManagedItems, pluginsToManagedItems } from "../managed-item.js";
import type { ManagedItem } from "../managed-item.js";
import type { Store } from "./types.js";

export function composeManagedItems(
  installedPlugins: Plugin[],
  files: FileStatus[],
  piPackages: PiPackage[],
): ManagedItem[] {
  return [
    ...pluginsToManagedItems(installedPlugins),
    ...filesToManagedItems(files),
    ...piPackagesToManagedItems(piPackages),
  ];
}

// Guards against double-triggering plugin/sync mutations. A user can press Enter
// twice before the first async operation resolves and the UI updates, which
// would otherwise run two overlapping installs/uninstalls/syncs against the same
// target — racing manifest writes, copying files twice, colliding backups.
// Keyed by target (plugin name, or a fixed key for the batch sync). Mirrors the
// `toolActionInProgress` single-flight guard used by the tool lifecycle actions.
export const pluginActionInFlight = new Set<string>();
export const SYNC_TOOLS_KEY = "__syncTools__";

/** Run fn with a spinner notification, clear it on completion. Returns fn's result. */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>,
  notifyFn: Store["notify"],
  clearFn: Store["clearNotification"],
): Promise<T> {
  const id = notifyFn(message, "info", { spinner: true });
  try {
    return await fn();
  } finally {
    clearFn(id);
  }
}
