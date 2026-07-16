import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  pushSkillToProject,
  pullSkillToSource,
  toggleProjectSkill,
  deleteProjectSkill,
  projectSkillDir,
} from "./project-actions.js";

let root: string;
let project: string;
let sourceRepo: string;

function writeSkill(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-projact-"));
  project = join(root, "project");
  sourceRepo = join(root, "source");
  // Isolate the backup cache under the temp root.
  process.env.XDG_CACHE_HOME = join(root, "cache");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pushSkillToProject", () => {
  it("adds a source skill into the project's .agents/skills", async () => {
    const src = join(sourceRepo, "skills", "db");
    writeSkill(src, "# db\nsource\n");

    const r = await pushSkillToProject(project, src, "db");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(projectSkillDir(project, "db"), "SKILL.md"), "utf-8")).toContain("source");
  });

  it("errors when the source skill is missing", async () => {
    const r = await pushSkillToProject(project, join(sourceRepo, "skills", "nope"), "nope");
    expect(r.ok).toBe(false);
  });
});

describe("pullSkillToSource", () => {
  it("creates a new source skill from a project-only skill", async () => {
    const projSkill = projectSkillDir(project, "local");
    writeSkill(projSkill, "# local\nfrom project\n");

    const r = await pullSkillToSource(sourceRepo, projSkill, "local");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(sourceRepo, "skills", "local", "SKILL.md"), "utf-8")).toContain("from project");
  });
});

describe("toggleProjectSkill", () => {
  it("moves a skill between enabled and disabled roots", () => {
    const enabled = projectSkillDir(project, "web", true);
    writeSkill(enabled, "# web\n");

    const off = toggleProjectSkill(project, "web", true);
    expect(off.ok).toBe(true);
    expect(existsSync(enabled)).toBe(false);
    expect(existsSync(projectSkillDir(project, "web", false))).toBe(true);

    const on = toggleProjectSkill(project, "web", false);
    expect(on.ok).toBe(true);
    expect(existsSync(projectSkillDir(project, "web", true))).toBe(true);
  });

  it("refuses when the target side already exists", () => {
    writeSkill(projectSkillDir(project, "dup", true), "# a\n");
    writeSkill(projectSkillDir(project, "dup", false), "# b\n");
    expect(toggleProjectSkill(project, "dup", true).ok).toBe(false);
  });
});

describe("deleteProjectSkill", () => {
  it("removes the skill directory", () => {
    const dir = projectSkillDir(project, "gone");
    writeSkill(dir, "# gone\n");

    const r = deleteProjectSkill(dir, "gone");
    expect(r.ok).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("errors when the skill is missing", () => {
    expect(deleteProjectSkill(projectSkillDir(project, "nope"), "nope").ok).toBe(false);
  });
});
