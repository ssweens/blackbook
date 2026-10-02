import { existsSync } from "fs";
import { join } from "path";
import { hashDirectory } from "./modules/hash.js";
import { agentsSkillsRoot } from "./path-utils.js";
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
  /** Listed but not present in the agent skills directory (and installable). */
  missing: number;
  /** Present but their content differs from the source (only checked where a source path is known). */
  drifted: number;
  /** Listed from the configured source repo, but that repo no longer has the skill — can't be installed. */
  unresolvable: number;
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

/** The shared agent skills directory every tool reads via the ~/.agents overlay (see path-utils). */
export function agentSkillsDir(): string {
  return agentsSkillsRoot();
}

/** Two GitHub sources name the same repo (owner/repo, github: prefix, https URL, .git suffix, case). */
export function sameGithubSource(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/^github:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  return norm(a) === norm(b);
}

/** The actual skill names behind an install-sync comparison. */
export interface LockInstallGap {
  /** All skills the lock lists. */
  all: string[];
  /** Listed but not present on disk in the agent skills directory, and installable. */
  missing: string[];
  /** Present but their content differs from the source (only where a source path is known). */
  drifted: string[];
  /**
   * Listed from the configured source repo, not on disk, and the source repo
   * has no such skill any more — an install can never satisfy these. The
   * profile needs editing (remove or re-point the skill).
   */
  unresolvable: string[];
}

/**
 * The missing/drifted/unresolvable skill NAMES for a lock vs an agent skills
 * directory. `missing` = not on disk but installable; `drifted` = on disk but
 * content differs from the source; `unresolvable` = sourced from the
 * configured source repo (`repoSource`, e.g. "ssweens/playbook") yet absent
 * from that repo's skill index — the skill was removed or renamed upstream.
 * An install must (re)install missing ∪ drifted; it cannot do anything about
 * unresolvable, so they are reported separately and never silently "missing".
 */
export function lockInstallGap(
  skills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
  repoSource?: string,
): LockInstallGap {
  const all = Object.keys(skills);
  const missing: string[] = [];
  const drifted: string[] = [];
  const unresolvable: string[] = [];
  for (const name of all) {
    const installed = join(installedDir, name);
    if (!existsSync(installed)) {
      const entry = skills[name];
      const fromRepo = !!repoSource && entry.sourceType === "github" && sameGithubSource(entry.source, repoSource);
      if (fromRepo && !sourceIndex.has(name)) unresolvable.push(name);
      else missing.push(name);
      continue;
    }
    const src = sourceIndex.get(name);
    if (src) {
      try { if (hashDirectory(installed) !== hashDirectory(src)) drifted.push(name); }
      catch { drifted.push(name); }
    }
  }
  return { all, missing, drifted, unresolvable };
}

/**
 * THE install plan: the skills an install/apply must (re)install to make the
 * agent skills directory match the lock — everything missing on disk plus
 * everything drifted. Unresolvable skills are excluded (nothing can install
 * them). Pure and synchronous. Both `P` apply (Projects) and `Enter → Apply`
 * (Profiles) use this one function, so they can never disagree.
 */
export function planInstall(
  skills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
  repoSource?: string,
): string[] {
  const gap = lockInstallGap(skills, installedDir, sourceIndex, repoSource);
  return [...gap.missing, ...gap.drifted];
}

/**
 * Compare a lock's skills to what's installed in an agent skills directory.
 * Third-party sources without a local source path are judged on presence
 * alone; source-repo skills that no longer exist upstream are `unresolvable`.
 */
export function compareLockToInstall(
  skills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
  repoSource?: string,
): LockInstallHint {
  const gap = lockInstallGap(skills, installedDir, sourceIndex, repoSource);
  const counts = { total: gap.all.length, missing: gap.missing.length, drifted: gap.drifted.length, unresolvable: gap.unresolvable.length };
  if (gap.all.length === 0) return { state: "empty", label: "Empty", color: "gray", ...counts };
  if (counts.missing === 0 && counts.drifted === 0 && counts.unresolvable === 0) {
    return { state: "in-sync", label: "In sync", color: "green", ...counts };
  }
  return {
    state: "out-of-sync",
    label: "Out of sync",
    color: counts.missing > 0 || counts.unresolvable > 0 ? "red" : "yellow",
    ...counts,
  };
}

/** "N missing, M drifted, K not in source repo" — the shared breakdown used by every surface. */
export function lockInstallBreakdown(h: Pick<LockInstallHint, "missing" | "drifted" | "unresolvable">): string {
  return [
    h.missing > 0 ? `${h.missing} missing` : "",
    h.drifted > 0 ? `${h.drifted} drifted` : "",
    h.unresolvable > 0 ? `${h.unresolvable} not in source repo` : "",
  ].filter(Boolean).join(", ");
}

/** Compact list-row rendering: "in sync" / "out of sync · 4 missing" / "out of sync · 1 not in source repo" / "empty". */
export function lockInstallText(hint: LockInstallHint | undefined): { text: string; color: string } {
  if (!hint) return { text: "checking…", color: "gray" };
  if (hint.state === "empty") return { text: "empty", color: "gray" };
  if (hint.state === "in-sync") return { text: "in sync", color: "green" };
  return { text: `out of sync · ${lockInstallBreakdown(hint)}`, color: hint.color };
}
