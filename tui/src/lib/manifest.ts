/**
 * Manifest file management for tracking installed plugin components
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { InstalledItem } from "./types.js";
import { getCacheDir } from "./config.js";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";

export interface Manifest {
  tools: Record<string, { items: Record<string, InstalledItem> }>;
}

export function manifestPath(cacheDir?: string): string {
  return join(cacheDir || getCacheDir(), "installed_items.json");
}

export function loadManifest(cacheDir?: string): Manifest {
  const path = manifestPath(cacheDir);
  if (!existsSync(path)) return { tools: {} };
  return withFileLockSync(path, () => {
    const content = readFileSync(path, "utf-8");
    try {
      return JSON.parse(content);
    } catch (error) {
      const message = `Manifest file is corrupted at ${path}: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(message);
    }
  });
}

export function saveManifest(manifest: Manifest, cacheDir?: string): void {
  const path = manifestPath(cacheDir);
  withFileLockSync(path, () => {
    atomicWriteFileSync(path, JSON.stringify(manifest, null, 2));
  });
}
