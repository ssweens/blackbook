import { describe, it, expect, vi } from "vitest";

vi.mock("./config.js", () => ({
  getToolDefinitions: () => ({
    "claude-code": {
      id: "claude-code",
      name: "Claude",
      configDir: "/Users/test/.claude",
      skillsSubdir: "skills",
      commandsSubdir: "commands",
      agentsSubdir: "agents",
    },
    opencode: {
      id: "opencode",
      name: "OpenCode",
      configDir: "/Users/test/.config/opencode",
      skillsSubdir: "skills",
      commandsSubdir: "commands",
      agentsSubdir: "agents",
    },
  }),
  getToolInstances: () => [
    {
      toolId: "claude-code",
      instanceId: "default",
      name: "Claude",
      configDir: "/Users/test/.claude",
      skillsSubdir: "skills",
      commandsSubdir: "commands",
      agentsSubdir: "agents",
      enabled: true,
    },
  ],
}));

import { getManagedToolRows } from "./tool-view.js";

describe("getManagedToolRows", () => {
  it("includes configured rows and synthetic rows for unconfigured default tools", () => {
    const rows = getManagedToolRows();
    expect(rows).toHaveLength(2);

    const configured = rows.find((row) => row.toolId === "claude-code");
    expect(configured?.synthetic).toBe(false);
    expect(configured?.enabled).toBe(true);

    const synthetic = rows.find((row) => row.toolId === "opencode");
    expect(synthetic?.synthetic).toBe(true);
    expect(synthetic?.instanceId).toBe("default");
    expect(synthetic?.enabled).toBe(false);
  });
});
