import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store.js";
import type { Plugin, Marketplace } from "./types.js";

// Mock config functions to avoid writing to real config file
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    addMarketplace: vi.fn(),
    removeMarketplace: vi.fn(),
    ensureConfigExists: vi.fn(),
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
