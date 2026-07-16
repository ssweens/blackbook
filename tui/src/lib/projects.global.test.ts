import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let root: string;
let home: string;
let sourceRepo: string;

const homedirMock = vi.fn((): string => "");

// Partial-mock os so tmpdir() still works for the fixture setup.
vi.mock("os", async (orig) => {
  const actual = (await orig()) as typeof import("os");
  return { ...actual, homedir: () => homedirMock() };
});
vi.mock("./config/loader.js", () => ({ loadConfig: () => ({ config: { projects: [] }, configPath: "/x", errors: [] }) }));
vi.mock("./config.js", () => ({ getConfigRepoPath: () => sourceRepo }));

import { getProjects } from "./projects.js";

function writeSkill(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-global-"));
  home = join(root, "home");
  sourceRepo = join(root, "source");
  writeSkill(join(home, ".agents", "skills", "gskill"), "# gskill\nsame\n");
  writeSkill(join(sourceRepo, "skills", "gskill"), "# gskill\nsame\n"); // identical → in-sync
  writeSkill(join(sourceRepo, "skills", "other"), "# other\n"); // available
  homedirMock.mockReturnValue(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("getProjects global workspace", () => {
  it("prepends a synthetic Global workspace scanning ~/.agents/skills", () => {
    const projects = getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const global = projects[0];
    expect(global.synthetic).toBe(true);
    expect(global.name).toBe("Global");
    expect(global.path).toBe(home);
    expect(global.skills.map((s) => s.name)).toContain("gskill");
    expect(global.skills.find((s) => s.name === "gskill")?.status).toBe("in-sync");
    // 'other' exists in source but not in ~/.agents/skills → available to add.
    expect(global.available.map((a) => a.name)).toContain("other");
  });
});
