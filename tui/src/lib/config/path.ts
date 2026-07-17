import { homedir } from "os";
import { join } from "path";

export function expandPath(pathValue: string): string {
  let expanded: string;
  if (pathValue === "~") expanded = homedir();
  else if (pathValue.startsWith("~/")) expanded = join(homedir(), pathValue.slice(2));
  else expanded = pathValue;
  // Strip trailing separator(s) so path-equality checks (e.g. project
  // registration dedup) treat "/foo" and "/foo/" as the same path. Never
  // strip all the way down to empty (e.g. the root "/" itself).
  const trimmed = expanded.replace(/[/\\]+$/, "");
  return trimmed.length > 0 ? trimmed : expanded;
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  const base = xdgConfig || join(homedir(), ".config");
  return join(base, "blackbook");
}

export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const base = xdgCache || join(homedir(), ".cache");
  return join(base, "blackbook");
}

/**
 * Resolve a source path. Supports:
 * - Absolute paths (start with /)
 * - Home-relative paths (start with ~)
 * - URLs (http:// or https://) — pass through unchanged
 * - Relative paths (resolved against source_repo)
 */
export function resolveSourcePath(source: string, sourceRepo: string | undefined): string {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }
  if (source.startsWith("/") || source.startsWith("~")) {
    return expandPath(source);
  }
  if (sourceRepo) {
    return join(expandPath(sourceRepo), source);
  }
  return expandPath(source);
}
