import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { hashDirectory } from "./modules/hash.js";
import type { LockEntry } from "./skill-profiles.js";

/**
 * The real "in sync" the user cares about for a profile or project: does what's
 * actually installed in the agent's skills directory match the skill lock? This
 * is NOT about whether the lock file is committed to git — a lock can be
 * perfectly committed yet point at skills that were never installed, which is
 * exactly "out of sync".
 */
export interface LockInstallHint {
  state: "in-sync" | "out-of-sync" | "empty";
  /** Title Case for the detail; the list lowercases it. */
  label: string;
  color: "green" | "yellow" | "red" | "gray";
  /** Skills listed in the lock. */
  total: number;
  /** Listed but not present in the agent skills directory. */
  missing: number;
  /** Present but their content differs from the source (only checked where a source path is known). */
  drifted: number;
}

/** One lock to check: its stable key, the skills it lists, and where they should be installed. */
export interface LockSyncTarget {
  /** Stable identity used as the store key and the render lookup (e.g. the lock file path). */
  key: string;
  /** The lock's skills (already read; profiles have these in memory, projects read them once). */
  skills: Record<string, LockEntry>;
  /** The agent skills directory to compare against. */
  installedDir: string;
}

/** The shared agent skills directory every tool reads via the ~/.agents overlay. */
export function agentSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

/** The actual skill names behind an install-sync comparison. */
export interface LockInstallGap {
  /** All skills the lock lists. */
  all: string[];
  /** Listed but not present on disk in the agent skills directory. */
  missing: string[];
  /** Present but their content differs from the source (only where a source path is known). */
  drifted: string[];
}

/**
 * The missing/drifted skill NAMES for a lock vs an agent skills directory.
 * `missing` = not on disk; `drifted` = on disk but content differs from the
 * source. This is the set an install must (re)install to reconcile the agent
 * skills directory to the lock.
 */
export function lockInstallGap(
  skills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
): LockInstallGap {
  const all = Object.keys(skills);
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const name of all) {
    const installed = join(installedDir, name);
    if (!existsSync(installed)) { missing.push(name); continue; }
    const src = sourceIndex.get(name);
    if (src) {
      try { if (hashDirectory(installed) !== hashDirectory(src)) drifted.push(name); }
      catch { drifted.push(name); }
    }
  }
  return { all, missing, drifted };
}

/**
 * Compare a lock's skills to what's installed in an agent skills directory.
 * `missing` counts skills the lock lists that aren't on disk; `drifted` counts
 * installed skills whose content no longer matches the source (only where a
 * source path is known — third-party sources without a local source path are
 * judged on presence alone).
 */
export function compareLockToInstall(
  skills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
): LockInstallHint {
  const gap = lockInstallGap(skills, installedDir, sourceIndex);
  if (gap.all.length === 0) {
    return { state: "empty", label: "Empty", color: "gray", total: 0, missing: 0, drifted: 0 };
  }
  if (gap.missing.length === 0 && gap.drifted.length === 0) {
    return { state: "in-sync", label: "In sync", color: "green", total: gap.all.length, missing: 0, drifted: 0 };
  }
  return {
    state: "out-of-sync",
    label: "Out of sync",
    color: gap.missing.length > 0 ? "red" : "yellow",
    total: gap.all.length,
    missing: gap.missing.length,
    drifted: gap.drifted.length,
  };
}

/** Compact list-row rendering: "in sync" / "out of sync · 4 missing" / "out of sync · 2 drifted". */
export function lockInstallText(hint: LockInstallHint | undefined): { text: string; color: string } {
  if (!hint) return { text: "checking…", color: "gray" };
  if (hint.state === "empty") return { text: "empty lock", color: "gray" };
  if (hint.state === "in-sync") return { text: "in sync", color: "green" };
  const parts: string[] = [];
  if (hint.missing > 0) parts.push(`${hint.missing} missing`);
  if (hint.drifted > 0) parts.push(`${hint.drifted} drifted`);
  return { text: `out of sync · ${parts.join(", ")}`, color: hint.color };
}
