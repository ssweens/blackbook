/**
 * # Coverage
 *
 * ## Critical Paths
 * - [x] Discover → plugin detail → install to all tools
 *
 * ## Problem Paths
 * - [x] Install failure surfaces error notification without leaving detail view
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { useStore } from "./lib/store.js";
import type { Marketplace, Plugin, ToolInstance } from "./lib/types.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  installPlugin,
} from "./lib/install.js";
import { fetchMarketplace } from "./lib/marketplace.js";
import { parseMarketplaces, getToolInstances, loadConfig, ensureConfigExists } from "./lib/config.js";

vi.mock("./lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/config.js")>();
  return {
    ...actual,
    parseMarketplaces: vi.fn(),
    getToolInstances: vi.fn(),
    loadConfig: vi.fn(),
    ensureConfigExists: vi.fn(),
  };
});

vi.mock("./lib/marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/marketplace.js")>();
  return {
    ...actual,
    fetchMarketplace: vi.fn(),
  };
});

vi.mock("./lib/install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/install.js")>();
  return {
    ...actual,
    getAllInstalledPlugins: vi.fn(),
    getPluginToolStatus: vi.fn(),
    installPlugin: vi.fn(),
  };
});

const downArrow = "\u001B[B";
const enterKey = "\r";

const waitForFrame = async (getFrame: () => string | undefined, predicate: (frame: string) => boolean) => {
  for (let i = 0; i < 40; i += 1) {
    const frame = getFrame();
    if (frame && predicate(frame)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for frame.\nLast frame:\n${getFrame()}`);
};

const createMarketplace = (overrides: Partial<Marketplace> = {}): Marketplace => ({
  name: "Test Marketplace",
  url: "https://example.com/marketplace.json",
  isLocal: false,
  plugins: [],
  availableCount: 0,
  installedCount: 0,
  autoUpdate: false,
  source: "blackbook",
  ...overrides,
});

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  name: "partial-plugin",
  marketplace: "Test Marketplace",
  description: "Partial plugin",
  source: "./plugins/partial-plugin",
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
});

const createToolInstances = (): ToolInstance[] => [
  {
    toolId: "opencode",
    instanceId: "default",
    name: "OpenCode",
    enabled: true,
    configDir: "/tmp/opencode",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  },
  {
    toolId: "opencode",
    instanceId: "secondary",
    name: "OpenCode Secondary",
    enabled: true,
    configDir: "/tmp/opencode-secondary",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  },
];

describe("App E2E flows", () => {
  beforeEach(() => {
    vi.mocked(parseMarketplaces).mockReturnValue([createMarketplace()]);
    vi.mocked(fetchMarketplace).mockResolvedValue([createPlugin()]);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({
      plugins: [createPlugin()],
      byTool: {},
    });
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
    vi.mocked(getToolInstances).mockReturnValue(createToolInstances());
    vi.mocked(loadConfig).mockReturnValue({ assets: [] });
    vi.mocked(ensureConfigExists).mockImplementation(() => {});

    useStore.setState({
      tab: "discover",
      marketplaces: [],
      installedPlugins: [],
      assets: [],
      tools: createToolInstances(),
      search: "",
      selectedIndex: 0,
      loading: false,
      error: null,
      detailPlugin: null,
      detailAsset: null,
      detailMarketplace: null,
      notifications: [],
    });
  });

  it("stays on plugin detail after installing to all tools", async () => {
    vi.mocked(installPlugin).mockResolvedValue({
      success: true,
      linkedInstances: { "opencode:secondary": 1 },
      skippedInstances: [],
      errors: [],
    });

    const { stdin, stdout, unmount } = render(<App />);

    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("partial-plugin"));
    stdin.write(enterKey);
    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));

    stdin.write(downArrow);
    stdin.write(downArrow);
    stdin.write(enterKey);

    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));
    expect(stdout.lastFrame()).toContain("Back to plugin list");

    unmount();
  });

  it("shows install failure without leaving detail view", async () => {
    vi.mocked(installPlugin).mockResolvedValue({
      success: false,
      linkedInstances: {},
      skippedInstances: [],
      errors: ["Install failed"],
    });

    const { stdin, stdout, unmount } = render(<App />);

    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("partial-plugin"));
    stdin.write(enterKey);
    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));

    stdin.write(downArrow);
    stdin.write(downArrow);
    stdin.write(enterKey);

    await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Failed to install"));
    expect(stdout.lastFrame()).toContain("Tool Status:");

    unmount();
  });
});
