/**
 * Shared path utilities for resolving local marketplace/plugin source paths.
 */
import { existsSync, lstatSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Expand a `~`-prefixed path to an absolute path.
 * Returns the path unchanged if it doesn't start with `~`.
 */
export function expandTilde(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(1));
  return p;
}

/**
 * Normalize a URL/path string to an absolute file-system path.
 * Handles `file://` URLs, `~`-prefixed paths, and relative paths.
 * Returns null if the URL is a non-local remote URL.
 */
export function resolveLocalPath(urlOrPath: string, isLocal = false): string | null {
  if (!urlOrPath) return null;

  if (urlOrPath.startsWith("file://")) {
    try { return fileURLToPath(urlOrPath); } catch { return null; }
  }

  const looksLocal =
    isLocal ||
    urlOrPath.startsWith("/") ||
    urlOrPath.startsWith("~") ||
    urlOrPath.startsWith("./") ||
    urlOrPath.startsWith("../");

  if (!looksLocal && urlOrPath.includes("://")) return null;

  let normalized = expandTilde(urlOrPath);
  if (!normalized.startsWith("/")) normalized = resolve(process.cwd(), normalized);

  // If pointing at a file, return its directory
  if (existsSync(normalized) && lstatSync(normalized).isFile()) {
    normalized = dirname(normalized);
  }

  return normalized;
}
