import { describe, expect, it } from "vitest";
import { getSkillActions } from "./item-actions.js";
import type { StandaloneSkill } from "./install.js";

describe("getSkillActions", () => {
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
