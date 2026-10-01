import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { basename, join, relative } from "path";
import { commitLockFiles, findGitRoot } from "./lock-commit.js";
import { buildFileDiffTarget } from "./diff.js";
import type { DiffTarget } from "./types.js";

const execFileAsync = promisify(execFile);

export interface LockGitStatus {
  /** The file is inside a git repo. */
  isRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  /** The lock file exists on disk. */
  exists: boolean;
  /** Working-tree state of the lock file itself. */
  fileState: "clean" | "modified" | "untracked";
  hasUpstream: boolean;
  /**
   * Commits on HEAD not on the upstream that touch THIS lock file (a push would
   * send them). File-scoped on purpose: other unpushed commits in the same repo
   * must not make an untouched lock read "not pushed".
   */
  ahead: number;
  /** Commits on the upstream not on HEAD that touch THIS lock file (a pull would bring them). */
  behind: number;
}

async function git(repoRoot: string, args: string[], timeout = 10000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], { timeout });
  return stdout;
}

/** Git status of a single lock file and its repo (branch, file state, file-scoped ahead/behind). */
export async function lockGitStatus(filePath: string): Promise<LockGitStatus> {
  const exists = existsSync(filePath);
  const empty: LockGitStatus = { isRepo: false, repoRoot: null, branch: null, exists, fileState: "clean", hasUpstream: false, ahead: 0, behind: 0 };
  const repoRoot = findGitRoot(filePath.replace(/\/[^/]*$/, "") || "/");
  if (!repoRoot) return empty;

  let branch: string | null = null;
  try {
    branch = (await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null;
  } catch {
    return { ...empty, isRepo: true, repoRoot };
  }

  const rel = relative(repoRoot, filePath);

  let fileState: LockGitStatus["fileState"] = "clean";
  try {
    const porcelain = (await git(repoRoot, ["status", "--porcelain", "--", filePath])).trim();
    if (porcelain) fileState = porcelain.startsWith("??") ? "untracked" : "modified";
  } catch { /* leave clean */ }

  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  try {
    // Confirm an upstream exists, then count ONLY commits touching this file in
    // each direction — a repo-wide count would flag an untouched lock as "not
    // pushed" whenever anything else in the repo is unpushed.
    await git(repoRoot, ["rev-parse", "--verify", "@{u}"]);
    hasUpstream = true;
    const count = async (range: string): Promise<number> => {
      const out = (await git(repoRoot, ["rev-list", "--count", range, "--", rel])).trim();
      const n = parseInt(out, 10);
      return Number.isFinite(n) ? n : 0;
    };
    ahead = await count("@{u}..HEAD");
    behind = await count("HEAD..@{u}");
  } catch { /* no upstream */ }

  return { isRepo: true, repoRoot, branch, exists, fileState, hasUpstream, ahead, behind };
}

/**
 * Raw `git diff` for a lock file: its uncommitted changes, or — when the file
 * is clean but the branch is ahead — the committed-but-unpushed changes. Empty
 * string when there is nothing to show.
 */
export async function lockGitDiff(filePath: string): Promise<string> {
  const status = await lockGitStatus(filePath);
  if (!status.repoRoot) return "";
  try {
    if (status.fileState === "untracked") {
      // No HEAD side to diff against; show the file as all-added.
      return await git(status.repoRoot, ["diff", "--no-index", "--", "/dev/null", filePath]).catch((e: unknown) => {
        // --no-index exits non-zero when files differ; its stdout is on the error.
        const out = (e as { stdout?: string })?.stdout;
        return typeof out === "string" ? out : "";
      }) as string;
    }
    const working = (await git(status.repoRoot, ["diff", "--", filePath])).trim();
    if (working) return working;
    if (status.ahead > 0) return (await git(status.repoRoot, ["diff", "@{u}..HEAD", "--", filePath])).trim();
    return "";
  } catch {
    return "";
  }
}

export interface LockGitActionResult {
  ok: boolean;
  error?: string;
}

/**
 * A compact sync summary for a lock file, shared by the detail's status row and
 * the Projects/Profiles list hints so they always agree. `label` is Title Case
 * to match the skill detail ("In sync" / "Drifted"); the list lowercases it and
 * appends the counts.
 */
export interface LockSyncHint {
  state: "in-sync" | "drifted" | "untracked" | "ahead" | "behind" | "diverged" | "no-repo" | "no-lock";
  label: string;
  color: "green" | "yellow" | "gray" | "red" | "magenta";
  added: number;
  removed: number;
}

/** Map a lock's git status (+ diff counts) to the detail's status line. */
export function summarizeLockSync(s: LockGitStatus | null, added = 0, removed = 0): LockSyncHint {
  if (!s) return { state: "no-repo", label: "Checking…", color: "gray", added, removed };
  if (!s.exists) return { state: "no-lock", label: "No lock file", color: "gray", added, removed };
  if (!s.isRepo) return { state: "no-repo", label: "Not in a source repo", color: "gray", added, removed };
  if (s.fileState === "untracked") return { state: "untracked", label: "Not in source repo", color: "yellow", added, removed };
  if (s.fileState === "modified") return { state: "drifted", label: "Drifted", color: "yellow", added, removed };
  if (s.behind > 0 && s.ahead > 0) return { state: "diverged", label: "Diverged from source repo", color: "red", added, removed };
  if (s.ahead > 0) return { state: "ahead", label: "Not pushed to source repo", color: "yellow", added, removed };
  if (s.behind > 0) return { state: "behind", label: "Behind source repo", color: "magenta", added, removed };
  return { state: "in-sync", label: "In sync", color: "green", added, removed };
}

/** `git pull --ff-only` on the lock file's repo (bring teammate changes). */
export async function lockGitPull(filePath: string): Promise<LockGitActionResult> {
  const repoRoot = findGitRoot(filePath.replace(/\/[^/]*$/, "") || "/");
  if (!repoRoot) return { ok: false, error: "not a git repo" };
  try {
    await git(repoRoot, ["pull", "--ff-only"], 30000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

/** `git push` on the lock file's repo. */
export async function lockGitPush(filePath: string): Promise<LockGitActionResult> {
  const repoRoot = findGitRoot(filePath.replace(/\/[^/]*$/, "") || "/");
  if (!repoRoot) return { ok: false, error: "not a git repo" };
  try {
    await git(repoRoot, ["push"], 30000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

/** Commit the lock file's uncommitted changes (no push). */
export async function lockGitCommit(filePath: string, message: string): Promise<LockGitActionResult> {
  const result = await commitLockFiles([filePath], message, { push: false });
  return result.committed ? { ok: true } : { ok: false, error: "nothing to commit" };
}

/**
 * "Install from source repo" — the same move as a skill's sync, one level up:
 * make the on-disk lock match the source repo. Discards local edits (restores
 * the committed copy) and fast-forwards any newer commits from the repo. This
 * is the repo→disk direction.
 */
export async function lockInstallFromRepo(filePath: string): Promise<LockGitActionResult> {
  const status = await lockGitStatus(filePath);
  if (!status.repoRoot) return { ok: false, error: "not a source repo" };
  const rel = relative(status.repoRoot, filePath);
  try {
    // Untracked: nothing in the repo to restore from.
    if (status.fileState === "untracked") return { ok: false, error: "not yet in the source repo" };
    if (status.fileState === "modified") await git(status.repoRoot, ["checkout", "--", rel]);
    if (status.behind > 0) await git(status.repoRoot, ["pull", "--ff-only"], 30000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

/**
 * "Update source repo from disk" — the same move as a skill's pullback: push
 * the local lock up into the source repo. Commits the local edits (if any) and
 * pushes. This is the disk→repo direction.
 */
export async function lockUpdateSourceRepo(filePath: string, message: string): Promise<LockGitActionResult> {
  const status = await lockGitStatus(filePath);
  if (status.fileState !== "clean") {
    const committed = await lockGitCommit(filePath, message);
    if (!committed.ok) return committed;
  }
  return lockGitPush(filePath);
}


/**
 * A DiffTarget for a lock file so it renders through the same DiffDetail the
 * skill views use: source = the committed/upstream version (base, shown as "-"),
 * target = the working tree (head, local edits shown as "+"). Returns null when
 * the file isn't in a git repo. When there is no committed/upstream version yet,
 * the whole working file shows as added.
 */
export async function buildLockDiffTarget(filePath: string, title: string): Promise<DiffTarget | null> {
  const repoRoot = findGitRoot(filePath.replace(/\/[^/]*$/, "") || "/");
  if (!repoRoot) return null;
  const rel = relative(repoRoot, filePath);
  const instance = { toolId: "source", instanceId: "local", instanceName: "local", configDir: repoRoot };

  // Materialize the committed/upstream side to a temp file to diff against.
  let ref: string | null = null;
  try { await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--verify", "@{u}"], { timeout: 10000 }); ref = "@{u}"; }
  catch { try { await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], { timeout: 10000 }); ref = "HEAD"; } catch { ref = null; } }

  const dir = mkdtempSync(join(tmpdir(), "bb-lockdiff-"));
  const sourcePath = join(dir, basename(filePath));
  if (ref) {
    try {
      const { stdout } = await execFileAsync("git", ["-C", repoRoot, "show", `${ref}:${rel}`], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
      writeFileSync(sourcePath, stdout);
    } catch {
      // File not present at that ref (new, untracked): leave no source so it diffs as all-added.
      return buildFileDiffTarget(title, basename(filePath), join(dir, "__absent__"), filePath, instance);
    }
  } else {
    return buildFileDiffTarget(title, basename(filePath), join(dir, "__absent__"), filePath, instance);
  }
  return buildFileDiffTarget(title, basename(filePath), sourcePath, filePath, instance);
}
