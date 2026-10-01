import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { lockGitStatus, lockGitDiff, lockGitCommit, lockGitPush } from "./lock-git.js";

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
