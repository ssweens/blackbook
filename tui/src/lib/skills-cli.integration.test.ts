import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { addSourceSkillsToProject, deleteProjectSkill, skillsSourceForRepo } from "./project-actions.js";
import { getSkillsStoreDir, runSkillsCli } from "./skills-cli.js";

// Drives the real vendored skills CLI (no mocks) against a local source repo,
// with config/data dirs isolated under a temp root.
let root: string;
let sourceRepo: string;
let project: string;
const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME };

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-skills-cli-"));
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.XDG_DATA_HOME = join(root, "data");
  mkdirSync(join(root, "config", "blackbook"), { recursive: true });
  writeFileSync(
    join(root, "config", "blackbook", "config.yaml"),
    "tools:\n  claude-code:\n    - id: default\n      name: Claude\n      enabled: true\n      config_dir: ~/.claude\n",
  );
  sourceRepo = join(root, "playbook");
  for (const name of ["alpha", "beta"]) {
    mkdirSync(join(sourceRepo, "skills", name), { recursive: true });
    writeFileSync(join(sourceRepo, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`);
  }
  execFileSync("git", ["init", "-q"], { cwd: sourceRepo });
  project = join(root, "project");
  mkdirSync(join(project, ".claude"), { recursive: true });
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("vendored skills CLI via project actions", () => {
  it("prefers the GitHub origin as the install source, falling back to the local path", () => {
    expect(skillsSourceForRepo(sourceRepo).source).toBe(sourceRepo);
    expect(skillsSourceForRepo(sourceRepo).warning).toMatch(/no git remote/);
    execFileSync("git", ["remote", "add", "origin", "git@github.com:SSweens/Playbook.git"], { cwd: sourceRepo });
    expect(skillsSourceForRepo(sourceRepo)).toEqual({ source: "SSweens/Playbook" });
  });

  it("installs into the central store, links the project, writes skills-lock.json, and removes cleanly", async () => {
    const r = await addSourceSkillsToProject(project, sourceRepo, ["alpha", "beta"]);
    expect(r.ok).toBe(true);

    const storeDir = join(getSkillsStoreDir(), "local", ...sourceRepo.split("/").filter(Boolean));
    for (const name of ["alpha", "beta"]) {
      const link = join(project, ".claude", "skills", name);
      expect(isLink(link)).toBe(true);
      expect(readlinkSync(link)).toBe(join(storeDir, name));
      expect(readFileSync(join(link, "SKILL.md"), "utf-8")).toContain(`# ${name}`);
    }
    const lock = JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf-8"));
    expect(Object.keys(lock.skills)).toEqual(["alpha", "beta"]);
    expect(lock.skills.alpha.sourceType).toBe("local");

    const del = await deleteProjectSkill(join(project, ".claude", "skills", "alpha"), "alpha");
    expect(del.ok).toBe(true);
    expect(isLink(join(project, ".claude", "skills", "alpha"))).toBe(false);
    expect(JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf-8")).skills.alpha).toBeUndefined();
    // Shared store copy stays for other projects.
    expect(existsSync(join(storeDir, "alpha", "SKILL.md"))).toBe(true);
  }, 60000);

  it("global installs link ~/.agents/skills and ~/.claude/skills into the store (isolated HOME)", async () => {
    const home = join(root, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
    const r = await runSkillsCli(["add", sourceRepo, "-g", "--skill", "alpha", "-a", "claude-code", "-a", "codex", "-y"], {
      cwd: project,
      env,
    });
    expect(r.code).toBe(0);
    const storeSkill = join(getSkillsStoreDir(), "local", ...sourceRepo.split("/").filter(Boolean), "alpha");
    expect(readlinkSync(join(home, ".agents", "skills", "alpha"))).toBe(storeSkill);
    expect(readlinkSync(join(home, ".claude", "skills", "alpha"))).toBe(storeSkill);

    const rm = await runSkillsCli(["remove", "alpha", "-g", "-y"], { cwd: project, env });
    expect(rm.code).toBe(0);
    expect(isLink(join(home, ".agents", "skills", "alpha"))).toBe(false);
    expect(existsSync(join(storeSkill, "SKILL.md"))).toBe(true);
  }, 60000);
});
