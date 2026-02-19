import { describe, it, expect, vi, beforeEach } from "vitest";
import { pluginInstallModule } from "./plugin-install.js";
import {
  installPlugin,
  getPluginToolStatus,
  syncPluginInstances,
} from "../install.js";
import type { Plugin } from "../types.js";

vi.mock("../install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../install.js")>();
  return {
    ...actual,
    installPlugin: vi.fn(),
    getPluginToolStatus: vi.fn(),
    syncPluginInstances: vi.fn(),
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
    installed: false,
    scope: "user",
    ...overrides,
  };
}

describe("pluginInstallModule.check", () => {
  beforeEach(() => {
    vi.mocked(getPluginToolStatus).mockReset();
  });

  it("returns ok when plugin installed on all instances", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
    ]);

    const result = await pluginInstallModule.check({ plugin: mockPlugin() });
    expect(result.status).toBe("ok");
  });

  it("returns missing when plugin not installed on some instances", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
      { toolId: "opencode", instanceId: "default", name: "OC", installed: false, supported: true, enabled: true },
    ]);

    const result = await pluginInstallModule.check({ plugin: mockPlugin() });
    expect(result.status).toBe("missing");
    expect(result.message).toContain("OC");
  });
});

describe("pluginInstallModule.apply", () => {
  beforeEach(() => {
    vi.mocked(getPluginToolStatus).mockReset();
    vi.mocked(installPlugin).mockReset();
    vi.mocked(syncPluginInstances).mockReset();
  });

  it("installs fresh plugin via legacyInstall", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: false, supported: true, enabled: true },
    ]);
    vi.mocked(installPlugin).mockResolvedValue({ success: true, linkedInstances: {}, errors: [], skippedInstances: [] });

    const result = await pluginInstallModule.apply({
      plugin: mockPlugin({ installed: false }),
      marketplaceUrl: "https://example.com/marketplace.json",
    });

    expect(result.changed).toBe(true);
    expect(installPlugin).toHaveBeenCalled();
  });

  it("syncs to missing instances for already-installed plugin", async () => {
    const missing = [
      { toolId: "opencode", instanceId: "default", name: "OC", installed: false, supported: true, enabled: true },
    ];
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
      ...missing,
    ]);
    vi.mocked(syncPluginInstances).mockResolvedValue({ success: true, syncedInstances: {}, errors: [] });

    const result = await pluginInstallModule.apply({
      plugin: mockPlugin({ installed: true }),
      marketplaceUrl: "https://example.com/marketplace.json",
    });

    expect(result.changed).toBe(true);
    expect(syncPluginInstances).toHaveBeenCalled();
  });

  it("returns unchanged when already installed everywhere", async () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
    ]);

    const result = await pluginInstallModule.apply({ plugin: mockPlugin() });
    expect(result.changed).toBe(false);
  });
});
