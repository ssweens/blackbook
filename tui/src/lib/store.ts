import { create } from "zustand";
import { existsSync, watch } from "fs";
import { ensureConfigExists, getConfigPath, getCacheDir } from "./config.js";
import { pullSourceRepo, primeSourceRepoStatus } from "./source-setup.js";
import { manifestPath } from "./install.js";
import type { Notification } from "./types.js";
import { countStoreUpdate } from "./perf.js";

import { createUiSlice } from "./store/ui-slice.js";
import { createToolsSlice } from "./store/tools-slice.js";
import { createPluginsSlice } from "./store/plugins-slice.js";
import { createPiSlice } from "./store/pi-slice.js";
import { createFilesSlice } from "./store/files-slice.js";

export type { Store } from "./store/types.js";
export type { InstallStatus } from "./plugin-merge.js";
export { withSpinner } from "./store/shared.js";

/**
 * The store is composed from cohesive slices (see ./store/*-slice.ts). Each slice
 * is a `(set, get) => ({ ...state, ...actions })` creator; this module wires the
 * wrapped `set` (which increments the render-perf counter) into each one and
 * spreads them into a single zustand store. The public store shape — every state
 * field and action — is defined by ./store/types.ts and unchanged by the split.
 */
export const useStore = create<import("./store/types.js").Store>((rawSet, get) => {
  const set: typeof rawSet = (arg) => {
    countStoreUpdate();
    return rawSet(arg as any);
  };
  return {
    ...createUiSlice(set, get),
    ...createToolsSlice(set, get),
    ...createPluginsSlice(set, get),
    ...createPiSlice(set, get),
    ...createFilesSlice(set, get),
  };
});

let watchersStarted = false;
let refreshTimer: NodeJS.Timeout | null = null;

function scheduleRefresh(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refresh().catch((error) => {
      notify(`Failed to refresh after file change: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, 250);
}

function startFileWatchers(refresh: () => Promise<void>, notify: (message: string, type?: Notification["type"]) => void): void {
  if (watchersStarted) return;
  watchersStarted = true;

  const configPath = getConfigPath();
  const cacheDir = getCacheDir();
  const manifestFile = manifestPath();

  try {
    if (existsSync(configPath)) {
      watch(configPath, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch config file: ${error instanceof Error ? error.message : String(error)}`, "error");
  }

  try {
    if (existsSync(cacheDir)) {
      watch(cacheDir, { persistent: false }, (event, filename) => {
        if (filename && filename.toString() === "installed_items.json") {
          scheduleRefresh(refresh, notify);
        }
      });
    } else if (existsSync(manifestFile)) {
      watch(manifestFile, { persistent: false }, () => scheduleRefresh(refresh, notify));
    }
  } catch (error) {
    notify(`Failed to watch cache directory: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

export async function initializeStore(): Promise<void> {
  ensureConfigExists();
  // Pull source repo before any data loads so skills/files reflect the latest.
  await pullSourceRepo();
  // Prime source repo status cache during startup so Settings tab renders immediately.
  void primeSourceRepoStatus();
}
