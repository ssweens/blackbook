import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync } from "fs";
import { lockGitStatus, lockGitDiff, lockGitCommit, lockGitPush, lockInstallFromRepo, lockUpdateSourceRepo } from "./lock-git.js";

let repo: string;
let lock: string;
const E = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf-8", env: E });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "bb-lockgit-"));
  git(repo, "init", "-q");
  lock = join(repo, "skills-lock.json");
  writeFileSync(lock, '{"version":1,"skills":{}}\n');
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("lockGitStatus", () => {
  it("reports clean, then modified after an edit", async () => {
    let s = await lockGitStatus(lock);
    expect(s).toMatchObject({ isRepo: true, fileState: "clean" });
    writeFileSync(lock, '{"version":1,"skills":{"a":1}}\n');
    s = await lockGitStatus(lock);
    expect(s.fileState).toBe("modified");
  });

  it("returns not-a-repo outside git", async () => {
    const out = mkdtempSync(join(tmpdir(), "bb-norepo-"));
    try {
      expect((await lockGitStatus(join(out, "skills-lock.json"))).isRepo).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("reports exists:false for a lock file that isn't there", async () => {
    const s = await lockGitStatus(join(repo, "nope.skills-lock.json"));
    expect(s.exists).toBe(false);
  });

  it("does not mark the lock as ahead when only OTHER files are unpushed", async () => {
    const remote = mkdtempSync(join(tmpdir(), "bb-remote-"));
    try {
      execFileSync("git", ["init", "--bare", "-q"], { cwd: remote, env: E });
      git(repo, "remote", "add", "origin", remote);
      git(repo, "push", "-q", "-u", "origin", "HEAD");
      // Commit an unrelated file; the lock itself is untouched and in sync.
      writeFileSync(join(repo, "other.txt"), "x\n");
      git(repo, "add", "other.txt");
      git(repo, "commit", "-qm", "unrelated");
      const s = await lockGitStatus(lock);
      expect(s.hasUpstream).toBe(true);
      expect(s.ahead).toBe(0); // repo is ahead, but this lock is not
      expect(s.behind).toBe(0);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it("marks the lock as ahead when the lock itself has an unpushed commit", async () => {
    const remote = mkdtempSync(join(tmpdir(), "bb-remote-"));
    try {
      execFileSync("git", ["init", "--bare", "-q"], { cwd: remote, env: E });
      git(repo, "remote", "add", "origin", remote);
      git(repo, "push", "-q", "-u", "origin", "HEAD");
      writeFileSync(lock, '{"version":1,"skills":{"z":1}}\n');
      git(repo, "add", "skills-lock.json");
      git(repo, "commit", "-qm", "update lock");
      const s = await lockGitStatus(lock);
      expect(s.ahead).toBe(1);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });
});

describe("lockGitDiff", () => {
  it("shows the working-tree change for a modified lock", async () => {
    writeFileSync(lock, '{"version":1,"skills":{"added":1}}\n');
    const diff = await lockGitDiff(lock);
    expect(diff).toContain("added");
    expect(diff).toMatch(/^\+|\n\+/);
  });

  it("is empty when clean and not ahead", async () => {
    expect(await lockGitDiff(lock)).toBe("");
  });
});

describe("lockGitCommit / lockGitPush", () => {
  it("commits the lock, then push fails cleanly with no remote", async () => {
    writeFileSync(lock, '{"version":1,"skills":{"x":1}}\n');
    expect(await lockGitCommit(lock, "update")).toEqual({ ok: true });
    expect((await lockGitStatus(lock)).fileState).toBe("clean");
    const pushed = await lockGitPush(lock);
    expect(pushed.ok).toBe(false);
    expect(pushed.error).toBeTruthy();
  });
});

describe("lockInstallFromRepo (repo → disk)", () => {
  it("discards local edits, restoring the committed copy", async () => {
    writeFileSync(lock, '{"version":1,"skills":{"local":1}}\n');
    expect((await lockGitStatus(lock)).fileState).toBe("modified");
    expect(await lockInstallFromRepo(lock)).toEqual({ ok: true });
    expect((await lockGitStatus(lock)).fileState).toBe("clean");
    expect(readFileSync(lock, "utf-8")).toBe('{"version":1,"skills":{}}\n');
  });

  it("refuses when the lock isn't in the repo yet", async () => {
    const untracked = join(repo, "other.json");
    writeFileSync(untracked, "{}\n");
    const r = await lockInstallFromRepo(untracked);
    expect(r.ok).toBe(false);
  });
});

describe("lockUpdateSourceRepo (disk → repo)", () => {
  it("commits local edits, then push fails cleanly with no remote", async () => {
    writeFileSync(lock, '{"version":1,"skills":{"y":1}}\n');
    const r = await lockUpdateSourceRepo(lock, "update");
    expect(r.ok).toBe(false); // no remote to push to
    expect((await lockGitStatus(lock)).fileState).toBe("clean"); // but it committed
  });
});
