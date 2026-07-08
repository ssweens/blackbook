import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// pullSourceRepo reads config.settings.source_repo via the loader. Point it at a
// temp repo we control per test.
let mockSourceRepo: string | undefined;
vi.mock("./config/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/loader.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      config: { settings: { source_repo: mockSourceRepo }, files: [], tools: {}, plugins: {}, configs: [], marketplaces: {}, pi_packages: [] },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    })),
  };
});

import { planSourceRepoUpdate, pullSourceRepo } from "./source-setup.js";
import { commitAndPushSourceRepo } from "./install.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: GIT_ENV }).trim();
}

function headSha(repo: string): string {
  return git(repo, "rev-parse", "HEAD");
}

let scratch: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}

/**
 * Build a bare "origin" plus a local clone with one commit on `main`.
 * Returns { remote, work, local } where `work` is a second clone used to push
 * new commits into the remote (simulating other machines / teammates).
 */
function setupRepoPair(): { remote: string; work: string; local: string } {
  const remote = mkTmp("bb-remote-");
  rmSync(remote, { recursive: true, force: true });
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare", "-b", "main");

  const work = mkTmp("bb-work-");
  rmSync(work, { recursive: true, force: true });
  git(tmpdir(), "clone", remote, work);
  writeFileSync(join(work, "a.txt"), "one\n");
  git(work, "add", "a.txt");
  git(work, "commit", "-m", "initial");
  git(work, "branch", "-M", "main");
  git(work, "push", "-u", "origin", "main");

  const local = mkTmp("bb-local-");
  rmSync(local, { recursive: true, force: true });
  git(tmpdir(), "clone", remote, local);

  return { remote, work, local };
}

/** Push a new commit into the remote so `local` becomes behind after fetching. */
function advanceRemote(work: string): void {
  writeFileSync(join(work, "b.txt"), "two\n");
  git(work, "add", "b.txt");
  git(work, "commit", "-m", "remote commit");
  git(work, "push", "origin", "main");
}

afterEach(() => {
  for (const d of scratch) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  scratch = [];
  mockSourceRepo = undefined;
  vi.clearAllMocks();
});

describe("planSourceRepoUpdate", () => {
  it("clean + behind → fast-forward", async () => {
    const { work, local } = setupRepoPair();
    advanceRemote(work);
    git(local, "fetch", "origin");

    const plan = await planSourceRepoUpdate(local);
    expect(plan).toEqual({ action: "fast-forward", reason: "up-to-date", branch: "main" });
  });

  it("clean + up to date → fast-forward (no-op)", async () => {
    const { local } = setupRepoPair();
    git(local, "fetch", "origin");
    const plan = await planSourceRepoUpdate(local);
    expect(plan.action).toBe("fast-forward");
  });

  it("dirty working tree → skip (never resets)", async () => {
    const { work, local } = setupRepoPair();
    advanceRemote(work);
    git(local, "fetch", "origin");
    writeFileSync(join(local, "a.txt"), "locally edited\n");

    const plan = await planSourceRepoUpdate(local);
    expect(plan).toEqual({ action: "skip", reason: "dirty", branch: "main" });
  });

  it("untracked local file → skip dirty", async () => {
    const { work, local } = setupRepoPair();
    advanceRemote(work);
    git(local, "fetch", "origin");
    writeFileSync(join(local, "scratch.txt"), "unsaved\n");

    const plan = await planSourceRepoUpdate(local);
    expect(plan.reason).toBe("dirty");
    expect(plan.action).toBe("skip");
  });

  it("local commits ahead of origin → skip (never discards commits)", async () => {
    const { local } = setupRepoPair();
    writeFileSync(join(local, "local-only.txt"), "unpushed\n");
    git(local, "add", "local-only.txt");
    git(local, "commit", "-m", "local only commit");
    git(local, "fetch", "origin");

    const plan = await planSourceRepoUpdate(local);
    expect(plan).toEqual({ action: "skip", reason: "local-commits", branch: "main" });
  });

  it("detached HEAD → skip", async () => {
    const { local } = setupRepoPair();
    git(local, "checkout", "--detach", "HEAD");
    const plan = await planSourceRepoUpdate(local);
    expect(plan).toEqual({ action: "skip", reason: "detached-head" });
  });

  it("branch with no upstream → skip", async () => {
    const { local } = setupRepoPair();
    git(local, "checkout", "-b", "feature");
    const plan = await planSourceRepoUpdate(local);
    expect(plan).toEqual({ action: "skip", reason: "no-upstream", branch: "feature" });
  });
});

describe("pullSourceRepo", () => {
  it("clean + behind → fast-forwards to origin", async () => {
    const { work, local } = setupRepoPair();
    advanceRemote(work);
    const remoteHead = headSha(work);
    mockSourceRepo = local;

    const plan = await pullSourceRepo();

    expect(plan.action).toBe("fast-forward");
    expect(headSha(local)).toBe(remoteHead);
    expect(existsSync(join(local, "b.txt"))).toBe(true);
  });

  it("dirty working tree → does NOT reset, leaves files untouched", async () => {
    const { work, local } = setupRepoPair();
    advanceRemote(work);
    const localHeadBefore = headSha(local);
    writeFileSync(join(local, "a.txt"), "precious local edit\n");
    mockSourceRepo = local;

    const plan = await pullSourceRepo();

    expect(plan.reason).toBe("dirty");
    expect(headSha(local)).toBe(localHeadBefore); // no fast-forward
    expect(readFileSync(join(local, "a.txt"), "utf-8")).toBe("precious local edit\n");
    expect(existsSync(join(local, "b.txt"))).toBe(false); // did not pull remote commit
  });

  it("local commits ahead of origin → does NOT reset, keeps commits", async () => {
    const { local } = setupRepoPair();
    writeFileSync(join(local, "local-only.txt"), "unpushed work\n");
    git(local, "add", "local-only.txt");
    git(local, "commit", "-m", "unpushed local commit");
    const localHead = headSha(local);
    mockSourceRepo = local;

    const plan = await pullSourceRepo();

    expect(plan.reason).toBe("local-commits");
    expect(headSha(local)).toBe(localHead); // commit intact
    expect(existsSync(join(local, "local-only.txt"))).toBe(true);
  });

  it("not a git repo → skips harmlessly", async () => {
    const dir = mkTmp("bb-plain-");
    mockSourceRepo = dir;
    const plan = await pullSourceRepo();
    expect(plan.action).toBe("skip");
  });
});

describe("commitAndPushSourceRepo (push failures are not swallowed)", () => {
  it("push failure returns pushError instead of silently absorbing it", async () => {
    const repo = mkTmp("bb-nopush-");
    rmSync(repo, { recursive: true, force: true });
    git(tmpdir(), "init", "-b", "main", repo);
    // Origin points nowhere → push must fail.
    git(repo, "remote", "add", "origin", join(tmpdir(), "does-not-exist.git"));
    const file = join(repo, "note.txt");
    writeFileSync(file, "content\n");

    const result = commitAndPushSourceRepo(repo, [file], "add note");

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeTruthy();
    // The commit still exists locally.
    expect(git(repo, "log", "--oneline")).toContain("add note");
  });

  it("successful push reports pushed:true and reaches origin", async () => {
    const { work, local } = setupRepoPair();
    const file = join(local, "added.txt");
    writeFileSync(file, "hello\n");

    const result = commitAndPushSourceRepo(local, [file], "add file via helper");

    expect(result).toEqual({ committed: true, pushed: true });
    git(work, "pull", "origin", "main");
    expect(existsSync(join(work, "added.txt"))).toBe(true);
  });

  it("commit is scoped to the given pathspec (unrelated staged changes excluded)", async () => {
    const repo = mkTmp("bb-pathspec-");
    rmSync(repo, { recursive: true, force: true });
    git(tmpdir(), "init", "-b", "main", repo);
    writeFileSync(join(repo, "seed.txt"), "seed\n");
    git(repo, "add", "seed.txt");
    git(repo, "commit", "-m", "seed");

    // Intended change plus an unrelated change the user already staged.
    const intended = join(repo, "intended.txt");
    const unrelated = join(repo, "unrelated.txt");
    writeFileSync(intended, "intended\n");
    writeFileSync(unrelated, "unrelated\n");
    git(repo, "add", "unrelated.txt"); // pre-staged, must NOT be committed

    // No origin → push fails, but the commit content is what we assert.
    commitAndPushSourceRepo(repo, [intended], "commit intended only");

    const committedFiles = git(repo, "show", "--name-only", "--format=", "HEAD");
    expect(committedFiles).toContain("intended.txt");
    expect(committedFiles).not.toContain("unrelated.txt");
    // Unrelated change remains staged/uncommitted.
    expect(git(repo, "status", "--porcelain")).toContain("unrelated.txt");
  });
});
