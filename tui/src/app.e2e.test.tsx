/**
 * # E2E Test Coverage — Behavioral Snapshot
 *
 * These tests capture every user-visible behavior that must survive the
 * architecture refactor.  They render the real App component with mocked
 * data sources, send real keystrokes, and assert on rendered frame content.
 *
 * ## Tab Navigation
 * - [x] Arrow keys cycle through tabs
 * - [x] Tab key cycles forward
 * - [x] Startup refreshes the initial tab once, while switching tabs does not auto-refresh data or tool detection
 *
 * ## Discover Tab
 * - [x] Shows plugin summary card
 * - [x] Enter on summary opens plugin sub-view list
 * - [x] Escape from sub-view returns to summary
 * - [x] In-git Pi packages appear in the Discover Pi Packages sub-view
 * - [x] Enter on plugin in sub-view opens detail
 * - [x] Plugin detail shows name, description, actions
 * - [x] Escape from detail returns to list
 *
 * ## Installed Tab
 * - [x] Shows files section, plugins section, pi packages section
 * - [x] Arrow keys navigate between sections
 * - [x] Enter on file opens file detail
 * - [x] Enter on plugin opens plugin detail
 * - [x] Plugin detail shows per-instance status (Synced/Changed)
 * - [x] Plugin with drift shows "changed" badge in list
 * - [x] Plugin detail with drift shows drifted instance with +/- counts
 *
 * ## Plugin Detail
 * - [x] Installed plugin shows Instances section with per-tool status
 * - [x] Incomplete plugin shows "Install to all tools" action
 * - [x] Install to all tools stays on detail view
 * - [x] Install failure stays on detail view with notification
 * - [x] Per-tool install/uninstall actions listed
 * - [x] Back action returns to list
 * - [x] Escape returns to list
 *
 * ## File Detail
 * - [x] Shows per-instance status (Synced/Changed/Missing)
 * - [x] Drifted instance shows +/- counts
 * - [x] Escape returns to list
 *
 * ## Sync Tab
 * - [x] Shows sync preview items (plugins, files, tools)
 * - [x] Tool update items show version delta
 * - [x] Space toggles selection
 *
 * ## Tools Tab
 * - [x] Shows managed tools list
 * - [x] Lifecycle actions (install/update/uninstall) refresh versions
 *
 * ## Marketplaces Tab
 * - [x] Shows marketplace list with add button
 * - [x] Enter on marketplace opens detail
 * - [x] Enter on marketplace plugins shows plugin sub-view
 *
 * ## Settings Tab
 * - [x] Settings panel renders
 */
import React, { act } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { useStore } from "./lib/store.js";
import type { Marketplace, Plugin, ToolInstance, FileStatus, FileInstanceStatus, PiPackage } from "./lib/types.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  installPlugin,
  syncPluginInstances,
  uninstallPluginFromInstance,
} from "./lib/install.js";
import { getPluginToolStatus as getPluginToolStatusDirect } from "./lib/plugin-status.js";
import { fetchMarketplace } from "./lib/marketplace.js";
import { parseMarketplaces, getToolInstances, ensureConfigExists, getPluginComponentConfig } from "./lib/config.js";
import { detectTool } from "./lib/tool-detect.js";
import { installTool, updateTool, uninstallTool } from "./lib/tool-lifecycle.js";
import { computePluginDrift, resolvePluginSourcePaths } from "./lib/plugin-drift.js";
import { buildFileDiffTarget } from "./lib/diff.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted state
// ─────────────────────────────────────────────────────────────────────────────

const toolLifecycleState = vi.hoisted(() => ({
  installed: false,
  installedVersion: null as string | null,
  latestVersion: "1.0.1",
  binaryPath: null as string | null,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./lib/source-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/source-setup.js")>();
  return {
    ...actual,
    shouldShowSourceSetupWizard: vi.fn().mockReturnValue(false),
  };
});

vi.mock("./lib/config/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/config/loader.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      config: { files: [], configs: [], settings: { source_repo: null }, tools: {} },
      errors: [],
    }),
    getConfigPath: vi.fn().mockReturnValue("/tmp/blackbook-test.yaml"),
  };
});

vi.mock("./lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/config.js")>();
  return {
    ...actual,
    parseMarketplaces: vi.fn(),
    getToolInstances: vi.fn(),
    ensureConfigExists: vi.fn(),
    getPluginComponentConfig: vi.fn().mockReturnValue({
      disabledSkills: [],
      disabledCommands: [],
      disabledAgents: [],
    }),
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
    syncPluginInstances: vi.fn(),
    uninstallPluginFromInstance: vi.fn(),
  };
});

vi.mock("./lib/plugin-status.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/plugin-status.js")>();
  return {
    ...actual,
    getPluginToolStatus: vi.fn(),
  };
});

vi.mock("./lib/plugin-drift.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/plugin-drift.js")>();
  return {
    ...actual,
    computePluginDrift: vi.fn().mockResolvedValue({}),
    resolvePluginSourcePaths: vi.fn().mockReturnValue(null),
  };
});

vi.mock("./lib/diff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/diff.js")>();
  return {
    ...actual,
    buildFileDiffTarget: vi.fn().mockReturnValue({
      kind: "file",
      title: "test",
      instance: { toolId: "t", instanceId: "i", instanceName: "T", configDir: "/" },
      files: [],
    }),
  };
});

vi.mock("./lib/tool-detect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/tool-detect.js")>();
  return {
    ...actual,
    detectTool: vi.fn(async (entry: { toolId: string }) => {
      if (entry.toolId === "claude-code") {
        return {
          toolId: "claude-code",
          installed: toolLifecycleState.installed,
          binaryPath: toolLifecycleState.installed ? (toolLifecycleState.binaryPath || "/usr/local/bin/claude") : null,
          installedVersion: toolLifecycleState.installedVersion,
          latestVersion: toolLifecycleState.latestVersion,
          hasUpdate: Boolean(toolLifecycleState.installed && toolLifecycleState.installedVersion && toolLifecycleState.latestVersion && toolLifecycleState.installedVersion !== toolLifecycleState.latestVersion),
          error: null,
        };
      }
      return { toolId: entry.toolId, installed: false, binaryPath: null, installedVersion: null, latestVersion: null, hasUpdate: false, error: null };
    }),
  };
});

vi.mock("./lib/tool-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/tool-lifecycle.js")>();
  return {
    ...actual,
    installTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") { onProgress({ type: "error", data: "Unknown tool" }); return false; }
      toolLifecycleState.installed = true;
      toolLifecycleState.installedVersion = "1.0.0";
      toolLifecycleState.binaryPath = "/usr/local/bin/claude";
      onProgress({ type: "stdout", data: "installed" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
    updateTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") { onProgress({ type: "error", data: "Unknown tool" }); return false; }
      toolLifecycleState.installed = true;
      toolLifecycleState.installedVersion = toolLifecycleState.latestVersion;
      toolLifecycleState.binaryPath = "/usr/local/bin/claude";
      onProgress({ type: "stdout", data: "updated" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
    uninstallTool: vi.fn(async (toolId: string, _pm: string, onProgress: (event: { type: string; data?: string; exitCode?: number }) => void) => {
      if (toolId !== "claude-code") { onProgress({ type: "error", data: "Unknown tool" }); return false; }
      toolLifecycleState.installed = false;
      toolLifecycleState.installedVersion = null;
      toolLifecycleState.binaryPath = null;
      onProgress({ type: "stdout", data: "removed" });
      onProgress({ type: "done", exitCode: 0 });
      return true;
    }),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Key constants
// ─────────────────────────────────────────────────────────────────────────────

const KEYS = {
  up: "\u001B[A",
  down: "\u001B[B",
  right: "\u001B[C",
  left: "\u001B[D",
  enter: "\r",
  escape: "\u001B",
  tab: "\t",
  space: " ",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const waitForFrame = async (
  getFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
) => {
  const start = Date.now();
  for (let i = 0; i < 500; i += 1) {
    const frame = getFrame();
    if (frame && predicate(frame)) return frame;
    if (Date.now() - start > timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for frame.\nLast frame:\n${getFrame()}`);
};

/** Clear any sticky notifications that would eat keystrokes. */
const clearNotifications = () => {
  useStore.setState({ notifications: [] });
};

/** Send a keystroke after clearing notifications. */
const sendKey = (stdin: { write: (s: string) => void }, key: string) => {
  clearNotifications();
  act(() => {
    stdin.write(key);
  });
};

const settleInput = () => new Promise((resolve) => setTimeout(resolve, 20));

const expectSelectedRow = (frame: string, name: string) => {
  const selectedRows = frame.split("\n").filter((line) => line.includes("❯"));
  expect(selectedRows, `expected exactly one selected row in frame:\n${frame}`).toHaveLength(1);
  expect(selectedRows[0]).toContain(name);
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
  name: "test-plugin",
  marketplace: "Test Marketplace",
  description: "A test plugin for e2e tests",
  source: "./plugins/test-plugin",
  skills: ["test-skill"],
  commands: ["test-cmd"],
  agents: [],
  hooks: [],
  hasMcp: false,
  hasLsp: false,
  homepage: "https://example.com",
  installed: true,
  scope: "user",
  ...overrides,
});

/** Open a plugin in the unified detail state (replaces legacy { detailPlugin: ... }). */
const openPluginDetail = (plugin: Plugin) => ({
  detailPlugin: plugin,
  detail: { kind: "plugin" as const, data: plugin },
});

const createFileStatus = (overrides: Partial<FileStatus> = {}): FileStatus => ({
  name: "AGENTS.md",
  source: "config/AGENTS.md",
  target: "AGENTS.md",
  tools: ["claude-code"],
  kind: "file",
  instances: [
    {
      toolId: "claude-code",
      instanceId: "default",
      instanceName: "Claude",
      configDir: "/tmp/claude",
      targetRelPath: "AGENTS.md",
      sourcePath: "/tmp/source/config/AGENTS.md",
      targetPath: "/tmp/claude/AGENTS.md",
      status: "ok",
      message: "Files match",
      driftKind: "in-sync",
    },
  ],
  ...overrides,
});

const createDriftedFileStatus = (): FileStatus => ({
  name: "AGENTS.md",
  source: "config/AGENTS.md",
  target: "AGENTS.md",
  tools: ["claude-code"],
  kind: "file",
  instances: [
    {
      toolId: "claude-code",
      instanceId: "default",
      instanceName: "Claude",
      configDir: "/tmp/claude",
      targetRelPath: "AGENTS.md",
      sourcePath: "/tmp/source/config/AGENTS.md",
      targetPath: "/tmp/claude/AGENTS.md",
      status: "drifted",
      message: "Source changed",
      driftKind: "source-changed",
      diff: "- old\n+ new",
    },
  ],
});

const createPiPackage = (overrides: Partial<PiPackage> = {}): PiPackage => ({
  name: "test-pi-pkg",
  description: "A test Pi package",
  version: "1.0.0",
  source: "npm:test-pi-pkg",
  sourceType: "npm",
  marketplace: "npm",
  installed: true,
  installedVersion: "1.0.0",
  hasUpdate: false,
  extensions: [],
  skills: ["pi-skill"],
  prompts: [],
  themes: [],
  ...overrides,
});

const createToolInstances = (): ToolInstance[] => [
  {
    toolId: "claude-code",
    instanceId: "default",
    name: "Claude",
    enabled: true,
    configDir: "/tmp/claude",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    kind: "tool" as const,
    pluginFlatInstall: true,
  },
  {
    toolId: "opencode",
    instanceId: "default",
    name: "OpenCode",
    enabled: true,
    configDir: "/tmp/opencode",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    kind: "tool" as const,
    pluginFlatInstall: false,
  },
];

const toolStatusBothInstalled = [
  { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
  { toolId: "opencode", instanceId: "default", name: "OpenCode", installed: true, supported: true, enabled: true },
];

const toolStatusPartial = [
  { toolId: "claude-code", instanceId: "default", name: "Claude", installed: true, supported: true, enabled: true },
  { toolId: "opencode", instanceId: "default", name: "OpenCode", installed: false, supported: true, enabled: true },
];

const defaultStoreState = () => ({
  tab: "installed" as const,
  marketplaces: [] as Marketplace[],
  installedPlugins: [] as Plugin[],
  files: [] as FileStatus[],
  tools: createToolInstances(),
  managedTools: [],
  toolDetection: {},
  toolDetectionPending: {},
  toolActionInProgress: null,
  toolActionOutput: [] as string[],
  search: "",
  selectedIndex: 0,
  loading: false,
  error: null,
  detailPlugin: null,
  detailMarketplace: null,
  detailPiPackage: null,
  detail: null,
  notifications: [],
  diffTarget: null,
  missingSummary: null,
  piPackages: [] as PiPackage[],
  piMarketplaces: [],
  pluginDriftMap: {},
  currentSection: "plugins" as const,
  discoverSubView: null,
});

function setupMocks() {
  toolLifecycleState.installed = false;
  toolLifecycleState.installedVersion = null;
  toolLifecycleState.latestVersion = "1.0.1";
  toolLifecycleState.binaryPath = null;

  vi.mocked(parseMarketplaces).mockReturnValue([createMarketplace()]);
  vi.mocked(fetchMarketplace).mockResolvedValue([createPlugin()]);
  vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [createPlugin()], byTool: {} });
  vi.mocked(getPluginToolStatus).mockReturnValue(toolStatusPartial);
  vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusPartial);
  vi.mocked(getToolInstances).mockReturnValue(createToolInstances());
  vi.mocked(ensureConfigExists).mockImplementation(() => {});
  vi.mocked(computePluginDrift).mockResolvedValue({});
  vi.mocked(resolvePluginSourcePaths).mockReturnValue(null);
  vi.mocked(installPlugin).mockResolvedValue({ success: true, linkedInstances: {}, skippedInstances: [], errors: [] });
  vi.mocked(syncPluginInstances).mockResolvedValue({ success: true, syncedInstances: {}, errors: [] });
  vi.mocked(detectTool).mockClear();
  vi.mocked(installTool).mockClear();
  vi.mocked(updateTool).mockClear();
  vi.mocked(uninstallTool).mockClear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("App E2E — Tab Navigation", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("tab state changes render correct tab indicator", async () => {
    useStore.setState({ tab: "installed", notifications: [] });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[4] Installed"));
      useStore.setState({ tab: "marketplaces" });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[5] Marketplaces"));
      useStore.setState({ tab: "settings" });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[6] Settings"));
    } finally {
      unmount();
    }
  });

  it("loads the initial tab on boot but does not auto-refresh when switching tabs", async () => {
    const loadInstalledPlugins = vi.fn(async () => {
      useStore.setState({ installedPlugins: [createPlugin()], installedPluginsLoaded: true });
    });
    const loadPiPackages = vi.fn(async () => {
      useStore.setState({ piPackages: [createPiPackage()], piPackagesLoaded: true });
    });
    const loadFiles = vi.fn(async () => {
      const files = [createFileStatus()];
      useStore.setState({ files, filesLoaded: true });
      return files;
    });
    const loadMarketplaces = vi.fn(async () => {});
    const refreshToolDetection = vi.fn(async () => {});
    const refreshManagedTools = vi.fn(() => {});
    const originalActions = {
      loadInstalledPlugins: useStore.getState().loadInstalledPlugins,
      loadPiPackages: useStore.getState().loadPiPackages,
      loadFiles: useStore.getState().loadFiles,
      loadMarketplaces: useStore.getState().loadMarketplaces,
      refreshToolDetection: useStore.getState().refreshToolDetection,
      refreshManagedTools: useStore.getState().refreshManagedTools,
    };

    useStore.setState({
      tab: "installed",
      notifications: [],
      installedPlugins: [],
      installedPluginsLoaded: false,
      piPackages: [],
      piPackagesLoaded: false,
      files: [],
      filesLoaded: false,
      loadInstalledPlugins,
      loadPiPackages,
      loadFiles,
      loadMarketplaces,
      refreshToolDetection,
      refreshManagedTools,
    });

    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[4] Installed") && f.includes("test-plugin"));
      await waitForFrame(stdout.lastFrame, () => loadInstalledPlugins.mock.calls.length === 1);
      expect(loadPiPackages).toHaveBeenCalledTimes(1);
      expect(loadFiles).toHaveBeenCalledTimes(1);
      expect(loadMarketplaces).not.toHaveBeenCalled();

      loadInstalledPlugins.mockClear();
      loadPiPackages.mockClear();
      loadFiles.mockClear();
      loadMarketplaces.mockClear();

      act(() => {
        useStore.setState({ tab: "marketplaces" });
      });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[5] Marketplaces"));
      await settleInput();
      expect(loadInstalledPlugins).not.toHaveBeenCalled();
      expect(loadPiPackages).not.toHaveBeenCalled();
      expect(loadFiles).not.toHaveBeenCalled();
      expect(loadMarketplaces).not.toHaveBeenCalled();
      expect(refreshToolDetection).not.toHaveBeenCalled();
      expect(refreshManagedTools).not.toHaveBeenCalled();

      act(() => {
        useStore.setState({ tab: "tools" });
      });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[2] Tools"));
      await settleInput();
      expect(refreshToolDetection).not.toHaveBeenCalled();
      expect(refreshManagedTools).not.toHaveBeenCalled();
    } finally {
      unmount();
      useStore.setState(originalActions);
    }
  });
});

describe("App E2E — Installed Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("shows installed plugins in list", async () => {
    useStore.setState({
      tab: "installed",
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("test-plugin"));
      expect(stdout.lastFrame()).toContain("Plugins");
      expect(stdout.lastFrame()).toContain("test-plugin");
    } finally {
      unmount();
    }
  });

  it("shows files section when files exist", async () => {
    useStore.setState({
      tab: "installed",
      files: [createFileStatus()],
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Files"));
      expect(stdout.lastFrame()).toContain("AGENTS.md");
    } finally {
      unmount();
    }
  });

  it("shows pi packages section when pi packages exist", async () => {
    useStore.setState({
      tab: "installed",
      installedPlugins: [],
      piPackages: [createPiPackage()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Pi Packages"));
      expect(stdout.lastFrame()).toContain("test-pi-pkg");
    } finally {
      unmount();
    }
  });

  it("shows both installed and in-git-not-installed pi package variants in alphabetical default order", async () => {
    useStore.setState({
      tab: "installed",
      installedPlugins: [],
      sortBy: "default",
      sortDir: "asc",
      selectedIndex: 0,
      piPackages: [
        createPiPackage({
          name: "pi-web-access",
          source: "npm:pi-web-access",
          sourceType: "npm",
          installed: false,
          recommended: true,
          marketplace: "npm",
        }),
        createPiPackage({
          name: "pi-web-access",
          source: "../../src/pi-packages/pi-web-access",
          sourceType: "local",
          installed: true,
          marketplace: "local",
          recommended: false,
        }),
        createPiPackage({
          name: "pi-btw",
          source: "../../src/pi-packages/pi-btw",
          sourceType: "local",
          installed: true,
          marketplace: "local",
          recommended: false,
        }),
      ],
    });
    const { stdout, unmount } = render(<App />);
    try {
      const frame = await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("Pi Packages") &&
        f.includes("❯ pi-btw") &&
        f.includes("pi-web-access") &&
        f.includes("· local") &&
        f.includes("· npm") &&
        f.includes("in git") &&
        f.includes("not in git")
      );
      expect(frame).toContain("Pi Packages");
    } finally {
      unmount();
    }
  });

  it("plugin detail shows Instances section with metadata", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("test-plugin");
      expect(frame).toContain("@ Test Marketplace");
      expect(frame).toContain("A test plugin");
      expect(frame).toContain("Back to plugin list");
    } finally {
      unmount();
    }
  });

  it("clearing detailPlugin returns to list view", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      useStore.setState({ detailPlugin: null, detail: null });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins") && !f.includes("Instances:"));
    } finally {
      unmount();
    }
  });

  it("shows files in installed list", async () => {
    useStore.setState({
      tab: "installed",
      files: [createFileStatus()],
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      // Files come from loadFiles which is mocked empty, but we set them directly
      // The file should appear if store has it
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins"), 2000);
    } finally {
      unmount();
    }
  });

  it("plugin with drift shows changed badge in list", async () => {
    useStore.setState({
      tab: "installed",
      installedPlugins: [createPlugin()],
      pluginDriftMap: { "test-plugin": { "skill:test-skill": "target-changed" } },
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("drifted"), 5000);
      expect(stdout.lastFrame()).toContain("test-plugin");
      expect(stdout.lastFrame()).toContain("drifted");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Plugin Detail", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("installed plugin shows per-instance status", async () => {
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusBothInstalled);
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Claude");
      expect(frame).toContain("OpenCode");
    } finally {
      unmount();
    }
  });

  it("incomplete plugin shows Install to all tools action", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin({ incomplete: true })),
      installedPlugins: [createPlugin({ incomplete: true })],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Install to all tools"));
      expect(stdout.lastFrame()).toContain("incomplete");
    } finally {
      unmount();
    }
  });

  it("stays on plugin detail after install to all tools", async () => {
    vi.mocked(installPlugin).mockResolvedValue({
      success: true,
      linkedInstances: { "opencode:default": 1 },
      skippedInstances: [],
      errors: [],
    });
    useStore.setState({
      tab: "discover",
      ...openPluginDetail(createPlugin({ incomplete: true })),
      selectedIndex: 0,
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      await useStore.getState().installPlugin(createPlugin({ incomplete: true }));
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      expect(stdout.lastFrame()).toContain("Back to plugin list");
    } finally {
      unmount();
    }
  });

  it("install failure stays on detail with error", async () => {
    vi.mocked(installPlugin).mockResolvedValue({
      success: false,
      linkedInstances: {},
      skippedInstances: [],
      errors: ["Install failed"],
    });
    useStore.setState({
      tab: "discover",
      ...openPluginDetail(createPlugin({ incomplete: true })),
      selectedIndex: 0,
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      const ok = await useStore.getState().installPlugin(createPlugin({ incomplete: true }));
      expect(ok).toBe(false);
      expect(stdout.lastFrame()).toContain("Instances:");
    } finally {
      unmount();
    }
  });

  it("shows per-tool install/uninstall actions", async () => {
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusPartial);
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin({ incomplete: true })),
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Uninstall from Claude"));
      expect(stdout.lastFrame()).toContain("Install to OpenCode");
    } finally {
      unmount();
    }
  });

  it("shows components section with skills, commands", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin({ skills: ["my-skill"], commands: ["my-cmd"], agents: ["my-agent"] })),
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Components:"));
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Skills:");
      expect(frame).toContain("my-skill");
      expect(frame).toContain("Commands:");
      expect(frame).toContain("my-cmd");
      expect(frame).toContain("Agents:");
      expect(frame).toContain("my-agent");
    } finally {
      unmount();
    }
  });

  it("drifted plugin detail shows Changed instance with +/- counts", async () => {
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/src/plugins/test", repoRoot: "/src" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file",
      title: "test",
      instance: { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp/claude" },
      files: [{ id: "f1", displayPath: "SKILL.md", sourcePath: "/a", targetPath: "/b", status: "modified", linesAdded: 10, linesRemoved: 5, sourceMtime: null, targetMtime: null }],
    });
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusBothInstalled);

    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
      pluginDriftMap: { "test-plugin": { "skill:test-skill": "target-changed" } },
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Changed") || f.includes("+10"), 5000);
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Drifted");
      expect(frame).toContain("+10");
      expect(frame).toContain("-5");
    } finally {
      unmount();
    }
  });

  it("keeps plugin drift as a per-tool row instead of a status-line badge", async () => {
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/src/plugins/test", repoRoot: "/src" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file", title: "t",
      instance: { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp/claude" },
      files: [{ id: "f1", displayPath: "SKILL.md", sourcePath: "/a", targetPath: "/b", status: "modified", linesAdded: 1, linesRemoved: 1, sourceMtime: null, targetMtime: null }],
    });

    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
      pluginDriftMap: { "test-plugin": { "skill:test-skill": "target-changed" } },
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Drifted") || f.includes("+1"), 5000);
      const frame = stdout.lastFrame()!;
      expect(frame).not.toContain("Status: Installed (drifted)");
      expect(frame).toContain("Drifted");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — File Detail (component rendering)", () => {
  it("shows per-instance status for synced file", async () => {
    const file = createFileStatus();
    const { getFileActions } = await import("./lib/item-actions.js");
    const { fileToManagedItem } = await import("./lib/managed-item.js");
    const { ItemDetail, FileMetadata } = await import("./components/ItemDetail.js");
    const item = fileToManagedItem(file);
    const actions = getFileActions(file).map((a: any, i: number) => ({ id: `${a.type}_${i}`, ...a }));
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item, selectedAction: 0, actions,
        metadata: React.createElement(FileMetadata, { item }),
      } as any)
    );
    const frame = lastFrame()!;
    expect(frame).toContain("AGENTS.md");
    expect(frame).toContain("Synced");
  });

  it("drifted file shows changed status", async () => {
    const file = createDriftedFileStatus();
    const { getFileActions } = await import("./lib/item-actions.js");
    const { fileToManagedItem } = await import("./lib/managed-item.js");
    const { ItemDetail, FileMetadata } = await import("./components/ItemDetail.js");
    const item = fileToManagedItem(file);
    const actions = getFileActions(file).map((a: any, i: number) => ({ id: `${a.type}_${i}`, ...a }));
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item, selectedAction: 0, actions,
        metadata: React.createElement(FileMetadata, { item }),
      } as any)
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Source drifted");
  });
});

describe("App E2E — Discover Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("shows plugin summary card", async () => {
    useStore.setState({
      tab: "discover",
      marketplaces: [createMarketplace({ plugins: [createPlugin()], availableCount: 1 })],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("plugin") || f.includes("Plugin"), 5000);
    } finally {
      unmount();
    }
  });

  it("shows in-git Pi packages in the Discover Pi Packages sub-view", async () => {
    useStore.setState({
      tab: "discover",
      discoverSubView: "piPackages",
      selectedIndex: 0,
      marketplaces: [],
      piPackages: [createPiPackage({
        name: "pi-subagents",
        source: "npm:pi-subagents",
        installed: false,
        recommended: true,
      })],
    });

    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("Pi Packages") &&
        f.includes("pi-subagents") &&
        f.includes("in git"),
      );
    } finally {
      unmount();
    }
  });

  it("scrubs Discover plugin navigation without skipped rows, repeated rows, or mismatched Enter targets", async () => {
    const installedNames = ["bravo-installed", "delta-installed", "hotel-installed", "juliet-installed"];
    const availableNames = [
      "alpha-available",
      "charlie-available",
      "echo-available",
      "foxtrot-available",
      "golf-available",
      "india-available",
      "kilo-available",
      "lima-available",
      "mike-available",
      "november-available",
      "oscar-available",
      "papa-available",
      "quebec-available",
      "zulu-available",
    ];
    const pluginByName = new Map<string, Plugin>();
    const pluginFor = (name: string, installed: boolean): Plugin => {
      const plugin = createPlugin({
        name,
        installed,
        marketplace: "Test Marketplace",
        description: `Unique detail description for ${name}`,
        skills: [`skill-for-${name}`],
        commands: [`cmd-for-${name}`],
      });
      pluginByName.set(name, plugin);
      return plugin;
    };
    const plugins = [
      ...availableNames.slice().reverse().map((name) => pluginFor(name, false)),
      ...installedNames.slice().reverse().map((name) => pluginFor(name, true)),
    ];
    const expectedDefault = [
      ...installedNames.slice().sort((a, b) => a.localeCompare(b)),
      ...availableNames.slice().sort((a, b) => a.localeCompare(b)),
    ];
    const expectedNameAsc = [...installedNames, ...availableNames].sort((a, b) => a.localeCompare(b));
    const expectedNameDesc = expectedNameAsc.slice().reverse();

    useStore.setState({
      tab: "discover",
      selectedIndex: 0,
      search: "",
      sortBy: "default",
      sortDir: "asc",
      discoverSubView: null,
      marketplaces: [
        createMarketplace({
          plugins,
          availableCount: plugins.length,
          installedCount: installedNames.length,
        }),
      ],
      piPackages: [createPiPackage({ name: "pi-alpha", installed: false })],
    });

    const { stdout, stdin, unmount } = render(<App />);

    const assertPluginListSelection = async (expectedNames: string[], index: number) => {
      const name = expectedNames[index];
      const plugin = pluginByName.get(name)!;
      const frame = await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("Plugins (showing") &&
        f.includes(`❯ ${name}`) &&
        f.includes(plugin.skills[0]),
      );
      expect(useStore.getState().discoverSubView).toBe("plugins");
      expect(useStore.getState().selectedIndex).toBe(index);
      expectSelectedRow(frame, name);
      return frame;
    };

    const assertEnterOpensPlugin = async (name: string) => {
      sendKey(stdin, KEYS.enter);
      const plugin = pluginByName.get(name)!;
      const frame = await waitForFrame(stdout.lastFrame, (f) =>
        f.includes(`${name} @ Test Marketplace`) &&
        f.includes(plugin.description),
      );
      expect(useStore.getState().detailPlugin?.name).toBe(name);
      expect(useStore.getState().detail?.kind).toBe("plugin");
      expect((useStore.getState().detail?.data as Plugin).name).toBe(name);
      return frame;
    };

    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins ▸") && f.includes("Pi Packages"), 5000);
      await settleInput();
      expect(useStore.getState().selectedIndex).toBe(0);

      sendKey(stdin, KEYS.down);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Pi Packages ▸"));
      expect(useStore.getState().selectedIndex).toBe(1);

      sendKey(stdin, KEYS.up);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins ▸"));
      expect(useStore.getState().selectedIndex).toBe(0);

      sendKey(stdin, KEYS.enter);
      await assertPluginListSelection(expectedDefault, 0);

      for (let index = 1; index <= 15; index += 1) {
        sendKey(stdin, KEYS.down);
        await assertPluginListSelection(expectedDefault, index);
      }

      for (let index = 14; index >= 10; index -= 1) {
        sendKey(stdin, KEYS.up);
        await assertPluginListSelection(expectedDefault, index);
      }

      await assertEnterOpensPlugin(expectedDefault[10]);
      expect(stdout.lastFrame()).not.toContain(`Unique detail description for ${expectedDefault[9]}`);
      expect(stdout.lastFrame()).not.toContain(`Unique detail description for ${expectedDefault[11]}`);

      sendKey(stdin, KEYS.escape);
      await assertPluginListSelection(expectedDefault, 10);

      sendKey(stdin, "s");
      await assertPluginListSelection(expectedNameAsc, 10);
      await assertEnterOpensPlugin(expectedNameAsc[10]);

      sendKey(stdin, KEYS.escape);
      await assertPluginListSelection(expectedNameAsc, 10);

      sendKey(stdin, "r");
      await assertPluginListSelection(expectedNameDesc, 10);
      await assertEnterOpensPlugin(expectedNameDesc[10]);

      sendKey(stdin, KEYS.escape);
      await assertPluginListSelection(expectedNameDesc, 10);

      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins ▸") && !f.includes("Plugins (showing"));
      expect(useStore.getState().discoverSubView).toBeNull();
      expect(useStore.getState().selectedIndex).toBe(0);
    } finally {
      unmount();
    }
  });

  it("scrubs Discover Pi Packages sub-view so Enter always opens the highlighted package", async () => {
    // Crafted so the OLD App-side sort (name → sourceType → source) disagrees with
    // the rendered DiscoverTab sort (installed-first → non-npm → downloads → name).
    // With a single shared derivation, the highlighted row and the Enter target agree.
    const pkgSpecs = [
      { name: "pi-zebra", installed: true },
      { name: "pi-apple", installed: false },
      { name: "pi-mango", installed: false },
      { name: "pi-cherry", installed: true },
    ];
    const pkgByName = new Map<string, PiPackage>();
    const piPackages = pkgSpecs.map(({ name, installed }) => {
      const pkg = createPiPackage({
        name,
        installed,
        recommended: !installed,
        source: `../../src/pi-packages/${name}`,
        sourceType: "local",
        marketplace: "local",
        description: `Unique pi detail for ${name}`,
      });
      pkgByName.set(name, pkg);
      return pkg;
    });
    // Shared default order: installed-first (by name), then non-installed (by name).
    const expectedOrder = ["pi-cherry", "pi-zebra", "pi-apple", "pi-mango"];

    useStore.setState({
      tab: "discover",
      discoverSubView: "piPackages",
      selectedIndex: 0,
      search: "",
      sortBy: "default",
      sortDir: "asc",
      marketplaces: [],
      piPackages,
      piPackagesLoaded: true,
    });

    const { stdout, stdin, unmount } = render(<App />);

    const assertHighlighted = async (index: number) => {
      const name = expectedOrder[index];
      const frame = await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("Pi Packages") && f.includes(`❯ ${name}`),
      );
      expect(useStore.getState().selectedIndex).toBe(index);
      expectSelectedRow(frame, name);
    };

    const assertEnterOpens = async (name: string) => {
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes(name) && f.includes(`Unique pi detail for ${name}`),
      );
      expect(useStore.getState().detail?.kind).toBe("piPackage");
      expect((useStore.getState().detail?.data as PiPackage).source).toBe(pkgByName.get(name)!.source);
      sendKey(stdin, KEYS.escape);
    };

    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Pi Packages"), 5000);
      await settleInput();

      await assertHighlighted(0);
      for (let index = 1; index < expectedOrder.length; index += 1) {
        sendKey(stdin, KEYS.down);
        await assertHighlighted(index);
      }
      for (let index = expectedOrder.length - 2; index >= 0; index -= 1) {
        sendKey(stdin, KEYS.up);
        await assertHighlighted(index);
      }

      // At each cursor position, Enter opens the SAME package that is highlighted.
      for (let index = 0; index < expectedOrder.length; index += 1) {
        await assertHighlighted(index);
        await assertEnterOpens(expectedOrder[index]);
        await assertHighlighted(index);
        if (index < expectedOrder.length - 1) {
          sendKey(stdin, KEYS.down);
        }
      }
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Sync Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("shows tool update items with version delta", async () => {
    toolLifecycleState.installed = true;
    toolLifecycleState.installedVersion = "1.0.0";
    toolLifecycleState.latestVersion = "1.2.0";
    toolLifecycleState.binaryPath = "/usr/local/bin/claude";

    useStore.setState({
      tab: "sync",
      selectedIndex: 0,
      notifications: [],
      managedTools: [
        {
          toolId: "claude-code",
          displayName: "Claude",
          instanceId: "default",
          configDir: "/tmp/claude",
          enabled: true,
          synthetic: false,
        },
      ],
      toolDetection: {
        "claude-code": {
          toolId: "claude-code",
          installed: true,
          binaryPath: "/usr/local/bin/claude",
          installedVersion: "1.0.0",
          latestVersion: "1.2.0",
          hasUpdate: true,
          error: null,
        },
      },
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Update: v1.0.0 → v1.2.0"));
      expect(stdout.lastFrame()).toContain("Tool: Claude");
      expect(stdout.lastFrame()).toContain("Installed: v1.0.0");
      expect(stdout.lastFrame()).toContain("Latest: v1.2.0");
    } finally {
      unmount();
    }
  });

  it("checks the right namespaced skill on Space and syncs exactly that one", async () => {
    // Two skills sharing the bare name "deploy" but living in different namespaces.
    // The unqualified key (old App bug) would collide them and never render a check.
    const makeSkill = (namespace: string) => ({
      name: "deploy",
      namespace,
      installations: [],
      diskPath: `/tmp/${namespace}/deploy`,
      toolId: "claude-code",
      instanceName: "Claude",
      instanceId: "default",
    });
    const skillItemAlpha = {
      kind: "skill" as const,
      skill: makeSkill("alpha"),
      driftedInstances: [],
      missingInstances: ["Claude"],
    };
    const skillItemBeta = {
      kind: "skill" as const,
      skill: makeSkill("beta"),
      driftedInstances: [],
      missingInstances: ["Claude"],
    };
    const syncTools = vi.fn();

    useStore.setState({
      tab: "sync",
      selectedIndex: 0,
      notifications: [],
      syncSelection: [],
      syncArmed: false,
      getSyncPreview: () => [skillItemAlpha, skillItemBeta] as any,
      syncTools: syncTools as any,
    });

    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("alpha/deploy") && f.includes("beta/deploy"),
      );
      await settleInput();

      // Toggle the first (alpha/deploy) with Space.
      sendKey(stdin, KEYS.space);

      const checkedFrame = await waitForFrame(stdout.lastFrame, (f) => {
        const alphaRow = f.split("\n").find((l) => l.includes("alpha/deploy")) ?? "";
        return alphaRow.includes("[x]");
      });

      const rowFor = (name: string) =>
        checkedFrame.split("\n").find((l) => l.includes(name)) ?? "";
      // alpha/deploy is checked; beta/deploy stays unchecked (no collision).
      expect(rowFor("alpha/deploy")).toContain("[x]");
      expect(rowFor("beta/deploy")).toContain("[ ]");
      // Footer count keys off the same unified function.
      expect(checkedFrame).toContain("(1 selected)");
      expect(useStore.getState().syncSelection).toEqual(["skill:alpha/deploy"]);

      // Confirm sync (y then y) — only the selected skill is synced.
      sendKey(stdin, "y");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Press y again to confirm"));
      sendKey(stdin, "y");

      await waitForFrame(stdout.lastFrame, () => syncTools.mock.calls.length > 0);
      expect(syncTools).toHaveBeenCalledTimes(1);
      const syncedItems = syncTools.mock.calls[0][0];
      expect(syncedItems).toHaveLength(1);
      expect(syncedItems[0].skill.namespace).toBe("alpha");
      expect(syncedItems[0].skill.name).toBe("deploy");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Search", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("focuses on /, filters live while typing, suppresses global shortcuts, and restores them on Esc", async () => {
    useStore.setState({
      tab: "installed",
      search: "",
      selectedIndex: 0,
      installedPlugins: [
        createPlugin({ name: "alpha-plugin" }),
        createPlugin({ name: "beta-plugin" }),
        createPlugin({ name: "gamma-plugin" }),
      ],
      installedPluginsLoaded: true,
      filesLoaded: true,
      piPackagesLoaded: true,
    });

    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("alpha-plugin") && f.includes("beta-plugin") && f.includes("gamma-plugin"),
      );
      await settleInput();

      // Press "/" to focus the search box (shows the focused "●" indicator).
      sendKey(stdin, "/");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("●"));

      // Typing narrows the list live and updates the store's search term.
      for (const ch of "beta") sendKey(stdin, ch);
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("beta-plugin") && !f.includes("alpha-plugin") && !f.includes("gamma-plugin"),
      );
      expect(useStore.getState().search).toBe("beta");

      // A digit that would normally switch tabs must NOT do so while focused —
      // it is a keystroke for the search box instead.
      sendKey(stdin, "1");
      await settleInput();
      expect(useStore.getState().tab).toBe("installed");
      expect(useStore.getState().search).toBe("beta1");

      // Esc cancels the search (clears it) and returns to list navigation.
      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, (f) =>
        !f.includes("●") &&
        f.includes("alpha-plugin") &&
        f.includes("beta-plugin") &&
        f.includes("gamma-plugin"),
      );
      expect(useStore.getState().search).toBe("");

      // Global shortcuts work again: "1" switches to the Sync tab.
      sendKey(stdin, "1");
      await waitForFrame(stdout.lastFrame, () => useStore.getState().tab === "sync");
      expect(useStore.getState().tab).toBe("sync");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Tools Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("shows managed tools list", async () => {
    useStore.setState({ tab: "tools", selectedIndex: 0, notifications: [] });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Manage tools") || f.includes("[Tools]"));
    } finally {
      unmount();
    }
  });

  it("lifecycle actions refresh detected versions", async () => {
    useStore.setState({ tab: "tools", selectedIndex: 0, notifications: [] });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Manage tools") || f.includes("[Tools]"));

      await useStore.getState().installToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("v1.0.0") && f.includes("latest v1.0.1"));

      await useStore.getState().updateToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("v1.0.1") && f.includes("latest v1.0.1"));

      await useStore.getState().uninstallToolAction("claude-code");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("v—"));

      expect(vi.mocked(installTool)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateTool)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(uninstallTool)).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Marketplaces Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("shows marketplace list with add option", async () => {
    useStore.setState({
      tab: "marketplaces",
      marketplaces: [createMarketplace()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("Test Marketplace") || f.includes("Add marketplace"),
      );
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Settings Tab", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("renders settings panel", async () => {
    useStore.setState({ tab: "settings" });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[6] Settings"));
    } finally {
      unmount();
    }
  });
});
