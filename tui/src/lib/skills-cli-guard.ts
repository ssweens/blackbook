/**
 * Blackbook yields to the skills CLI (vendor/skills) for anything it manages.
 *
 * A skill the CLI installed is a symlink into the central store
 * (`$XDG_DATA_HOME/blackbook/skills`), in `~/.agents/skills/<name>`,
 * `~/.claude/skills/<name>`, or a project's agent dirs. Blackbook's own
 * install, sync, and uninstall paths must never overwrite, re-copy beside, or
 * delete those: one manager per skill.
 */
import { lstatSync, readlinkSync, realpathSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve, sep } from "path";
import { getDataDir } from "./config/path.js";

function storeRoot(): string {
  const root = process.env.SKILLS_STORE_DIR ? resolve(process.env.SKILLS_STORE_DIR) : join(getDataDir(), "skills");
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/** `path` is a symlink whose target lies inside the central store (dangling links count too). */
export function isStoreLink(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  const root = storeRoot();
  try {
    return isUnder(realpathSync(path), root);
  } catch {
    const raw = readlinkSync(path);
    const target = isAbsolute(raw) ? raw : resolve(dirname(path), raw);
    return isUnder(target, root) || isUnder(target, resolve(root));
  }
}

/** `path`, or any ancestor of it below the home dir, is a store link. */
export function isCliManagedPath(path: string): boolean {
  const home = homedir();
  let current = resolve(path);
  while (current.startsWith(home + sep)) {
    if (isStoreLink(current)) return true;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

/** The skills CLI owns a global skill of this name (`~/.agents/skills/<name>` is a store link). */
export function isCliManagedGlobalSkill(name: string): boolean {
  return isStoreLink(join(homedir(), ".agents", "skills", name));
}
