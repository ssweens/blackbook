import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { indexSourceSkills, indexSourceSkillTree, scanProjectSkills, collectUnmanagedSkills, type ProjectInfo } from "./projects.js";

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

describe("indexSourceSkillTree", () => {
  it("groups namespaced skills and lists top-level skills separately", () => {
    // Two namespaces + two top-level skills.
    writeSkill(join(sourceRepo, "skills"), "rclone", "# rclone\n");
    writeSkill(join(sourceRepo, "skills"), "pdf", "# pdf\n");
    mkdirSync(join(sourceRepo, "skills", "gbrain"), { recursive: true });
    writeSkill(join(sourceRepo, "skills", "gbrain"), "briefing", "# briefing\n");
    writeSkill(join(sourceRepo, "skills", "gbrain"), "web-research", "# web-research\n");
    mkdirSync(join(sourceRepo, "skills", "ssmp"), { recursive: true });
    writeSkill(join(sourceRepo, "skills", "ssmp"), "mixing", "# mixing\n");

    const { namespaces, topLevel } = indexSourceSkillTree(sourceRepo);

    expect(namespaces.map((n) => n.name)).toEqual(["gbrain", "ssmp"]);
    expect(namespaces.find((n) => n.name === "gbrain")?.skills).toEqual(["briefing", "web-research"]);
    expect(namespaces.find((n) => n.name === "ssmp")?.skills).toEqual(["mixing"]);
    expect(topLevel).toEqual(["pdf", "rclone"]);
  });

  it("uses the same bare skill names as indexSourceSkills, so a namespace selection maps 1:1 to individual skills", () => {
    mkdirSync(join(sourceRepo, "skills", "gbrain"), { recursive: true });
    writeSkill(join(sourceRepo, "skills", "gbrain"), "briefing", "# briefing\n");

    const flat = indexSourceSkills(sourceRepo);
    const { namespaces } = indexSourceSkillTree(sourceRepo);
    for (const s of namespaces.flatMap((n) => n.skills)) {
      expect(flat.has(s)).toBe(true);
    }
  });

  it("ignores empty namespace dirs and non-skill dirs", () => {
    mkdirSync(join(sourceRepo, "skills", "empty-ns"), { recursive: true });
    const { namespaces, topLevel } = indexSourceSkillTree(sourceRepo);
    expect(namespaces).toEqual([]);
    expect(topLevel).toEqual([]);
  });

  it("returns empty groups when the source has no skills dir", () => {
    const { namespaces, topLevel } = indexSourceSkillTree(join(root, "nope"));
    expect(namespaces).toEqual([]);
    expect(topLevel).toEqual([]);
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

describe("collectUnmanagedSkills", () => {
  const mk = (name: string, workspace: string, skills: { name: string; status: string; diskPath: string }[]): ProjectInfo =>
    ({
      path: `/${workspace}`,
      name: workspace,
      exists: true,
      hasAgentsDir: true,
      available: [],
      skills: skills.map((s) => ({ ...s, enabled: true })),
    }) as ProjectInfo;

  it("collects project-only skills across workspaces, deduped by name", () => {
    const projects = [
      mk("Global", "Global", [
        { name: "db", status: "in-sync", diskPath: "/Global/.agents/skills/db" },
        { name: "loose", status: "project-only", diskPath: "/Global/.agents/skills/loose" },
      ]),
      mk("proj", "proj", [
        { name: "loose", status: "project-only", diskPath: "/proj/.agents/skills/loose" }, // dup name
        { name: "onlyhere", status: "project-only", diskPath: "/proj/.agents/skills/onlyhere" },
      ]),
    ];
    const unmanaged = collectUnmanagedSkills(projects);
    expect(unmanaged.map((u) => u.name)).toEqual(["loose", "onlyhere"]);
    // First workspace wins for a duplicate name (Global before proj).
    expect(unmanaged.find((u) => u.name === "loose")?.fromPath).toBe("/Global/.agents/skills/loose");
  });

  it("returns nothing when every skill is in-sync or drifted (all managed)", () => {
    const projects = [mk("Global", "Global", [{ name: "db", status: "in-sync", diskPath: "/x" }])];
    expect(collectUnmanagedSkills(projects)).toEqual([]);
  });
});
