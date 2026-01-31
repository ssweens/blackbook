import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store.js";
import { getToolInstances, updateToolInstanceConfig, getEnabledToolInstances } from "./config.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  syncPluginInstances,
  getAssetToolStatus,
  getAssetSourceInfo,
  getConfigToolStatus,
} from "./install.js";
import type { Plugin, Marketplace, ToolInstance, Asset } from "./types.js";

// Mock config functions to avoid writing to real config file
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    addMarketplace: vi.fn(),
    removeMarketplace: vi.fn(),
    ensureConfigExists: vi.fn(),
    getToolInstances: vi.fn(),
    updateToolInstanceConfig: vi.fn(),
    getEnabledToolInstances: vi.fn(),
  };
});

vi.mock("./install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./install.js")>();
  return {
    ...actual,
    getAllInstalledPlugins: vi.fn(),
    getPluginToolStatus: vi.fn(),
    syncPluginInstances: vi.fn(),
    getAssetToolStatus: vi.fn(),
    getAssetSourceInfo: vi.fn(),
    getConfigToolStatus: vi.fn(),
  };
});

vi.mock("./marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketplace.js")>();
  return {
    ...actual,
    fetchMarketplace: vi.fn().mockResolvedValue([]),
  };
});

function createMockPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "test-plugin",
    marketplace: "test-marketplace",
    description: "A test plugin",
    source: "./plugins/test-plugin",
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

function createMockMarketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    name: "test-marketplace",
    url: "https://example.com/marketplace.json",
    isLocal: false,
    plugins: [],
    availableCount: 0,
    installedCount: 0,
    autoUpdate: false,
    source: "blackbook",
    ...overrides,
  };
}

function createMockTool(overrides: Partial<ToolInstance> = {}): ToolInstance {
  return {
    toolId: "opencode",
    instanceId: "default",
    name: "OC",
    configDir: "/tmp/opencode",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    ...overrides,
  };
}

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    name: "test-asset",
    source: "./assets/test-asset",
    installed: true,
    scope: "user",
    sourceExists: true,
    sourceError: null,
    ...overrides,
  };
}

describe("Store notifications", () => {
  beforeEach(() => {
    useStore.setState({
      notifications: [],
      marketplaces: [],
      installedPlugins: [],
    });
  });

  it("should add notification", () => {
    const { notify } = useStore.getState();
    notify("Test message", "info");

    const { notifications } = useStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe("Test message");
    expect(notifications[0].type).toBe("info");
  });

  it("should add success notification", () => {
    const { notify } = useStore.getState();
    notify("Success!", "success");

    const { notifications } = useStore.getState();
    expect(notifications[0].type).toBe("success");
  });

  it("should add error notification", () => {
    const { notify } = useStore.getState();
    notify("Error!", "error");

    const { notifications } = useStore.getState();
    expect(notifications[0].type).toBe("error");
  });

  it("should clear notification by id", () => {
    const { notify } = useStore.getState();
    notify("Message 1", "info");
    notify("Message 2", "info");

    let { notifications } = useStore.getState();
    expect(notifications).toHaveLength(2);

    const { clearNotification } = useStore.getState();
    clearNotification(notifications[0].id);

    notifications = useStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe("Message 2");
  });

  it("should keep multiple notifications", () => {
    const { notify } = useStore.getState();
    notify("Message 1", "info");
    notify("Message 2", "success");
    notify("Message 3", "error");

    const { notifications } = useStore.getState();
    expect(notifications).toHaveLength(3);
  });
});

describe("Store tab navigation", () => {
  beforeEach(() => {
    useStore.setState({
      tab: "discover",
      selectedIndex: 5,
      search: "test",
      detailPlugin: createMockPlugin(),
      detailMarketplace: createMockMarketplace(),
    });
  });

  it("should reset state when changing tabs", () => {
    const { setTab } = useStore.getState();
    setTab("installed");

    const state = useStore.getState();
    expect(state.tab).toBe("installed");
    expect(state.selectedIndex).toBe(0);
    expect(state.search).toBe("");
    expect(state.detailPlugin).toBeNull();
    expect(state.detailMarketplace).toBeNull();
  });
});

describe("Store search", () => {
  beforeEach(() => {
    useStore.setState({
      search: "",
      selectedIndex: 5,
    });
  });

  it("should reset selection when searching", () => {
    const { setSearch } = useStore.getState();
    setSearch("new query");

    const state = useStore.getState();
    expect(state.search).toBe("new query");
    expect(state.selectedIndex).toBe(0);
  });
});

describe("Store detail views", () => {
  beforeEach(() => {
    useStore.setState({
      detailPlugin: null,
      detailMarketplace: null,
    });
  });

  it("should set detail plugin", () => {
    const plugin = createMockPlugin({ name: "my-plugin" });
    const { setDetailPlugin } = useStore.getState();
    setDetailPlugin(plugin);

    expect(useStore.getState().detailPlugin?.name).toBe("my-plugin");
  });

  it("should clear detail plugin", () => {
    const plugin = createMockPlugin();
    useStore.setState({ detailPlugin: plugin });

    const { setDetailPlugin } = useStore.getState();
    setDetailPlugin(null);

    expect(useStore.getState().detailPlugin).toBeNull();
  });

  it("should set detail marketplace", () => {
    const marketplace = createMockMarketplace({ name: "my-marketplace" });
    const { setDetailMarketplace } = useStore.getState();
    setDetailMarketplace(marketplace);

    expect(useStore.getState().detailMarketplace?.name).toBe("my-marketplace");
  });
});

describe("Store marketplace management", () => {
  beforeEach(() => {
    useStore.setState({
      marketplaces: [createMockMarketplace({ name: "existing" })],
    });
  });

  it("should add new marketplace", () => {
    const { addMarketplace } = useStore.getState();
    addMarketplace("new-market", "https://new.example.com");

    const { marketplaces } = useStore.getState();
    expect(marketplaces).toHaveLength(2);
    expect(marketplaces[1].name).toBe("new-market");
  });

  it("should not add duplicate marketplace", () => {
    const { addMarketplace } = useStore.getState();
    addMarketplace("existing", "https://duplicate.example.com");

    const { marketplaces } = useStore.getState();
    expect(marketplaces).toHaveLength(1);
  });

  it("should remove marketplace", () => {
    const { removeMarketplace } = useStore.getState();
    removeMarketplace("existing");

    const { marketplaces } = useStore.getState();
    expect(marketplaces).toHaveLength(0);
  });

  it("should detect local marketplace", () => {
    const { addMarketplace } = useStore.getState();
    addMarketplace("local", "/path/to/local/marketplace.json");

    const { marketplaces } = useStore.getState();
    const local = marketplaces.find((m) => m.name === "local");
    expect(local?.isLocal).toBe(true);
  });
});

describe("Store tool management", () => {
  beforeEach(() => {
    useStore.setState({ tools: [] });
    vi.mocked(getToolInstances).mockReset();
    vi.mocked(updateToolInstanceConfig).mockReset();
    vi.mocked(getEnabledToolInstances).mockReset();
  });

  it("should refresh tool list when config changes", () => {
    const toolEnabled = createMockTool({ enabled: true });
    const toolDisabled = createMockTool({ enabled: false });

    vi.mocked(getToolInstances).mockReturnValueOnce([toolEnabled]);
    useStore.getState().loadTools();
    expect(useStore.getState().tools[0].enabled).toBe(true);

    vi.mocked(getToolInstances).mockReturnValueOnce([toolDisabled]);
    useStore.getState().loadTools();
    expect(useStore.getState().tools[0].enabled).toBe(false);
  });

  it("toggles tool enablement and refreshes", async () => {
    const tool = createMockTool({ enabled: true });
    vi.mocked(getToolInstances).mockReturnValue([tool]);

    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ refreshAll: refreshAll as () => Promise<void> });

    await useStore.getState().toggleToolEnabled(tool.toolId, tool.instanceId);

    expect(updateToolInstanceConfig).toHaveBeenCalledWith(tool.toolId, tool.instanceId, { enabled: false });
    expect(refreshAll).toHaveBeenCalled();
  });

  it("updates tool config_dir with trimmed value", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ refreshAll: refreshAll as () => Promise<void> });

    await useStore.getState().updateToolConfigDir("opencode", "default", "  /tmp/opencode  ");

    expect(updateToolInstanceConfig).toHaveBeenCalledWith(
      "opencode",
      "default",
      { configDir: "/tmp/opencode" }
    );
    expect(refreshAll).toHaveBeenCalled();
  });
});

describe("Store sync tools", () => {
  beforeEach(() => {
    vi.mocked(getAllInstalledPlugins).mockReset();
    vi.mocked(getPluginToolStatus).mockReset();
    vi.mocked(syncPluginInstances).mockReset();
    vi.mocked(getAssetToolStatus).mockReset();
    vi.mocked(getAssetSourceInfo).mockReset();
    vi.mocked(getConfigToolStatus).mockReturnValue([]);
  });

  it("builds a sync preview for partial plugins", () => {
    useStore.setState({ assets: [createMockAsset()] });
    const plugin = createMockPlugin({ name: "partial-plugin" });
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [plugin], byTool: {} });
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "opencode",
        instanceId: "default",
        name: "OpenCode",
        installed: true,
        supported: true,
        enabled: true,
      },
      {
        toolId: "opencode",
        instanceId: "secondary",
        name: "OpenCode Secondary",
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);
    vi.mocked(getAssetSourceInfo).mockReturnValue({
      sourcePath: "/tmp/test-asset",
      exists: false,
      isDirectory: false,
      hash: null,
      error: "Asset source not found.",
    });
    vi.mocked(getAssetToolStatus).mockReturnValue([]);

    const preview = useStore.getState().getSyncPreview();
    expect(preview).toHaveLength(1);
    expect(preview[0].kind).toBe("plugin");
    if (preview[0].kind === "plugin") {
      expect(preview[0].plugin.name).toBe("partial-plugin");
      expect(preview[0].missingInstances).toContain("OpenCode Secondary");
    }
  });

  it("notifies when no items need sync", async () => {
    useStore.setState({ notifications: [] });

    await useStore.getState().syncTools([]);

    const { notifications } = useStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe("All enabled instances are in sync.");
    expect(notifications[0].type).toBe("success");
  });
});
