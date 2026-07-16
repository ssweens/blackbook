import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { indexSourceSkills, scanProjectSkills } from "./projects.js";

let root: string;
let sourceRepo: string;
let project: string;

function writeSkill(dir: string, name: string, body: string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-projects-"));
  sourceRepo = join(root, "source");
  project = join(root, "project");
  mkdirSync(join(sourceRepo, "skills"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("indexSourceSkills", () => {
  it("indexes flat and namespaced skills by name", () => {
    writeSkill(join(sourceRepo, "skills"), "db", "# db\n");
    mkdirSync(join(sourceRepo, "skills", "web-ns"), { recursive: true });
    writeSkill(join(sourceRepo, "skills", "web-ns"), "web", "# web\n");

    const index = indexSourceSkills(sourceRepo);
    expect(index.has("db")).toBe(true);
    expect(index.has("web")).toBe(true);
    expect(index.get("db")).toBe(join(sourceRepo, "skills", "db"));
    expect(index.get("web")).toBe(join(sourceRepo, "skills", "web-ns", "web"));
  });

  it("returns an empty index when the source has no skills dir", () => {
    expect(indexSourceSkills(join(root, "nope")).size).toBe(0);
  });
});

describe("scanProjectSkills", () => {
  it("classifies in-sync, drifted, and project-only skills", () => {
    // Source skills.
    writeSkill(join(sourceRepo, "skills"), "db", "# db\nsame\n");
    writeSkill(join(sourceRepo, "skills"), "web", "# web\nsource\n");
    const index = indexSourceSkills(sourceRepo);

    const agents = join(project, ".agents", "skills");
    const disabled = join(project, ".agents", "skills-disabled");
    // in-sync: identical bytes to source.
    writeSkill(agents, "db", "# db\nsame\n");
    // project-only: no source match.
    writeSkill(agents, "local-only", "# local\n");
    // disabled + drifted: differs from source web.
    writeSkill(disabled, "web", "# web\nlocal edit\n");

    const skills = scanProjectSkills(project, index);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));

    expect(byName["db"].status).toBe("in-sync");
    expect(byName["db"].enabled).toBe(true);
    expect(byName["local-only"].status).toBe("project-only");
    expect(byName["web"].status).toBe("drifted");
    expect(byName["web"].enabled).toBe(false);
    // Sorted by name.
    expect(skills.map((s) => s.name)).toEqual(["db", "local-only", "web"]);
  });

  it("returns nothing when the project has no .agents/skills", () => {
    mkdirSync(project, { recursive: true });
    expect(scanProjectSkills(project, new Map())).toEqual([]);
  });
});
