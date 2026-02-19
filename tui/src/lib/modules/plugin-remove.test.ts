import { describe, it, expect, vi, beforeEach } from "vitest";
import { pluginRemoveModule } from "./plugin-remove.js";
import {
  uninstallPlugin,
  getPluginToolStatus,
} from "../install.js";
import type { Plugin } from "../types.js";

vi.mock("../install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../install.js")>();
  return {
    ...actual,
    uninstallPlugin: vi.fn(),
    getPluginToolStatus: vi.fn(),
  };
});

function mockPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "test-plugin",
    marketplace: "test",
    description: "test",
    source: "./plugins/test",
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: true,
    scope: "user",
    ...overrides,
  };
}

describe("pluginRemoveModule.check", () => {
  beforeEach(() => {
    vi.mocked(getPluginToolStatus).mockReset();
  });

  it("returns ok when plugin not installed anywhere", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: false, supported: true, enabled: true },
    ]);

    const result = await pluginRemoveModule.check({ plugin: mockPlugin() });
    expect(result.status).toBe("ok");
  });

  it("returns drifted when plugin is installed", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
    ]);

    const result = await pluginRemoveModule.check({ plugin: mockPlugin() });
    expect(result.status).toBe("drifted");
    expect(result.message).toContain("Claude");
  });
});

describe("pluginRemoveModule.apply", () => {
  beforeEach(() => {
    vi.mocked(uninstallPlugin).mockReset();
  });

  it("removes plugin via legacyUninstall", async () => {
    vi.mocked(uninstallPlugin).mockResolvedValue(true);

    const result = await pluginRemoveModule.apply({ plugin: mockPlugin() });
    expect(result.changed).toBe(true);
    expect(uninstallPlugin).toHaveBeenCalled();
  });

  it("reports error when uninstall fails", async () => {
    vi.mocked(uninstallPlugin).mockResolvedValue(false);

    const result = await pluginRemoveModule.apply({ plugin: mockPlugin() });
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
  });
});
