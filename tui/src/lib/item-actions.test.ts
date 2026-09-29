import { describe, expect, it } from "vitest";
import { getSkillActions } from "./item-actions.js";
import type { StandaloneSkill } from "./install.js";

describe("getSkillActions", () => {
  it("offers a file browser for the skill contents", () => {
    const skill: StandaloneSkill = {
      name: "example",
      installations: [],
      diskPath: "/skills/example",
      toolId: "",
      instanceId: "",
      instanceName: "",
    };

    expect(getSkillActions(skill)).toContainEqual({
      id: "browse_files",
      label: "Browse skill files",
      type: "browse_skill_files",
    });
  });

  it("offers adding the skill to profiles, right after the file browser", () => {
    const skill: StandaloneSkill = { name: "blast-radius", installations: [], diskPath: "/s/blast-radius", toolId: "", instanceId: "", instanceName: "" };
    const ids = getSkillActions(skill).map((a) => a.id);
    expect(ids.indexOf("profiles")).toBe(ids.indexOf("browse_files") + 1);
    expect(getSkillActions(skill)).toContainEqual({ id: "profiles", label: "Add to profiles…", type: "edit_profiles" });
  });

  it("opens the installation that is actually drifted", () => {
    const skill: StandaloneSkill = {
      name: "file-todos",
      installations: [
        {
          toolId: "claude-code",
          instanceId: "default",
          instanceName: "Claude",
          diskPath: "/skills/claude/file-todos",
          drifted: false,
        },
        {
          toolId: "opencode",
          instanceId: "default",
          instanceName: "OpenCode",
          diskPath: "/skills/opencode/file-todos",
          drifted: true,
        },
      ],
      diskPath: "/skills/claude/file-todos",
      toolId: "claude-code",
      instanceId: "default",
      instanceName: "Claude",
      sourcePath: "/source/file-todos",
      drifted: true,
    };

    const status = getSkillActions(skill).find((action) => action.id === "status");

    expect(status).toEqual(expect.objectContaining({
      type: "diff",
      statusLabel: "Drifted",
      instance: expect.objectContaining({
        toolId: "opencode",
        instanceName: "OpenCode",
        configDir: "/skills/opencode/file-todos",
      }),
    }));
  });
});
