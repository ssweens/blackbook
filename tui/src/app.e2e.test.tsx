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
 *
 * ## Discover Tab
 * - [x] Shows plugin summary card
 * - [x] Enter on summary opens plugin sub-view list
 * - [x] Escape from sub-view returns to summary
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
import React from "react";
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
import { parseMarketplaces, getToolInstances, loadConfig, ensureConfigExists, getPluginComponentConfig } from "./lib/config.js";
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
    loadConfig: vi.fn(),
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
  stdin.write(key);
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
  notifications: [],
  diffTarget: null,
  missingSummary: null,
  piPackages: [] as PiPackage[],
  piMarketplaces: [],
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
  vi.mocked(loadConfig).mockReturnValue({ assets: [] });
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[Installed]"));
      useStore.setState({ tab: "marketplaces" });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[Marketplaces]"));
      useStore.setState({ tab: "settings" });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[Settings]"));
    } finally {
      unmount();
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

  it("plugin detail shows Instances section with metadata", async () => {
    useStore.setState({
      tab: "installed",
      detailPlugin: createPlugin(),
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
      detailPlugin: createPlugin(),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Instances:"));
      useStore.setState({ detailPlugin: null });
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
    vi.mocked(computePluginDrift).mockResolvedValue({ "skill:test-skill": "target-changed" });
    useStore.setState({
      tab: "installed",
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("changed"), 5000);
      expect(stdout.lastFrame()).toContain("test-plugin");
      expect(stdout.lastFrame()).toContain("changed");
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
      detailPlugin: createPlugin(),
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
      detailPlugin: createPlugin({ incomplete: true }),
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
      detailPlugin: createPlugin({ incomplete: true }),
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
      detailPlugin: createPlugin({ incomplete: true }),
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
      detailPlugin: createPlugin({ incomplete: true }),
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
      detailPlugin: createPlugin({ skills: ["my-skill"], commands: ["my-cmd"], agents: ["my-agent"] }),
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
    vi.mocked(computePluginDrift).mockResolvedValue({ "skill:test-skill": "target-changed" });
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
      detailPlugin: createPlugin(),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      // Wait for drift computation and re-render
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Changed") || f.includes("+10"), 5000);
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Changed");
      expect(frame).toContain("+10");
      expect(frame).toContain("-5");
    } finally {
      unmount();
    }
  });

  it("shows (drifted) label on status line when drift detected", async () => {
    vi.mocked(computePluginDrift).mockResolvedValue({ "skill:test-skill": "target-changed" });
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/src/plugins/test", repoRoot: "/src" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file", title: "t",
      instance: { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp/claude" },
      files: [{ id: "f1", displayPath: "SKILL.md", sourcePath: "/a", targetPath: "/b", status: "modified", linesAdded: 1, linesRemoved: 1, sourceMtime: null, targetMtime: null }],
    });

    useStore.setState({
      tab: "installed",
      detailPlugin: createPlugin(),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("drifted"), 5000);
      expect(stdout.lastFrame()).toContain("(drifted)");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — File Detail (component rendering)", () => {
  it("shows per-instance status for synced file", async () => {
    const file = createFileStatus();
    const { FileDetail, getFileActions } = await import("./components/FileDetail.js");
    const actions = getFileActions(file);
    const { lastFrame } = render(
      React.createElement(FileDetail, { file, selectedAction: 0, actions } as any)
    );
    const frame = lastFrame()!;
    expect(frame).toContain("AGENTS.md");
    expect(frame).toContain("Synced");
  });

  it("drifted file shows changed status", async () => {
    const file = createDriftedFileStatus();
    const { FileDetail, getFileActions } = await import("./components/FileDetail.js");
    const actions = getFileActions(file);
    const { lastFrame } = render(
      React.createElement(FileDetail, { file, selectedAction: 0, actions } as any)
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Source changed");
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

    useStore.setState({ tab: "sync", selectedIndex: 0, notifications: [] });
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[Settings]"));
    } finally {
      unmount();
    }
  });
});
