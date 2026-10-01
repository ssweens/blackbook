import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  addSourceFor,
  applyProfileToWorkspace,
  assignProfileToWorkspace,
  buildProfileLock,
  deleteProfileLock,
  isGlobalWorkspace,
  listProfileLocks,
  lockAsProfile,
  planApply,
  profileCoverage,
  profileWorkspaceStatus,
  setWorkspaceProfiles,
  unassignProfileFromWorkspace,
  workspaceLock,
  workspaceProfiles,
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
    // Applying assigns: the profile is recorded in the workspace lock's `profiles` meta.
    expect(workspaceLock(project).profiles).toEqual(["p"]);

    // Re-applying an unchanged profile is a no-op.
    expect(await applyProfileToWorkspace(project, "p", v1, [])).toEqual({ added: [], removed: [], errors: [] });

    // Profile drops beta: applying again removes it from the project.
    const v2: SkillLockFile = { version: 1, skills: { alpha: v1.skills.alpha } };
    expect(profileCoverage("p", v2, workspaceLock(project), ["alpha", "beta"]).removed).toEqual(["beta"]);
    const second = await applyProfileToWorkspace(project, "p", v2, []);
    expect(second).toMatchObject({ added: [], removed: ["beta"], errors: [] });
    expect(Object.keys(workspaceLock(project).skills)).toEqual(["alpha"]);
    expect(existsSync(join(project, ".claude", "skills", "beta"))).toBe(false);
    // The CLI rewrote the lock on `skills remove` — the (patched) writer must
    // have carried the `profiles` meta through, or the mapping would vanish.
    expect(workspaceLock(project).profiles).toEqual(["p"]);
  }, 180_000);
});

describe("profile ↔ workspace mapping (lock meta)", () => {
  const gh = (): { source: string; sourceType: string } => ({ source: "x/y", sourceType: "github" });

  it("readLockFile carries a valid profiles meta and ignores junk", () => {
    const project = join(root, "proj");
    mkdirSync(project);
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({ version: 1, skills: { a: gh() }, profiles: ["UI", "Coding", "UI", "", 3] }));
    expect(workspaceLock(project).profiles).toEqual(["UI", "Coding"]);
    expect(workspaceProfiles(project)).toEqual(["Coding", "UI"]);
  });

  it("setWorkspaceProfiles touches only the profiles key and never fabricates a lock", () => {
    const project = join(root, "proj");
    mkdirSync(project);
    // No lock yet → refused, nothing written.
    expect(setWorkspaceProfiles(project, ["Docs"])).toBe(false);
    expect(existsSync(join(project, "skills-lock.json"))).toBe(false);
    // A CLI-style lock with fields Blackbook doesn't model must survive untouched.
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({ version: 1, skills: { a: { ...gh(), computedHash: "h" } }, extra: true }));
    expect(assignProfileToWorkspace(project, "Docs")).toBe(true);
    expect(assignProfileToWorkspace(project, "Docs")).toBe(true); // idempotent
    const raw = JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf-8"));
    expect(raw).toMatchObject({ version: 1, extra: true, profiles: ["Docs"] });
    expect(raw.skills.a.computedHash).toBe("h");
    expect(unassignProfileFromWorkspace(project, "Docs")).toBe(true);
    expect("profiles" in JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf-8"))).toBe(false);
  });

  it("profileWorkspaceStatus is up to date only when in the lock, on disk, and matching", () => {
    const project = join(root, "proj");
    const installed = join(project, ".agents", "skills");
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(project, "skills-lock.json"), JSON.stringify({ version: 1, skills: { alpha: gh(), beta: gh() }, profiles: ["p"] }));
    const profile: SkillLockFile = { version: 1, skills: { alpha: gh(), beta: gh() } };
    // Only alpha on disk → beta is "to apply" (in the lock, missing on disk).
    writeSkill(join(installed, "alpha"), "alpha");
    let s = profileWorkspaceStatus("p", profile, project, new Map());
    expect(s).toMatchObject({ assigned: true, upToDate: false, toApply: ["beta"], installMissing: ["beta"], drifted: [] });
    writeSkill(join(installed, "beta"), "beta");
    s = profileWorkspaceStatus("p", profile, project, new Map());
    expect(s.upToDate).toBe(true);
    // Drift against a known source flips it back.
    const src = join(root, "src-alpha");
    writeSkill(src, "alpha");
    writeFileSync(join(src, "SKILL.md"), "---\nname: alpha\n---\nchanged\n");
    s = profileWorkspaceStatus("p", profile, project, new Map([["alpha", src]]));
    expect(s).toMatchObject({ upToDate: false, drifted: ["alpha"] });
  });

  it("planApply adds a skill that is on disk but absent from the workspace lock", () => {
    const project = join(root, "proj");
    const installed = join(project, ".agents", "skills");
    mkdirSync(installed, { recursive: true });
    writeSkill(join(installed, "alpha"), "alpha"); // on disk, not in the lock
    const plan = planApply({ alpha: gh() }, {}, installed, new Map());
    expect(plan).toEqual(["alpha"]);
    // Same source in the lock + on disk → nothing to apply.
    expect(planApply({ alpha: gh() }, { alpha: gh() }, installed, new Map())).toEqual([]);
  });
});
