/**
 * BLACKBOOK PATCH — central skill store.
 *
 * Upstream keeps a project's real skill files in `<project>/.agents/skills`.
 * In this vendored copy, project-scope installs keep them in one central
 * store instead, namespaced by source, and `<project>/.agents/skills/<name>`
 * (plus each non-universal agent dir, e.g. `.claude/skills/<name>`) becomes a
 * symlink into it:
 *
 *   $SKILLS_STORE_DIR                  (default: $XDG_DATA_HOME/blackbook/skills,
 *                                        i.e. ~/.local/share/blackbook/skills)
 *     github.com/<owner>/<repo>/<skill>
 *     gitlab.com/<group>/<repo>/<skill>
 *     <host>/<path>/<skill>             generic git, well-known, direct download
 *     local/<absolute/source/path>/<skill>
 *     node_modules/<package>/<skill>
 *
 * There is exactly one copy per (source, skill): refs/branches are not part of
 * the key, so every project shares the same version. Global installs (`-g`)
 * are unchanged and still use `~/.agents/skills`.
 */
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';

export function getStoreRoot(): string {
  const override = process.env.SKILLS_STORE_DIR;
  if (override) return resolve(override);
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'blackbook', 'skills');
}

/** Hosts whose repo paths are case-insensitive, so the key is lowercased. */
const CASE_INSENSITIVE_HOSTS = new Set(['github.com', 'gitlab.com']);

function safeSegments(segments: string[]): string[] {
  return segments
    .filter((s) => s.length > 0)
    .map((s) => (s === '.' || s === '..' ? '_' : s.replace(/[^A-Za-z0-9._@+-]/g, '_')));
}

/**
 * `https://github.com/Owner/Repo.git`, `git@github.com:owner/repo.git`,
 * `ssh://git@host:2222/group/repo.git`, `https://example.com/docs?x=1` →
 * `host[/port]/path` with `.git`, query, fragment, and credentials removed.
 */
export function urlStoreKey(url: string): string {
  const raw = url.trim();
  let host: string;
  let path: string;

  const scheme = raw.match(/^[a-z][a-z0-9+.-]*:\/\//i);
  if (scheme) {
    const u = new URL(raw);
    host = u.hostname.toLowerCase() + (u.port ? `/${u.port}` : '');
    path = decodeURIComponent(u.pathname);
  } else {
    // scp-like git: [user@]host:path
    const scp = raw.match(/^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/);
    if (!scp) throw new Error(`Cannot derive a store key from source URL: ${url}`);
    host = scp[1]!.toLowerCase();
    path = scp[2]!;
  }

  path = path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (CASE_INSENSITIVE_HOSTS.has(host)) path = path.toLowerCase();
  return safeSegments([...host.split('/'), ...path.split('/')]).join('/');
}

/** `/Users/me/src/playbook` → `local/Users/me/src/playbook` (Windows: `local/C/...`). */
export function localStoreKey(localPath: string): string {
  const abs = resolve(localPath);
  const parts = abs.split(sep).map((p) => p.replace(/:$/, ''));
  return safeSegments(['local', ...parts]).join('/');
}

export function nodeModulesStoreKey(packageName: string): string {
  return safeSegments(['node_modules', ...packageName.split('/')]).join('/');
}

export type StoreKeySource =
  | { type: 'github' | 'gitlab' | 'git' | 'well-known' | 'download'; url: string }
  | { type: 'local'; url: string; localPath?: string }
  | { type: 'node_modules'; packageName: string };

/** The store namespace for a source. Every install method that writes files goes through this. */
export function getStoreKey(source: StoreKeySource): string {
  switch (source.type) {
    case 'local':
      return localStoreKey(source.localPath ?? source.url);
    case 'node_modules':
      return nodeModulesStoreKey(source.packageName);
    default:
      return urlStoreKey(source.url);
  }
}

/** Absolute store directory for a source namespace. */
export function getStoreDir(storeKey: string): string {
  return join(getStoreRoot(), storeKey);
}

/** True if `path` is inside the store (used to make store symlinks absolute). */
export function isInStore(path: string): boolean {
  const root = getStoreRoot();
  const abs = resolve(path);
  return abs === root || abs.startsWith(root + sep);
}

/**
 * BLACKBOOK PATCH — dev shortcuts.
 *
 * `SKILLS_DEV_SHORTCUTS` is a machine-local JSON map from a repo to a local
 * checkout, e.g. `{"github.com/ssweens/playbook": "~/src/playbook"}` (Blackbook
 * passes it from its config). When a git source's store key matches exactly,
 * skills are discovered in that checkout instead of fetched, and the store
 * entry is a symlink into it (live edits, no push/update). Lockfiles and store
 * keys still record the original source, so nothing machine-specific leaks.
 * Keys may be any repo form (`owner/repo` means GitHub). A missing checkout
 * falls back to the normal fetch.
 */
export function getDevShortcut(storeKey: string): string | null {
  const raw = process.env.SKILLS_DEV_SHORTCUTS;
  if (!raw) return null;
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string' || !value) continue;
    let keyStore: string;
    try {
      const repo = key.trim();
      keyStore = /^[\w.-]+\/[\w.-]+$/.test(repo) ? urlStoreKey(`https://github.com/${repo}`) : urlStoreKey(repo.includes('://') || repo.includes('@') ? repo : `https://${repo}`);
    } catch {
      continue;
    }
    if (keyStore !== storeKey) continue;
    const dir = resolve(value.startsWith('~') ? join(homedir(), value.slice(1)) : value);
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
    } catch {
      /* fall through */
    }
    return null;
  }
  return null;
}
