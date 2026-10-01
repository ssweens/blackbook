import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { commitLockFiles, findGitRoot } from "./lock-commit.js";

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e" } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-lockcommit-"));
  git(root, "init", "-q");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("findGitRoot", () => {
  it("finds the repo from a nested dir, null outside one", () => {
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(findGitRoot(join(root, "a", "b"))).toBe(root);
    expect(findGitRoot(tmpdir())).toBe(null);
  });
});

describe("commitLockFiles", () => {
  const head = () => git(root, "rev-parse", "HEAD").trim();

  it("commits only the given path, never other dirty files", async () => {
    const lock = join(root, "skills-lock.json");
    writeFileSync(lock, "{}\n");
    writeFileSync(join(root, "unrelated.txt"), "dirty\n");
    const before = head();
    const r = await commitLockFiles([lock], "chore: lock", { push: false });
    expect(r).toMatchObject({ committed: true, pushed: false });
    expect(head()).not.toBe(before);
    // unrelated.txt stays uncommitted.
    expect(git(root, "status", "--porcelain")).toContain("unrelated.txt");
    expect(git(root, "show", "--stat", "HEAD")).toContain("skills-lock.json");
  });

  it("is a no-op when the path has no changes", async () => {
    const lock = join(root, "skills-lock.json");
    writeFileSync(lock, "{}\n");
    await commitLockFiles([lock], "first", { push: false });
    const before = head();
    const r = await commitLockFiles([lock], "again", { push: false });
    expect(r.committed).toBe(false);
    expect(head()).toBe(before);
  });

  it("commits a deletion", async () => {
    const lock = join(root, "skills-lock.json");
    writeFileSync(lock, "{}\n");
    await commitLockFiles([lock], "add", { push: false });
    rmSync(lock);
    const r = await commitLockFiles([lock], "remove", { push: false });
    expect(r.committed).toBe(true);
    expect(git(root, "status", "--porcelain")).not.toContain("skills-lock.json");
  });

  it("reports a push failure without throwing (no remote)", async () => {
    const lock = join(root, "skills-lock.json");
    writeFileSync(lock, "{}\n");
    const r = await commitLockFiles([lock], "lock", { push: true });
    expect(r.committed).toBe(true);
    expect(r.pushed).toBe(false);
    expect(r.pushError).toBeTruthy();
  });

  it("returns not-committed outside a git repo", async () => {
    const outside = mkdtempSync(join(tmpdir(), "bb-norepo-"));
    try {
      const r = await commitLockFiles([join(outside, "skills-lock.json")], "x", { push: false });
      expect(r).toEqual({ committed: false, pushed: false });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
