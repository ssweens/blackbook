import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
    const err = new Error("not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    cb(err);
  },
}));

vi.mock("./config.js", () => {
  const instances = [
    {
      toolId: "claude-code",
      instanceId: "default",
      name: "Claude",
      configDir: "/tmp/claude",
      skillsSubdir: "skills",
      commandsSubdir: "commands",
      agentsSubdir: "agents",
      enabled: true,
    },
    {
      toolId: "opencode",
      instanceId: "default",
      name: "OpenCode",
      configDir: "/tmp/opencode",
      skillsSubdir: "skills",
      commandsSubdir: "commands",
      agentsSubdir: "agents",
      enabled: true,
    },
  ];
  return {
    getToolInstances: () => instances,
    getEnabledToolInstances: () => instances,
    getCacheDir: () => "/tmp/blackbook-test-cache",
  };
});

import { installPlugin, enablePlugin } from "./install.js";
import type { Plugin } from "./types.js";

const basePlugin: Plugin = {
  name: "dep-plugin",
  marketplace: "dep-market",
  description: "",
  source: { source: "github", repo: "owner/repo" },
  skills: [],
  commands: [],
  agents: [],
  hooks: [],
  hasMcp: false,
  hasLsp: false,
  homepage: "",
  installed: false,
  scope: "user",
};

describe("dependency checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces missing Claude CLI as error", async () => {
    const plugin = { ...basePlugin, name: "claude-plugin" };
    const result = await enablePlugin(plugin);
    expect(result.errors.join(" ")).toContain("Claude CLI was not found");
  });

  it("fails install when git is missing", async () => {
    const plugin = { ...basePlugin, name: "git-plugin" };
    const result = await installPlugin(plugin, "https://example.com/marketplace.json");
    expect(result.success).toBe(false);
  });
});
