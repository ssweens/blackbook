/**
 * # Coverage
 *
 * ## Critical Paths
 * - [x] Discover → plugin detail → install to all tools
 * - [x] Tools lifecycle actions refresh detected versions in list view
 * - [x] Sync tab displays tool update items with version delta
 *
 * ## Problem Paths
 * - [x] Install failure keeps plugin detail visible
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
import { detectTool } from "./lib/tool-detect.js";
import { installTool, updateTool, uninstallTool } from "./lib/tool-lifecycle.js";

const toolLifecycleState = vi.hoisted(() => ({
  installed: false,
  installedVersion: null as string | null,
  latestVersion: "1.0.1",
  binaryPath: null as string | null,
}));

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

vi.mock("./lib/tool-detect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/tool-detect.js")>();
  return {
    ...actual,
    detectTool: vi.fn(async (entry: { toolId: string }) => {
      if (entry.toolId === "claude-code") {
        const installed = toolLifecycleState.installed;
        const installedVersion = toolLifecycleState.installedVersion;
        const latestVersion = toolLifecycleState.latestVersion;
        return {
          toolId: "claude-code",
          installed,
          binaryPath: installed ? (toolLifecycleState.binaryPath || "/usr/local/bin/claude") : null,
          installedVersion,
          latestVersion,
          hasUpdate: Boolean(installed && installedVersion && latestVersion && installedVersion !== latestVersion),
          error: null,
        };
      }

      return {
        toolId: entry.toolId,
        installed: false,
        binaryPath: null,
        installedVersion: null,
        latestVersion: null,
        hasUpdate: false,
        error: null,
      };
    }),
  };
});

vi.mock("./lib/tool-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/tool-lifecycle.js")>();
  return {
    ...actual,
    installTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") {
        onProgress({ type: "error", data: "Unknown tool" });
        return false;
      }

      toolLifecycleState.installed = true;
      toolLifecycleState.installedVersion = "1.0.0";
      toolLifecycleState.binaryPath = "/usr/local/bin/claude";
      onProgress({ type: "stdout", data: "installed" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
    updateTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") {
        onProgress({ type: "error", data: "Unknown tool" });
        return false;
      }

      toolLifecycleState.installed = true;
      toolLifecycleState.installedVersion = toolLifecycleState.latestVersion;
      toolLifecycleState.binaryPath = "/usr/local/bin/claude";
      onProgress({ type: "stdout", data: "updated" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
    uninstallTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") {
        onProgress({ type: "error", data: "Unknown tool" });
        return false;
      }

      toolLifecycleState.installed = false;
      toolLifecycleState.installedVersion = null;
      toolLifecycleState.binaryPath = null;
      onProgress({ type: "stdout", data: "removed" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
  };
});

const downArrow = "\u001B[B";
const enterKey = "\r";

const waitForFrame = async (getFrame: () => string | undefined, predicate: (frame: string) => boolean) => {
  for (let i = 0; i < 250; i += 1) {
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
  enabled: true,
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
    toolLifecycleState.installed = false;
    toolLifecycleState.installedVersion = null;
    toolLifecycleState.latestVersion = "1.0.1";
    toolLifecycleState.binaryPath = null;

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
    vi.mocked(detectTool).mockClear();
    vi.mocked(installTool).mockClear();
    vi.mocked(updateTool).mockClear();
    vi.mocked(uninstallTool).mockClear();

    useStore.setState({
      tab: "discover",
      marketplaces: [],
      installedPlugins: [],
      assets: [],
      configs: [],
      tools: createToolInstances(),
      managedTools: [],
      toolDetection: {},
      toolDetectionPending: {},
      toolActionInProgress: null,
      toolActionOutput: [],
      search: "",
      selectedIndex: 0,
      loading: false,
      error: null,
      detailPlugin: null,
      detailAsset: null,
      detailConfig: null,
      detailMarketplace: null,
      detailPiPackage: null,
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

    useStore.setState({ detailPlugin: createPlugin({ incomplete: true }), tab: "discover", selectedIndex: 0 });

    const { stdin, stdout, unmount } = render(<App />);

    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));

      await useStore.getState().installPlugin(createPlugin({ incomplete: true }));

      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));
      expect(stdout.lastFrame()).toContain("Back to plugin list");
    } finally {
      unmount();
    }
  });

  it("shows install failure without leaving detail view", async () => {
    vi.mocked(installPlugin).mockResolvedValue({
      success: false,
      linkedInstances: {},
      skippedInstances: [],
      errors: ["Install failed"],
    });

    useStore.setState({ detailPlugin: createPlugin({ incomplete: true }), tab: "discover", selectedIndex: 0 });

    const { stdin, stdout, unmount } = render(<App />);

    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Tool Status:"));

      const ok = await useStore.getState().installPlugin(createPlugin({ incomplete: true }));

      expect(ok).toBe(false);
      expect(stdout.lastFrame()).toContain("Tool Status:");
    } finally {
      unmount();
    }
  });

  it("refreshes tool version/status in tools list after lifecycle actions", async () => {
    useStore.setState({ tab: "tools", selectedIndex: 0, notifications: [] });

    const { stdout, unmount } = render(<App />);

    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Manage tools"));

      await useStore.getState().installToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("v1.0.0") && frame.includes("latest v1.0.1"));

      await useStore.getState().updateToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("v1.0.1") && frame.includes("latest v1.0.1"));

      await useStore.getState().uninstallToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Claude (claude-code:default)") && frame.includes("v—"));

      expect(vi.mocked(installTool)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateTool)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(uninstallTool)).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("shows tool update items in Sync tab with version delta", async () => {
    toolLifecycleState.installed = true;
    toolLifecycleState.installedVersion = "1.0.0";
    toolLifecycleState.latestVersion = "1.2.0";
    toolLifecycleState.binaryPath = "/usr/local/bin/claude";

    useStore.setState({ tab: "sync", selectedIndex: 0, notifications: [] });

    const { stdout, unmount } = render(<App />);

    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Update: v1.0.0 → v1.2.0"));
      expect(stdout.lastFrame()).toContain("Tool: Claude");
      expect(stdout.lastFrame()).toContain("Installed: v1.0.0");
      expect(stdout.lastFrame()).toContain("Latest: v1.2.0");
    } finally {
      unmount();
    }
  });
});
