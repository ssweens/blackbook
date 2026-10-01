import { execFile } from "child_process";
import { promisify } from "util";
import { commitLockFiles, findGitRoot } from "./lock-commit.js";

const execFileAsync = promisify(execFile);

export interface LockGitStatus {
  /** The file is inside a git repo. */
  isRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  /** Working-tree state of the lock file itself. */
  fileState: "clean" | "modified" | "untracked";
  hasUpstream: boolean;
  /** Local commits not on the upstream (need a push). */
  ahead: number;
  /** Upstream commits not local (a pull would bring them). */
  behind: number;
}

async function git(repoRoot: string, args: string[], timeout = 10000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], { timeout });
  return stdout;
}

/** Git status of a single lock file and its repo (branch, file state, ahead/behind). */
export async function lockGitStatus(filePath: string): Promise<LockGitStatus> {
  const empty: LockGitStatus = { isRepo: false, repoRoot: null, branch: null, fileState: "clean", hasUpstream: false, ahead: 0, behind: 0 };
  const repoRoot = findGitRoot(filePath.replace(/\/[^/]*$/, "") || "/");
  if (!repoRoot) return empty;

  let branch: string | null = null;
  try {
    branch = (await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null;
  } catch {
    return { ...empty, isRepo: true, repoRoot };
  }

  let fileState: LockGitStatus["fileState"] = "clean";
  try {
    const porcelain = (await git(repoRoot, ["status", "--porcelain", "--", filePath])).trim();
    if (porcelain) fileState = porcelain.startsWith("??") ? "untracked" : "modified";
  } catch { /* leave clean */ }

  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await git(repoRoot, ["rev-list", "--left-right", "--count", "@{u}...HEAD"])).trim();
    const [b, a] = counts.split(/\s+/).map((n) => parseInt(n, 10));
    hasUpstream = true;
    behind = Number.isFinite(b) ? b : 0;
    ahead = Number.isFinite(a) ? a : 0;
  } catch { /* no upstream */ }

  return { isRepo: true, repoRoot, branch, fileState, hasUpstream, ahead, behind };
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
