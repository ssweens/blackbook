import { execFile } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Nearest ancestor of `dir` (inclusive) that contains a `.git`, or null. */
export function findGitRoot(dir: string): string | null {
  let current = dir;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface LockCommitResult {
  /** The repo held no changes to the given paths, or wasn't a git repo. */
  committed: boolean;
  pushed: boolean;
  /** Set when the commit landed locally but the push failed. */
  pushError?: string;
}

/**
 * Stage and commit specific lock-file paths in their git repo — only those
 * paths, never `-A` — and optionally push. Async (git runs off the event loop)
 * so a slow push never freezes the TUI. Best-effort: a missing repo, nothing to
 * commit, or a failed push is non-fatal and reported, never thrown. Deletions
 * are committed too, since `git add <path>` stages a removed tracked file.
 */
export async function commitLockFiles(
  paths: string[],
  message: string,
  opts: { push?: boolean } = {},
): Promise<LockCommitResult> {
  if (paths.length === 0) return { committed: false, pushed: false };
  // The paths share a repo; resolve it from the first path's directory, which
  // exists even when the file itself was just deleted.
  const repoRoot = findGitRoot(dirname(paths[0]));
  if (!repoRoot) return { committed: false, pushed: false };

  try {
    for (const p of paths) {
      await execFileAsync("git", ["-C", repoRoot, "add", "--", p], { timeout: 10000 });
    }
    await execFileAsync("git", ["-C", repoRoot, "commit", "-m", message, "--", ...paths], { timeout: 10000 });
  } catch {
    // Nothing staged for these paths, or not a commit-able state. The file
    // write already succeeded; there is nothing to push. Non-fatal.
    return { committed: false, pushed: false };
  }

  if (opts.push === false) return { committed: true, pushed: false };
  try {
    await execFileAsync("git", ["-C", repoRoot, "push"], { timeout: 30000 });
  } catch (error) {
    return { committed: true, pushed: false, pushError: error instanceof Error ? error.message : String(error) };
  }
  return { committed: true, pushed: true };
}
