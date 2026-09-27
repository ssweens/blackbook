import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  addSourceFor,
  applyProfileToWorkspace,
  buildProfileLock,
  deleteProfileLock,
  isGlobalWorkspace,
  listProfileLocks,
  lockAsProfile,
  profileCoverage,
  workspaceLock,
  writeProfileLock,
  type SkillLockFile,
} from "./skill-profiles.js";

let root: string;
let home: string;
let repo: string;
const saved = { ...process.env };
function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
}


function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-profiles-"));
  home = join(root, "home");
  repo = join(root, "playbook");
  mkdirSync(join(home, ".agents"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(root, "data");
  process.env.XDG_CACHE_HOME = join(root, "cache");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  delete process.env.XDG_STATE_HOME;
  mkdirSync(join(root, "config", "blackbook"), { recursive: true });
  writeFileSync(
    join(root, "config", "blackbook", "config.yaml"),
    "tools:\n  claude-code:\n    - id: default\n      name: Claude\n      enabled: true\n      config_dir: ~/.claude\n",
  );
  writeSkill(join(repo, "skills", "alpha"), "alpha");
  writeSkill(join(repo, "skills", "ns", "beta"), "beta");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:ssweens/playbook.git"], { cwd: repo });
});

afterEach(() => {
  restoreEnv(saved);
  rmSync(root, { recursive: true, force: true });
});

describe("profile files", () => {
  it("write → list → delete, in skills-lock.json format with sorted keys", () => {
    const lock: SkillLockFile = {
      version: 1,
      skills: { zeta: { source: "a/b", sourceType: "github" }, alpha: { source: "a/b", sourceType: "github", skillPath: "skills/alpha/SKILL.md" } },
    };
    writeProfileLock(repo, "Music", lock);
    const text = readFileSync(join(repo, "profiles", "Music.skills-lock.json"), "utf-8");
    expect(Object.keys(JSON.parse(text).skills)).toEqual(["alpha", "zeta"]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(Object.keys(listProfileLocks(repo))).toEqual(["Music"]);
    expect(() => writeProfileLock(repo, "../evil", lock)).toThrow();
    expect(deleteProfileLock(repo, "Music")).toBe(true);
    expect(listProfileLocks(repo)).toEqual({});
  });
});

describe("buildProfileLock", () => {
  it("prefers existing entries, then the global lock (third-party), then the source repo; reports unknowns", () => {
    writeFileSync(
      join(home, ".agents", ".skill-lock.json"),
      JSON.stringify({ version: 3, skills: { "skill-creator": { source: "anthropics/skills", sourceType: "github", skillPath: "skills/skill-creator/SKILL.md", skillFolderHash: "x", installedAt: "t" } } }),
    );
    const existing: SkillLockFile = { version: 1, skills: { alpha: { source: "fork/playbook", sourceType: "github" } } };
    const { lock, unresolved } = buildProfileLock(["alpha", "beta", "skill-creator", "nope"], repo, existing);
    expect(lock.skills.alpha.source).toBe("fork/playbook");
    expect(lock.skills.beta).toEqual({ source: "ssweens/playbook", sourceType: "github", skillPath: "skills/ns/beta/SKILL.md" });
    // Only portable fields survive: no hashes or timestamps.
    expect(lock.skills["skill-creator"]).toEqual({ source: "anthropics/skills", sourceType: "github", skillPath: "skills/skill-creator/SKILL.md" });
    expect(unresolved).toEqual(["nope"]);
  });
});

describe("coverage", () => {
  const profile: SkillLockFile = { version: 1, skills: { a: { source: "x/y", sourceType: "github" }, b: { source: "x/y", sourceType: "github" } } };

  it("counts present by name and source, missing otherwise, removed from the apply snapshot", () => {
    const lock: SkillLockFile = { version: 1, skills: { a: { source: "X/Y", sourceType: "github" }, b: { source: "other/src", sourceType: "github" }, old: { source: "x/y", sourceType: "github" } } };
    const c = profileCoverage("p", profile, lock, ["a", "old"]);
    expect(c).toMatchObject({ total: 2, present: ["a"], missing: ["b"], removed: ["old"], applied: true });
    expect(profileCoverage("p", profile, lock).applied).toBe(false);
  });

  it("reads the project lock, or the global lock for $HOME", () => {
    const project = join(root, "proj");
    mkdirSync(project);
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({ version: 1, skills: { a: { source: "x/y", sourceType: "github", computedHash: "h" } } }));
    writeFileSync(join(home, ".agents", ".skill-lock.json"), JSON.stringify({ version: 3, skills: { g: { source: "x/y", sourceType: "github" } } }));
    expect(Object.keys(workspaceLock(project).skills)).toEqual(["a"]);
    expect(isGlobalWorkspace(home)).toBe(true);
    expect(Object.keys(workspaceLock(home).skills)).toEqual(["g"]);
  });

  it("builds skills add sources from entries", () => {
    expect(addSourceFor({ source: "a/b", sourceType: "github" })).toBe("a/b");
    expect(addSourceFor({ source: "a/b", sourceType: "github", ref: "dev" })).toBe("a/b#dev");
    expect(addSourceFor({ source: "x", sourceType: "git", sourceUrl: "git@h:x.git" })).toBe("git@h:x.git");
  });
});

describe("lockAsProfile", () => {
  it("turns local entries inside the source repo into its remote, and flags other local paths", () => {
    const project = join(root, "proj");
    mkdirSync(project);
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({
      version: 1,
      skills: {
        alpha: { source: join(repo, "skills", "alpha"), sourceType: "local", computedHash: "h" },
        beta: { source: repo, sourceType: "local", skillPath: "skills/ns/beta/SKILL.md" },
        elsewhere: { source: join(root, "other", "skill"), sourceType: "local" },
        remote: { source: "anthropics/skills", sourceType: "github", skillPath: "skills/pdf/SKILL.md", computedHash: "h" },
      },
    }));
    const { lock, localOnly } = lockAsProfile(project, repo);
    expect(lock.skills.alpha).toEqual({ source: "ssweens/playbook", sourceType: "github", skillPath: "skills/alpha/SKILL.md" });
    expect(lock.skills.beta).toEqual({ source: "ssweens/playbook", sourceType: "github", skillPath: "skills/ns/beta/SKILL.md" });
    expect(lock.skills.elsewhere).toEqual({ source: join(root, "other", "skill"), sourceType: "local" });
    expect(lock.skills.remote).toEqual({ source: "anthropics/skills", sourceType: "github", skillPath: "skills/pdf/SKILL.md" });
    expect(localOnly).toEqual(["elsewhere"]);
  });
});

describe("applyProfileToWorkspace (real CLI, isolated HOME)", () => {
  it("adds what's missing to a project's skills-lock.json, then removes what was dropped from the profile", async () => {
    const project = join(root, "proj");
    mkdirSync(join(project, ".claude"), { recursive: true });
    const local = (p: string) => ({ source: p, sourceType: "local" });
    const v1: SkillLockFile = { version: 1, skills: { alpha: local(join(repo, "skills", "alpha")), beta: local(join(repo, "skills", "ns", "beta")) } };

    const first = await applyProfileToWorkspace(project, "p", v1, []);
    expect(first.errors).toEqual([]);
    expect(first.added.sort()).toEqual(["alpha", "beta"]);
    expect(Object.keys(workspaceLock(project).skills).sort()).toEqual(["alpha", "beta"]);
    expect(lstatSync(join(project, ".claude", "skills", "alpha")).isSymbolicLink()).toBe(true);

    // Re-applying an unchanged profile is a no-op.
    expect(await applyProfileToWorkspace(project, "p", v1, [])).toEqual({ added: [], removed: [], errors: [] });

    // Profile drops beta: applying again removes it from the project.
    const v2: SkillLockFile = { version: 1, skills: { alpha: v1.skills.alpha } };
    expect(profileCoverage("p", v2, workspaceLock(project), ["alpha", "beta"]).removed).toEqual(["beta"]);
    const second = await applyProfileToWorkspace(project, "p", v2, []);
    expect(second).toMatchObject({ added: [], removed: ["beta"], errors: [] });
    expect(Object.keys(workspaceLock(project).skills)).toEqual(["alpha"]);
    expect(existsSync(join(project, ".claude", "skills", "beta"))).toBe(false);
  }, 180_000);
});
