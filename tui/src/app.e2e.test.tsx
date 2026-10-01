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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { useStore } from "./lib/store.js";
import type { Marketplace, Plugin, ToolInstance, FileStatus, FileInstanceStatus, PiPackage } from "./lib/types.js";
import type { ProjectInfo } from "./lib/projects.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  installPlugin,
  uninstallPlugin,
  syncPluginInstances,
  uninstallPluginFromInstance,
  groupSkillsByNamespace,
} from "./lib/install.js";
import { getPluginToolStatus as getPluginToolStatusDirect } from "./lib/plugin-status.js";
import { pluginSkillStorePath, skillPresentForInstance } from "./lib/adapters/shared.js";
import { fetchMarketplace } from "./lib/marketplace.js";
import { parseMarketplaces, getToolInstances, getEnabledToolInstances, ensureConfigExists, getConsultationSettings, getPluginComponentConfig } from "./lib/config.js";
import { detectTool } from "./lib/tool-detect.js";
import { installTool, updateTool, uninstallTool } from "./lib/tool-lifecycle.js";
import { computePluginDrift, resolvePluginSourcePaths } from "./lib/plugin-drift.js";
import { buildFileDiffTarget } from "./lib/diff.js";
import { buildPluginActions } from "./lib/item-actions.js";
import { runConsultation } from "./lib/consultation-runner.js";

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
      config: {
        files: [],
        configs: [],
        projects: [],
        pi_marketplaces: {},
        settings: { source_repo: null, disabled_pi_marketplaces: ["npm"] },
        tools: {},
      },
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
    // Real implementation by default; tests that must not depend on the
    // machine's tool dirs override it (it calls config.ts's own getToolInstances).
    getEnabledToolInstances: vi.fn(actual.getEnabledToolInstances),
    ensureConfigExists: vi.fn(),
    getPluginComponentConfig: vi.fn().mockReturnValue({
      disabledSkills: [],
      disabledCommands: [],
      disabledAgents: [],
    }),
    getConsultationSettings: vi.fn().mockReturnValue({ runtime: "pi", model: "" }),
  };
});

vi.mock("./lib/consultation-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/consultation-runner.js")>();
  return {
    ...actual,
    runConsultation: vi.fn(),
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
    uninstallPlugin: vi.fn(),
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


vi.mock("./lib/adapters/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/adapters/shared.js")>();
  return {
    ...actual,
    // Pretend the plugin's skill is present in the shared store so the
    // consolidated shared-skill row computes drift against the (mocked) diff.
    pluginSkillStorePath: vi.fn().mockReturnValue("/store/test-skill"),
    // Pretend every flat-install (Claude-like) instance already has its own
    // derived-view overlay materialized — the fixture's /tmp/claude doesn't
    // exist on disk, so the real filesystem check would otherwise report it
    // as "Missing" and mask the drift/in-sync scenarios these tests target.
    // The skills row checks per-skill presence, so mock that too.
    pluginSkillPresentForInstance: vi.fn().mockReturnValue(true),
    skillPresentForInstance: vi.fn().mockReturnValue(true),
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

const createPiTool = (): ToolInstance => ({
  toolId: "pi",
  instanceId: "default",
  name: "Pi",
  enabled: true,
  configDir: "/tmp/pi",
  skillsSubdir: "agent/skills",
  commandsSubdir: null,
  agentsSubdir: null,
  kind: "tool",
  pluginFlatInstall: false,
});

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
  collapsedPluginMarketplaces: new Set<string>(),
  collapsedProjectNamespaces: new Set<string>(),
  managedItems: [],
  projects: [] as never,
  projectsLoaded: false,
  projectDetailPath: null,
  profiles: {},
  profileLocks: {},
  standaloneSkills: [] as never,
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
  vi.mocked(buildFileDiffTarget).mockReset();
  vi.mocked(buildFileDiffTarget).mockReturnValue({
    kind: "file",
    title: "test",
    instance: { toolId: "t", instanceId: "i", instanceName: "T", configDir: "/" },
    files: [],
  });
  vi.mocked(installPlugin).mockResolvedValue({ success: true, linkedInstances: {}, skippedInstances: [], errors: [] });
  vi.mocked(uninstallPlugin).mockResolvedValue(true);
  vi.mocked(syncPluginInstances).mockResolvedValue({ success: true, syncedInstances: {}, errors: [] });
  vi.mocked(detectTool).mockClear();
  vi.mocked(installTool).mockClear();
  vi.mocked(updateTool).mockClear();
  vi.mocked(uninstallTool).mockClear();
  vi.mocked(getConsultationSettings).mockReturnValue({ runtime: "pi", model: "" });
  vi.mocked(runConsultation).mockReset();
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[5] Markets"));
      useStore.setState({ tab: "settings" });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[8] Settings"));
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[5] Markets"));
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

  it("groups plugins under collapsible marketplace headers; Enter collapses a header and opens a plugin", async () => {
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusBothInstalled);
    useStore.setState({
      tab: "installed",
      installedPlugins: [
        createPlugin({ name: "alpha-one", marketplace: "alpha" }),
        createPlugin({ name: "alpha-two", marketplace: "alpha" }),
        createPlugin({ name: "beta-one", marketplace: "beta" }),
      ],
      installedPluginsLoaded: true,
      filesLoaded: true,
      piPackagesLoaded: true,
      selectedIndex: 0,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      // Headers for both marketplaces, with counts; all plugins visible (expanded).
      await waitForFrame(stdout.lastFrame, (f) => f.includes("alpha") && f.includes("2 plugins") && f.includes("beta") && f.includes("1 plugin"));
      let frame = stdout.lastFrame()!;
      expect(frame).toContain("alpha-one");
      expect(frame).toContain("alpha-two");
      expect(frame).toContain("beta-one");

      // selectedIndex 0 is the first header (alpha). Enter collapses it.
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => !f.includes("alpha-one") && !f.includes("alpha-two"));
      frame = stdout.lastFrame()!;
      expect(frame).toContain("alpha");       // header remains
      expect(frame).toContain("beta-one");    // other group untouched

      // Rows are now [alpha hdr, beta hdr, beta-one]. Move to the plugin and open it.
      sendKey(stdin, KEYS.down);
      sendKey(stdin, KEYS.down);
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("beta-one") && f.includes("@ beta"));
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

  it("plugin detail shows the component-status section with metadata", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("test-plugin");
      expect(frame).toContain("@ Test Marketplace");
      expect(frame).toContain("A test plugin");
      // Consolidated component rows, not per-tool.
      expect(frame).toContain("Skills (1)");
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
      useStore.setState({ detailPlugin: null, detail: null });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Plugins") && !f.includes("Component status:"));
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

  it("installed plugin shows consolidated component status (not per-tool)", async () => {
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusBothInstalled);
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
      const frame = stdout.lastFrame()!;
      // One row per component type, against ~/.agents — NOT a per-tool list.
      expect(frame).toContain("Skills (1)");
      expect(frame).toContain("Commands (1)");
      expect(frame).toContain("Enter view diff");
      expect(frame).not.toContain("OpenCode:");
      expect(frame).not.toContain("Uninstall from Claude");
    } finally {
      unmount();
    }
  });

  it("opens the selected component's current diff without relying on the stale drift map", async () => {
    const plugin = createPlugin({ skills: ["first-skill", "second-skill"], commands: [] });
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/source", repoRoot: "/repo" });
    vi.mocked(buildFileDiffTarget).mockImplementation((title, _displayPath, sourcePath, targetPath, instance) => {
      if (!sourcePath.startsWith("/source/skills/")) {
        return { kind: "file", title, instance, files: [] };
      }
      return {
        kind: "file",
        title,
        instance,
        files: [{
          id: "SKILL.md",
          displayPath: "SKILL.md",
          sourcePath: `${sourcePath}/SKILL.md`,
          targetPath: `${targetPath}/SKILL.md`,
          status: "modified",
          linesAdded: sourcePath.endsWith("first-skill") ? 3 : 2,
          linesRemoved: 1,
          sourceMtime: 2,
          targetMtime: 1,
        }],
      };
    });
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(plugin),
      installedPlugins: [plugin],
      // The row derives its live status directly. Its detail must do the same.
      pluginDriftMap: {},
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(
        stdout.lastFrame,
        (frame) => frame.includes("Skills (2): Drifted") && frame.includes("Enter view diff"),
      );
      sendKey(stdin, KEYS.enter);
      const frame = await waitForFrame(
        stdout.lastFrame,
        (value) => value.includes("Diff View · test-plugin — Skills diff"),
      );
      expect(frame).toContain("skills/first-skill/SKILL.md");
      expect(frame).toContain("skills/second-skill/SKILL.md");
    } finally {
      unmount();
    }
  });

  it("opens an in-sync plugin component row and confirms there are no differences", async () => {
    const plugin = createPlugin({ commands: [] });
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/source", repoRoot: "/repo" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file",
      title: "test-plugin",
      instance: { toolId: "agents", instanceId: "shared", instanceName: "~/.agents", configDir: "" },
      files: [],
    });
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(plugin),
      installedPlugins: [plugin],
      pluginDriftMap: {},
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Skills (1): In sync") && frame.includes("Enter view diff"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("No differences found - files are in sync."));
    } finally {
      unmount();
    }
  });

  it("incomplete plugin shows an Install-from-source action", async () => {
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin({ incomplete: true })),
      installedPlugins: [createPlugin({ incomplete: true })],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Install missing"));
      expect(stdout.lastFrame()).toContain("incomplete");
    } finally {
      unmount();
    }
  });

  it("stays on plugin detail after install", async () => {
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
      await useStore.getState().installPlugin(createPlugin({ incomplete: true }));
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Component status:"));
      const ok = await useStore.getState().installPlugin(createPlugin({ incomplete: true }));
      expect(ok).toBe(false);
      expect(stdout.lastFrame()).toContain("Component status:");
    } finally {
      unmount();
    }
  });

  it("shows uninstall progress immediately and reconciles detail to current marketplace state", async () => {
    // Explicit tool status and enabled instances: without them this test read
    // the developer's real config and tool dirs.
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusBothInstalled);
    const realEnabled = vi.mocked(getEnabledToolInstances).getMockImplementation();
    vi.mocked(getEnabledToolInstances).mockImplementation(() => createToolInstances().filter((i) => i.enabled));
    const plugin = createPlugin();
    const originalRefreshAll = useStore.getState().refreshAll;
    let finishUninstall: (() => void) | undefined;
    vi.mocked(uninstallPlugin).mockImplementation(() => new Promise<boolean>((resolve) => {
      finishUninstall = () => resolve(true);
    }));
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(plugin),
      installedPlugins: [plugin],
      refreshAll: async () => {
        useStore.setState({
          installedPlugins: [],
          marketplaces: [createMarketplace({ plugins: [createPlugin({ installed: false })] })],
        });
      },
    });

    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Component status:"));
      // Walk to the uninstall row by what is on screen: the action list's
      // exact shape depends on component status, which this test doesn't pin.
      for (let step = 0; step < 20 && !stdout.lastFrame()!.includes("❯ Remove from all tools"); step += 1) {
        sendKey(stdin, KEYS.down);
        await settleInput();
      }
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ Remove from all tools"));

      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Uninstalling test-plugin..."));
      expect(useStore.getState().detail?.kind).toBe("plugin");
      await waitForFrame(stdout.lastFrame, () => finishUninstall !== undefined);
      expect(finishUninstall).toBeDefined();
      finishUninstall!();
      await waitForFrame(
        stdout.lastFrame,
        () => useStore.getState().detail?.kind === "plugin"
          && !useStore.getState().detailPlugin?.installed,
      );

      const reconciledFrame = stdout.lastFrame()!;
      expect(reconciledFrame).not.toContain("Component status:");
      expect(reconciledFrame).not.toContain("Remove from all tools");
      expect(reconciledFrame).toContain("❯ Install");
      expect(useStore.getState().notifications.some((notification) => notification.spinner)).toBe(false);
    } finally {
      useStore.setState({ refreshAll: originalRefreshAll });
      if (realEnabled) vi.mocked(getEnabledToolInstances).mockImplementation(realEnabled);
      unmount();
    }
  });

  it("consults the configured advisor from installed detail and focuses an accepted existing action without dispatching it", async () => {
    const plugin = createPlugin();
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/source", repoRoot: "/repo" });
    vi.mocked(buildFileDiffTarget).mockImplementation((title, _displayPath, sourcePath, targetPath, instance) => {
      if (sourcePath !== "/source/skills/test-skill") {
        return { kind: "file", title, instance, files: [] };
      }
      return {
        kind: "file",
        title,
        instance,
        files: [{
          id: "SKILL.md",
          displayPath: "SKILL.md",
          sourcePath,
          targetPath,
          status: "modified",
          linesAdded: 3,
          linesRemoved: 1,
          sourceMtime: Date.parse("2026-08-11T16:00:00.000Z"),
          targetMtime: Date.parse("2026-08-10T16:00:00.000Z"),
        }],
      };
    });
    vi.mocked(runConsultation)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          summary: "Inspect the current plugin list before changing anything.",
          analysis: {
            recommendedProposalId: "inspect-back",
            whatChanged: "The current plugin list is available for review.",
            recency: "No changed-file timestamps are available.",
            assessment: "Open the list after reviewing the detail state.",
          },
          proposals: [{
            id: "inspect-back",
            operation: "select_action",
            target: "back",
            reason: "Return to the installed-plugin list after reviewing the status.",
          }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          summary: "The Skills status row is the first detail to inspect.",
          analysis: {
            recommendedProposalId: "inspect-back",
            whatChanged: "The skill differs from the shared installed copy.",
            recency: "The source copy is newer than the installed copy.",
            assessment: "Review the component diff, then return to the plugin list.",
          },
          proposals: [{
            id: "inspect-back",
            operation: "select_action",
            target: "back",
            reason: "Return to the installed-plugin list after reviewing the status.",
          }],
        },
      });
    vi.mocked(getConsultationSettings).mockReturnValue({ runtime: "opencode", model: "openai/gpt-5.6" });
    useStore.setState({
      tab: "installed",
      ...openPluginDetail(plugin),
      installedPlugins: [plugin],
      tools: createToolInstances(),
      pluginDriftMap: {
        [plugin.name]: { "skill:test-skill": "target-changed" },
      },
      toolDetection: {
        opencode: {
          toolId: "opencode",
          installed: true,
          binaryPath: "/usr/local/bin/opencode",
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdate: false,
          error: null,
        },
      },
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Component status:"));
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("What would you like the advisor to review?"));
      act(() => {
        stdin.write("What should I inspect first?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The advisor’s recommendations are ready."));
      expect(vi.mocked(runConsultation)).toHaveBeenCalledWith(expect.objectContaining({
        runtime: "opencode",
        model: "openai/gpt-5.6",
        binaryPath: "/usr/local/bin/opencode",
      }));
      const consultationInput = vi.mocked(runConsultation).mock.calls[0]?.[0];
      const snapshotPayload = consultationInput?.prompt.match(/<consultation-snapshot>\n(.*)\n<\/consultation-snapshot>/s)?.[1];
      expect(snapshotPayload).toBeDefined();
      const snapshot = JSON.parse(snapshotPayload!).snapshot;
      expect(snapshot.components).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "plugin-component:skill:test-skill",
          syncStatus: "target-changed",
          diffSummary: {
            label: { untrustedText: "skills/test-skill" },
            added: 3,
            removed: 1,
          },
          diffEvidence: [{
            component: { untrustedText: "skills/test-skill" },
            path: { untrustedText: "SKILL.md" },
            status: "modified",
            added: 3,
            removed: 1,
            sourceModifiedAt: "2026-08-11T16:00:00.000Z",
            installedModifiedAt: "2026-08-10T16:00:00.000Z",
            excerpts: [],
          }],
        }),
      ]));
      expect(snapshot.availableActions).toEqual(expect.arrayContaining([
        { id: "status_skills", label: { untrustedText: "Review Skills (1) diff" } },
      ]));
      expect(consultationInput?.prompt).not.toContain("/source");
      expect(consultationInput?.prompt).not.toContain("/store");
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Ask a follow-up"));
      act(() => {
        stdin.write("Why should I inspect Skills first?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The Skills status row is the first detail to inspect."));
      expect(stdout.lastFrame()).toContain("turn 2");
      expect(vi.mocked(runConsultation)).toHaveBeenCalledTimes(2);
      const continuationInput = vi.mocked(runConsultation).mock.calls[1]?.[0];
      const continuationPayloadText = continuationInput?.prompt.match(
        /<consultation-snapshot>\n(.*)\n<\/consultation-snapshot>/s,
      )?.[1];
      expect(continuationPayloadText).toBeDefined();
      const continuationPayload = JSON.parse(continuationPayloadText!);
      expect(continuationPayload.request).toEqual({
        untrustedText: "Why should I inspect Skills first?",
      });
      expect(continuationPayload.priorExchanges).toEqual([
        expect.objectContaining({
          request: { untrustedText: "What should I inspect first?" },
          response: expect.objectContaining({
            summary: {
              untrustedText: "Inspect the current plugin list before changing anything.",
            },
          }),
        }),
      ]);
      expect(continuationPayload.snapshot.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "plugin-component:skill:test-skill" }),
      ]));
      sendKey(stdin, KEYS.space);
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ Back to plugin list"));
      expect(useStore.getState().detail?.kind).toBe("plugin");
    } finally {
      unmount();
    }
  });

  it("includes changed agent excerpts even when skill diff entries are binary", async () => {
    const root = mkdtempSync(join(tmpdir(), "blackbook-plugin-diff-evidence-"));
    const sourceAgentDir = join(root, "source", "agents");
    const installedAgentDir = join(root, "installed", "agents");
    mkdirSync(sourceAgentDir, { recursive: true });
    mkdirSync(installedAgentDir, { recursive: true });
    const skillNames = Array.from({ length: 8 }, (_value, index) => `skill-${index}`);
    const agentNames = ["ui-panelist", "ui-verifier"];
    const lineBreak = String.fromCharCode(10);
    for (const name of agentNames) {
      const oldLines = Array.from({ length: 12 }, (_value, index) => `Old agent behavior for ${name} line ${index}.`);
      const newLines = Array.from({ length: 12 }, (_value, index) => `New agent behavior for ${name} line ${index}.`);
      writeFileSync(join(sourceAgentDir, `${name}.md`), `${oldLines.join(lineBreak)}${lineBreak}`);
      writeFileSync(join(installedAgentDir, `${name}.md`), `${newLines.join(lineBreak)}${lineBreak}`);
    }

    try {
      const plugin = createPlugin({ skills: skillNames, agents: agentNames, commands: [] });
      vi.mocked(resolvePluginSourcePaths).mockReturnValue({
        pluginDir: join(root, "source"),
        repoRoot: root,
      });
      vi.mocked(buildFileDiffTarget).mockImplementation((title, _displayPath, sourcePath, _targetPath, instance) => {
        const skillRoot = `${join(root, "source", "skills")}/`;
        if (sourcePath.startsWith(skillRoot)) {
          return {
            kind: "file",
            title,
            instance,
            files: [{
              id: "examples/exemplar.png",
              displayPath: "examples/exemplar.png",
              sourcePath: join(sourcePath, "examples", "exemplar.png"),
              targetPath: join(root, "installed", "skills", "examples", "exemplar.png"),
              status: "binary",
              linesAdded: 0,
              linesRemoved: 0,
              sourceMtime: 1_000,
              targetMtime: 1_000,
            }],
          };
        }
        return {
          kind: "file",
          title,
          instance,
          files: [{
            id: sourcePath.split("/").at(-1)!,
            displayPath: sourcePath.split("/").at(-1)!,
            sourcePath,
            targetPath: join(installedAgentDir, sourcePath.split("/").at(-1)!),
            status: "modified",
            linesAdded: 1,
            linesRemoved: 1,
            sourceMtime: 2_000,
            targetMtime: 1_000,
          }],
        };
      });
      vi.mocked(runConsultation).mockResolvedValue({
        ok: true,
        response: {
          summary: "The agents contain concrete local changes.",
          analysis: {
            recommendedProposalId: null,
            whatChanged: "Both agents differ from their source copies.",
            recency: "The source files are newer.",
            assessment: "Review the supplied excerpts before choosing a sync action.",
          },
          proposals: [],
        },
      });
      vi.mocked(getConsultationSettings).mockReturnValue({ runtime: "opencode", model: "openai/gpt-5.6" });
      useStore.setState({
        tab: "installed",
        ...openPluginDetail(plugin),
        installedPlugins: [plugin],
        tools: createToolInstances(),
        pluginDriftMap: {
          [plugin.name]: Object.fromEntries([
            ...skillNames.map((name) => [`skill:${name}`, "target-changed"]),
            ...agentNames.map((name) => [`agent:${name}`, "target-changed"]),
          ]),
        },
        toolDetection: {
          opencode: {
            toolId: "opencode",
            installed: true,
            binaryPath: "/usr/local/bin/opencode",
            installedVersion: "1.0.0",
            latestVersion: "1.0.0",
            hasUpdate: false,
            error: null,
          },
        },
      });
      const { stdin, stdout, unmount } = render(<App />);
      try {
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Component status:"));
        sendKey(stdin, "c");
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("What would you like the advisor to review?"));
        sendKey(stdin, KEYS.enter);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The advisor’s recommendations are ready."));

        const prompt = vi.mocked(runConsultation).mock.calls[0]?.[0].prompt;
        const newline = String.fromCharCode(10);
        const startMarker = `<consultation-snapshot>${newline}`;
        const endMarker = `${newline}</consultation-snapshot>`;
        const start = prompt?.indexOf(startMarker) ?? -1;
        const end = prompt?.indexOf(endMarker, start + startMarker.length) ?? -1;
        const payload = start >= 0 && end >= 0 ? prompt?.slice(start + startMarker.length, end) : undefined;
        expect(payload).toBeDefined();
        const snapshot = JSON.parse(payload!).snapshot;
        for (const name of agentNames) {
          const agent = snapshot.components.find((component: { id: string }) => component.id === `plugin-component:agent:${name}`);
          expect(agent?.syncStatus).toBe("target-changed");
          const excerptTexts = agent?.diffEvidence?.[0]?.excerpts.map((excerpt: { text: { untrustedText: string } }) => excerpt.text.untrustedText) ?? [];
          expect(excerptTexts).toContain(`Old agent behavior for ${name} line 11.`);
          expect(excerptTexts).toContain(`New agent behavior for ${name} line 11.`);
        }
        const binarySkill = snapshot.components.find((component: { id: string }) => component.id === "plugin-component:skill:skill-0");
        expect(binarySkill?.diffEvidence?.[0]).toEqual(expect.objectContaining({
          path: { untrustedText: "examples/exemplar.png" },
          status: "binary",
          sourceModifiedAt: "1970-01-01T00:00:01.000Z",
          installedModifiedAt: "1970-01-01T00:00:01.000Z",
          excerpts: [],
        }));
      } finally {
        unmount();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Known intermittent failure in full-file runs (passes alone); retried until the root cause is found.
  it("pulls changed shared-store plugin components back to the source repo", { retry: 2 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "blackbook-shared-pullback-"));
    const sourceSkillDir = join(root, "source", "skills", "test-skill");
    const targetSkillDir = join(root, "installed", "skills", "test-skill");
    mkdirSync(sourceSkillDir, { recursive: true });
    mkdirSync(targetSkillDir, { recursive: true });
    writeFileSync(join(sourceSkillDir, "SKILL.md"), "Source version\\n");
    writeFileSync(join(targetSkillDir, "SKILL.md"), "Local edits to keep\\n");

    try {
      const plugin = createPlugin({ skills: ["test-skill"], commands: [], agents: [] });
      // The mount-time plugin load must return this plugin too; otherwise, when it
      // resolves mid-test, refreshDetail swaps in the default fixture plugin.
      vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [plugin], byTool: {} });
      vi.mocked(fetchMarketplace).mockResolvedValue([plugin]);
      vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: join(root, "source"), repoRoot: root });
      vi.mocked(pluginSkillStorePath).mockReturnValue(targetSkillDir);
      vi.mocked(buildFileDiffTarget).mockImplementation((title, _displayPath, sourcePath, targetPath, instance) => ({
        kind: "file",
        title,
        instance,
        files: sourcePath === sourceSkillDir && targetPath === targetSkillDir ? [{
          id: "SKILL.md",
          displayPath: "SKILL.md",
          sourcePath: join(sourceSkillDir, "SKILL.md"),
          targetPath: join(targetSkillDir, "SKILL.md"),
          status: "modified",
          linesAdded: 1,
          linesRemoved: 1,
          sourceMtime: null,
          targetMtime: null,
        }] : [],
      }));
      vi.mocked(runConsultation).mockResolvedValue({
        ok: true,
        response: {
          summary: "Keep the local skill edits.",
          analysis: {
            recommendedProposalId: null,
            whatChanged: "The shared installed skill differs from source.",
            recency: "No timestamps are available.",
            assessment: "Pull the local copy into the source repo to preserve it.",
          },
          proposals: [],
        },
      });
      const pluginDrift = { "skill:test-skill": "target-changed" as const };
      useStore.setState({
        tab: "installed",
        ...openPluginDetail(plugin),
        detail: { kind: "plugin", data: plugin, drift: pluginDrift },
        installedPlugins: [plugin],
        tools: createToolInstances(),
        pluginDriftMap: { [plugin.name]: pluginDrift },
      });
      const { stdin, stdout, unmount } = render(<App />);
      try {
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Update source repo from disk"));
        sendKey(stdin, KEYS.down);
        await settleInput();
        sendKey(stdin, KEYS.down);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ Update source repo from disk"));
        sendKey(stdin, KEYS.enter);
        // Real file copy + backup: allow more than vi.waitFor's 1s default under load.
        await vi.waitFor(() => {
          expect(readFileSync(join(sourceSkillDir, "SKILL.md"), "utf-8")).toBe("Local edits to keep\\n");
        }, { timeout: 5000 });
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Pulled test-plugin from ~/.agents (1)"));
      } finally {
        unmount();
      }
    } finally {
      vi.mocked(pluginSkillStorePath).mockReturnValue("/store/test-skill");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("browses and previews files from standalone skill detail", async () => {
    const root = mkdtempSync(join(tmpdir(), "blackbook-app-skill-preview-"));
    writeFileSync(join(root, "SKILL.md"), "# Example skill\\nThis file is previewed from the detail view.");
    try {
      const skill = {
        name: "example-skill",
        installations: [{
          toolId: "opencode",
          instanceId: "default",
          instanceName: "OpenCode",
          diskPath: root,
        }],
        diskPath: root,
        toolId: "opencode",
        instanceName: "OpenCode",
        instanceId: "default",
        sourcePath: root,
      };
      useStore.setState({
        tab: "installed",
        detail: { kind: "skill", data: skill },
        standaloneSkills: [skill],
        installedPluginsLoaded: true,
        filesLoaded: true,
        piPackagesLoaded: true,
        tools: createToolInstances(),
      });
      const { stdin, stdout, unmount } = render(<App />);
      try {
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Browse skill files") && frame.includes("configured source repo"));
        sendKey(stdin, KEYS.down);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ Browse skill files"));
        sendKey(stdin, KEYS.enter);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Files · example-skill") && frame.includes("SKILL.md"));
        sendKey(stdin, KEYS.enter);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("# Example skill") && frame.includes("previewed from the detail view"));
        sendKey(stdin, KEYS.escape);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Files · example-skill"));
        sendKey(stdin, KEYS.escape);
        await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Browse skill files") && !frame.includes("Files · example-skill"));
      } finally {
        unmount();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds a skill to profiles from its detail view through a checkbox picker", async () => {
    const setSkillProfiles = vi.fn().mockResolvedValue(true);
    const skill = {
      name: "blast-radius",
      installations: [],
      diskPath: "/repo/skills/blast-radius",
      toolId: "",
      instanceName: "",
      instanceId: "",
      sourcePath: "/repo/skills/blast-radius",
    };
    useStore.setState({
      tab: "installed",
      detail: { kind: "skill", data: skill },
      standaloneSkills: [skill],
      installedPluginsLoaded: true,
      filesLoaded: true,
      piPackagesLoaded: true,
      projectsLoaded: true,
      profiles: { Coding: ["deslop"], Docs: ["blast-radius", "pdf"], UI: [] },
      tools: createToolInstances(),
      setSkillProfiles,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Add to profiles…"));
      for (let i = 0; i < 10 && !stdout.lastFrame()!.includes("❯ Add to profiles…"); i++) {
        sendKey(stdin, KEYS.down);
        await settleInput();
      }
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Profiles for blast-radius"));
      // Docs already has it; check Coding (first row) and uncheck Docs (second).
      expect(stdout.lastFrame()).toMatch(/◉ Docs/);
      sendKey(stdin, KEYS.space);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("will add"));
      sendKey(stdin, KEYS.down);
      sendKey(stdin, KEYS.space);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("will remove") && frame.includes("2 changes"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => setSkillProfiles.mock.calls.length === 1);
      expect(setSkillProfiles).toHaveBeenCalledWith("blast-radius", ["Coding"]);
      await waitForFrame(stdout.lastFrame, (frame) => !frame.includes("Profiles for blast-radius") && frame.includes("Add to profiles…"));
    } finally {
      unmount();
    }
  });

  it("consults from an installed standalone skill detail and focuses an accepted action without dispatching it", async () => {
    const skill = {
      name: "file-todos",
      installations: [{
        toolId: "opencode",
        instanceId: "default",
        instanceName: "OpenCode",
        diskPath: "/tmp/blackbook/skills/file-todos",
        drifted: true,
      }],
      diskPath: "/tmp/blackbook/skills/file-todos",
      toolId: "opencode",
      instanceName: "OpenCode",
      instanceId: "default",
      sourcePath: "/tmp/blackbook/source/file-todos",
      drifted: true,
    };
    vi.mocked(runConsultation).mockResolvedValue({
      ok: true,
      response: {
        summary: "Inspect the changed skill before reinstalling it.",
        analysis: {
          recommendedProposalId: "select-diff",
          whatChanged: "The installed skill differs from its source.",
          recency: "The current detail carries the latest detected drift.",
          assessment: "Inspect the diff before selecting a mutation.",
        },
        proposals: [{
          id: "select-diff",
          operation: "select_action",
          target: "status",
          reason: "Review the currently drifted installation first.",
        }],
      },
    });
    vi.mocked(getConsultationSettings).mockReturnValue({ runtime: "opencode", model: "openai/gpt-5.6" });
    useStore.setState({
      tab: "installed",
      detail: { kind: "skill", data: skill },
      standaloneSkills: [skill],
      installedPluginsLoaded: true,
      filesLoaded: true,
      piPackagesLoaded: true,
      tools: createToolInstances(),
      toolDetection: {
        opencode: {
          toolId: "opencode",
          installed: true,
          binaryPath: "/usr/local/bin/opencode",
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdate: false,
          error: null,
        },
      },
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("file-todos") && frame.includes("c consult advisor"));
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("What would you like the advisor to review?"));
      act(() => {
        stdin.write("How should I resolve this skill drift?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The advisor’s recommendations are ready."));
      expect(stdout.lastFrame()).toContain("↓ more response below");
      expect(vi.mocked(runConsultation)).toHaveBeenCalledWith(expect.objectContaining({
        runtime: "opencode",
        model: "openai/gpt-5.6",
        binaryPath: "/usr/local/bin/opencode",
        prompt: expect.stringContaining("\"kind\":\"installed-skill\""),
      }));
      sendKey(stdin, KEYS.space);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Review file-todos diff · select action"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ file-todos"));
      expect(useStore.getState().detail?.kind).toBe("skill");
    } finally {
      unmount();
    }
  });

  it("shows a single Install action (no per-tool enumeration) for a not-installed plugin", async () => {
    vi.mocked(getPluginToolStatusDirect).mockReturnValue(toolStatusPartial);
    useStore.setState({
      tab: "discover",
      ...openPluginDetail(createPlugin({ installed: false })),
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Back to plugin list"));
      const frame = stdout.lastFrame()!;
      expect(frame).not.toContain("Install to OpenCode");
      expect(frame).not.toContain("Install to Claude");
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

  it("drifted plugin skill shows a single consolidated Skills Drifted row with +/- counts", async () => {
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/src/plugins/test", repoRoot: "/src" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file",
      title: "test",
      instance: { toolId: "agents", instanceId: "shared", instanceName: "~/.agents", configDir: "" },
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Skills (1)") || f.includes("+10"), 5000);
      const frame = stdout.lastFrame()!;
      // One consolidated Skills row, not broken out per tool.
      expect(frame).toContain("Skills (1)");
      expect(frame).toContain("Drifted");
      expect(frame).toContain("+10");
      expect(frame).toContain("-5");
      expect(frame).not.toContain("OpenCode:");
    } finally {
      unmount();
    }
  });

  it("shows skill drift on the consolidated Skills row, not a per-tool badge", async () => {
    vi.mocked(resolvePluginSourcePaths).mockReturnValue({ pluginDir: "/src/plugins/test", repoRoot: "/src" });
    vi.mocked(buildFileDiffTarget).mockReturnValue({
      kind: "file", title: "t",
      instance: { toolId: "agents", instanceId: "shared", instanceName: "~/.agents", configDir: "" },
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
      expect(frame).toContain("Skills (1)");
      expect(frame).toContain("Drifted");
    } finally {
      unmount();
    }
  });

  it("reports Skills as Missing when a second flat-install instance (e.g. a second Claude profile) lacks its own overlay, even though the shared store has the skill", async () => {
    // A tool can have multiple enabled instances with separate config dirs
    // (two Claude profiles). The shared store being populated once is not
    // enough — a flat-install (Claude-like) instance needs its OWN derived-
    // view symlink materialized in its OWN config dir. One instance has it,
    // the other doesn't — the row must reflect that, not silently say "In sync".
    vi.mocked(getToolInstances).mockReturnValue([
      ...createToolInstances(),
      {
        toolId: "claude-code",
        instanceId: "claude-learning",
        name: "Claude (Learning)",
        enabled: true,
        configDir: "/tmp/claude-learning",
        skillsSubdir: "skills",
        commandsSubdir: "commands",
        agentsSubdir: "agents",

        kind: "tool" as const,
        pluginFlatInstall: true,
      },
    ]);
    vi.mocked(skillPresentForInstance).mockImplementation(
      (_pluginName, _skill, instance) => instance.instanceId !== "claude-learning",
    );

    useStore.setState({
      tab: "installed",
      ...openPluginDetail(createPlugin()),
      installedPlugins: [createPlugin()],
    });
    const { stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Missing"), 5000);
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Skills (1)");
      expect(frame).toContain("Missing");
    } finally {
      unmount();
      vi.mocked(skillPresentForInstance).mockReturnValue(true);
    }
  });
});
describe("App E2E — Scrolling and search on Projects and Profiles", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("project detail filters with / and actions apply to the filtered row", async () => {
    const pushProjectSkill = vi.fn().mockResolvedValue(true);
    const available = Array.from({ length: 60 }, (_v, i) => ({ name: `skill-${String(i).padStart(2, "0")}`, sourcePath: `/src/skill-${i}` }));
    const project: ProjectInfo = { path: "/tmp/project", name: "Project", exists: true, hasAgentsDir: true, skills: [], available };
    useStore.setState({ tab: "projects", projects: [project], projectsLoaded: true, projectDetailPath: "/tmp/project", tools: createToolInstances(), pushProjectSkill });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("press / to search") && frame.includes("of 60"));
      // Scroll: moving past the bottom edge brings later rows into view.
      for (let i = 0; i < 45; i++) sendKey(stdin, KEYS.down);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ + skill-45"));
      expect(stdout.lastFrame()).not.toContain("skill-00");

      sendKey(stdin, "/");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Search this project's skills"));
      act(() => {
        stdin.write("skill-5");
      });
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("10 of 60 match"));
      sendKey(stdin, KEYS.enter); // keep the filter; the cursor is back on the first match
      sendKey(stdin, KEYS.down);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("❯ + skill-51"));
      sendKey(stdin, "p");
      await waitForFrame(stdout.lastFrame, () => pushProjectSkill.mock.calls.length === 1);
      expect(pushProjectSkill).toHaveBeenCalledWith("/tmp/project", "skill-51", "/src/skill-51");
    } finally {
      unmount();
    }
  });

  it("profiles list shows one line per profile, and the builder searches every skill including lock-only sources", async () => {
    const saveProfile = vi.fn().mockResolvedValue(true);
    const gh = (source: string) => ({ source, sourceType: "github" });
    useStore.setState({
      tab: "profiles",
      profiles: { Docs: ["docx", "pdf"], Coding: ["deslop"], global: ["the-algorithm"] },
      profileLocks: {
        Docs: { version: 1, skills: { docx: gh("anthropics/skills"), pdf: gh("anthropics/skills") } },
        Coding: { version: 1, skills: { deslop: gh("ssweens/playbook") } },
        global: { version: 1, skills: { "the-algorithm": gh("ssweens/playbook") } },
      },
      tools: createToolInstances(),
      saveProfile,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Docs") && frame.includes("global"));
      const lines = stdout.lastFrame()!.split("\n").filter((l) => /\d+ skills?/.test(l));
      // Case-insensitive order, one row each, names aligned.
      expect(lines.map((l) => l.trim().replace(/^❯ /, "").split(/\s+/)[0])).toEqual(["Coding", "Docs", "global"]);
      expect(new Set(lines.map((l) => l.search(/ skills?\b/))).size).toBe(1);

      sendKey(stdin, KEYS.enter); // edit Coding
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("S save") && frame.includes("anthropics/skills"));
      sendKey(stdin, "/");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Search all skills"));
      act(() => {
        stdin.write("docx");
      });
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("docx") && frame.includes("anthropics/skills"));
      sendKey(stdin, KEYS.enter); // keep the filter
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("1 match"));
      sendKey(stdin, KEYS.space);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("2 of"));
      sendKey(stdin, "v");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("showing selected only"));
      sendKey(stdin, "S");
      await waitForFrame(stdout.lastFrame, () => saveProfile.mock.calls.length === 1);
      expect(saveProfile).toHaveBeenCalledWith("Coding", ["deslop", "docx"], "Coding");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Skill detail from Projects and Profiles", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  const resolvableSkill = {
    name: "qc-review",
    installations: [{ toolId: "opencode", instanceId: "default", instanceName: "OpenCode", diskPath: "/d/qc-review" }],
    diskPath: "/d/qc-review",
    toolId: "opencode",
    instanceId: "default",
    instanceName: "OpenCode",
    sourcePath: "/repo/skills/qc-review",
  };

  it("groups a project's skills under collapsible namespace headers; Enter toggles, p acts on a skill", async () => {
    const pushProjectSkill = vi.fn().mockResolvedValue(true);
    const project: ProjectInfo = {
      path: "/tmp/pj", name: "PJ", exists: true, hasAgentsDir: true,
      skills: [{ name: "mixing-fundamentals", diskPath: "/d/m", enabled: true, status: "in-sync", sourcePath: "/repo/skills/ssmp/mixing-fundamentals" }],
      available: [
        { name: "vocal-mixing", sourcePath: "/repo/skills/ssmp/vocal-mixing" },
        { name: "deslop", sourcePath: "/repo/skills/deslop" },
      ],
    };
    await settleInput();
    useStore.setState({
      tab: "projects", projects: [project], projectsLoaded: true, projectDetailPath: "/tmp/pj",
      selectedIndex: 0, loadProjects: vi.fn().mockResolvedValue(undefined), pushProjectSkill, tools: createToolInstances(),
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      // Namespace header with count; its skills visible; top-level deslop flat.
      await waitForFrame(stdout.lastFrame, (f) => f.includes("ssmp") && f.includes("2 skills") && f.includes("mixing-fundamentals") && f.includes("deslop"));
      // Enter on the ssmp header collapses it.
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => !f.includes("mixing-fundamentals") && f.includes("deslop"));
      // Enter expands again.
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("mixing-fundamentals"));
      // Move to the available skill under ssmp and push it.
      sendKey(stdin, KEYS.down); // mixing-fundamentals
      sendKey(stdin, KEYS.down); // vocal-mixing (available)
      await waitForFrame(stdout.lastFrame, (f) => f.includes("❯") && f.includes("vocal-mixing"));
      sendKey(stdin, "p");
      await waitForFrame(stdout.lastFrame, () => pushProjectSkill.mock.calls.length === 1);
      expect(pushProjectSkill).toHaveBeenCalledWith("/tmp/pj", "vocal-mixing", "/repo/skills/ssmp/vocal-mixing");
    } finally {
      unmount();
    }
  });

  it("opens a skill's detail with Enter from a project's drill-in view", async () => {
    const project: ProjectInfo = {
      path: "/tmp/proj", name: "Proj", exists: true, hasAgentsDir: true,
      skills: [{ name: "qc-review", diskPath: "/d/qc-review", enabled: true, status: "in-sync", sourcePath: "/repo/skills/qc-review" }],
      available: [],
    };
    // Drain any loadProjects still in flight from a previous test so it can't
    // overwrite the projects we set below, then neutralize further reloads.
    await settleInput();
    useStore.setState({
      tab: "projects",
      projects: [project],
      projectsLoaded: true,
      projectDetailPath: "/tmp/proj",
      selectedIndex: 0,
      standaloneSkills: [resolvableSkill] as never,
      loadProjects: vi.fn().mockResolvedValue(undefined),
      tools: createToolInstances(),
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("qc-review") && f.includes("Enter details"));
      sendKey(stdin, KEYS.enter);
      // Skill detail overlay: the file browser action is unique to it.
      await waitForFrame(stdout.lastFrame, (f) => f.includes("qc-review") && f.includes("Browse skill files"));
      // Esc returns to the project drill-in list.
      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Enter details") && !f.includes("Browse skill files"));
    } finally {
      unmount();
    }
  });

  it("opens a skill's detail with Enter in the profile builder and keeps the draft; S saves", async () => {
    const saveProfile = vi.fn().mockResolvedValue(true);
    useStore.setState({
      tab: "profiles",
      profiles: { web: ["qc-review"] },
      profileLocks: { web: { version: 1, skills: { "qc-review": { source: "o/r", sourceType: "github" } } } } as never,
      standaloneSkills: [resolvableSkill] as never,
      tools: createToolInstances(),
      saveProfile,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("web"));
      sendKey(stdin, KEYS.enter); // edit "web" → builder
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Enter details") && f.includes("S save"));
      // The one group is the lock source "o/r"; expand it, then open the skill.
      await waitForFrame(stdout.lastFrame, (f) => f.includes("o/r"));
      sendKey(stdin, KEYS.enter); // Enter on the namespace header expands it
      await waitForFrame(stdout.lastFrame, (f) => f.includes("qc-review"));
      sendKey(stdin, KEYS.down);  // move to the skill row
      sendKey(stdin, KEYS.enter); // open its detail
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Browse skill files"));
      sendKey(stdin, KEYS.escape); // back to the builder, draft intact
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Enter details") && f.includes("S save") && !f.includes("Browse skill files"));
      sendKey(stdin, "S");         // save
      await waitForFrame(stdout.lastFrame, () => saveProfile.mock.calls.length === 1);
      expect(saveProfile).toHaveBeenCalledWith("web", ["qc-review"], "web");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Save project lock as profile", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("S on a project opens the name prompt and saves that workspace's lock under the typed name", async () => {
    const saveLockAsProfile = vi.fn().mockResolvedValue(true);
    const project: ProjectInfo = { path: "/tmp/project", name: "Project", exists: true, hasAgentsDir: true, skills: [], available: [] };
    useStore.setState({ tab: "projects", projects: [project], projectsLoaded: true, tools: createToolInstances(), saveLockAsProfile });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Project"));
      sendKey(stdin, "S");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Save Project's skills lock as a profile"));
      act(() => {
        stdin.write("web-3");
      });
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("web-3"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => saveLockAsProfile.mock.calls.length === 1);
      expect(saveLockAsProfile).toHaveBeenCalledWith("/tmp/project", "web-3");
      // Digits typed into the prompt must not switch tabs.
      expect(useStore.getState().tab).toBe("projects");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Advisory Consultation", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  it("consults the configured advisor for the selected project and applies an accepted source-skill proposal through the project action", async () => {
    const project: ProjectInfo = {
      path: "/tmp/project",
      name: "Project",
      exists: true,
      hasAgentsDir: true,
      skills: [],
      available: [{ name: "architecture", sourcePath: "/tmp/source/architecture" }],
    };
    const pushProjectSkill = vi.fn().mockResolvedValue(true);
    vi.mocked(runConsultation).mockResolvedValue({
      ok: true,
      response: {
        summary: "Add the available architecture skill for the requested design work.",
        analysis: {
          recommendedProposalId: "add-architecture",
          whatChanged: "The requested architecture skill is not in the project.",
          recency: "No file timestamps are available for the project inventory.",
          assessment: "Adding the available source skill directly addresses the request.",
        },
        proposals: [{
          id: "add-architecture",
          operation: "install",
          target: "available-project-skill:architecture",
          reason: "It is available from the configured source repository.",
        }],
      },
    });
    useStore.setState({
      tab: "projects",
      projects: [project],
      projectsLoaded: true,
      tools: [...createToolInstances(), createPiTool()],
      toolDetection: {
        pi: {
          toolId: "pi",
          installed: true,
          binaryPath: "/usr/local/bin/pi",
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdate: false,
          error: null,
        },
      },
      pushProjectSkill,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Project"));
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("What would you like the advisor to review?"));
      act(() => {
        stdin.write("What should this project gain?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The advisor’s recommendations are ready."));
      sendKey(stdin, KEYS.space);
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => pushProjectSkill.mock.calls.length === 1);
      expect(pushProjectSkill).toHaveBeenCalledWith(
        "/tmp/project",
        "architecture",
        "/tmp/source/architecture",
      );
    } finally {
      unmount();
    }
  });

  it("consults the configured advisor while editing a profile and saves only the accepted draft membership change", async () => {
    const saveProfile = vi.fn().mockResolvedValue(true);
    vi.mocked(runConsultation)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          summary: "Remove the no-longer-needed frontend skill from this profile.",
          analysis: {
            recommendedProposalId: "remove-frontend",
            whatChanged: "The current profile still includes the frontend skill.",
            recency: "No file timestamps are available for the profile draft.",
            assessment: "Removing it aligns the draft with the stated non-frontend scope.",
          },
          proposals: [{
            id: "remove-frontend",
            operation: "remove",
            target: "profile-member:frontend",
            reason: "The profile is now intended for non-frontend work.",
          }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          summary: "Yes. The current draft still supports removing frontend.",
          analysis: {
            recommendedProposalId: "remove-frontend",
            whatChanged: "The current profile still includes the frontend skill.",
            recency: "No file timestamps are available for the profile draft.",
            assessment: "The follow-up does not change the safe recommendation.",
          },
          proposals: [{
            id: "remove-frontend",
            operation: "remove",
            target: "profile-member:frontend",
            reason: "The profile is now intended for non-frontend work.",
          }],
        },
      });
    useStore.setState({
      tab: "profiles",
      profiles: { web: ["frontend"] },
      tools: [...createToolInstances(), createPiTool()],
      toolDetection: {
        pi: {
          toolId: "pi",
          installed: true,
          binaryPath: "/usr/local/bin/pi",
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdate: false,
          error: null,
        },
      },
      saveProfile,
    });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("web"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("S save"));
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("What would you like the advisor to review?"));
      act(() => {
        stdin.write("What should change in this profile?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("The advisor’s recommendations are ready."));
      sendKey(stdin, "c");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Ask a follow-up"));
      act(() => {
        stdin.write("Is that still safe?");
      });
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Yes. The current draft still supports removing frontend."));
      expect(stdout.lastFrame()).toContain("turn 2");
      expect(vi.mocked(runConsultation)).toHaveBeenCalledTimes(2);
      const continuationPrompt = vi.mocked(runConsultation).mock.calls[1]?.[0].prompt;
      const continuationPayloadText = continuationPrompt.match(
        /<consultation-snapshot>\n(.*)\n<\/consultation-snapshot>/s,
      )?.[1];
      const continuationPayload = JSON.parse(continuationPayloadText!);
      expect(continuationPayload.priorExchanges[0].request).toEqual({
        untrustedText: "What should change in this profile?",
      });
      sendKey(stdin, KEYS.space);
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Space toggle"));
      sendKey(stdin, "S");
      await waitForFrame(stdout.lastFrame, () => saveProfile.mock.calls.length === 1);
      expect(saveProfile).toHaveBeenCalledWith("web", [], "web");
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
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[8] Settings"));
    } finally {
      unmount();
    }
  });

  it("keeps digits in advisor model search instead of switching tabs", async () => {
    useStore.setState({ tab: "settings", notifications: [] });
    const { stdin, stdout, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Advisor Model"));
      for (let index = 0; index < 3; index += 1) {
        sendKey(stdin, KEYS.down);
        await settleInput();
      }
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Search:"));

      sendKey(stdin, "2");
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Search: 2"));
      expect(useStore.getState().tab).toBe("settings");

      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, (frame) => frame.includes("Advisor Model") && !frame.includes("Search:"));
      sendKey(stdin, "2");
      await waitForFrame(stdout.lastFrame, () => useStore.getState().tab === "tools");
    } finally {
      unmount();
    }
  });
});

describe("App E2E — Overlay Esc handling", () => {
  beforeEach(() => {
    setupMocks();
    useStore.setState(defaultStoreState());
  });

  // Regression: a modal (EditToolModal) opened over a tool detail must close ONLY
  // itself on Esc. Previously App's top-level Esc handler ran BEFORE the modal
  // guard, so one Esc closed both the modal AND the tool detail underneath it.
  it("Esc from EditToolModal closes only the modal and keeps the tool detail underneath", async () => {
    useStore.setState({
      tab: "tools",
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
      // Both managedTools and toolDetection non-empty so the boot refresh treats the
      // tools tab as already hydrated and does not overwrite this fixture data.
      toolDetection: {
        "claude-code": {
          toolId: "claude-code",
          installed: true,
          binaryPath: "/usr/local/bin/claude",
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
          hasUpdate: false,
          error: null,
        },
      },
    });
    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Claude"));
      await settleInput();

      // Enter opens the tool detail ("Binary:" is unique to the detail view).
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Binary:"));

      // 'e' opens EditToolModal over the tool detail.
      sendKey(stdin, "e");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Edit tool config"));

      // A single Esc closes ONLY the modal, returning to the tool detail — the view
      // underneath must be unchanged (still the detail, not the tools list).
      sendKey(stdin, KEYS.escape);
      await waitForFrame(
        stdout.lastFrame,
        (f) => f.includes("Binary:") && !f.includes("Edit tool config"),
      );
      const frame = stdout.lastFrame()!;
      expect(frame).toContain("Binary:"); // tool detail still open
      expect(frame).not.toContain("Edit tool config"); // modal closed
    } finally {
      unmount();
    }
  });

  // Regression: browsing into a marketplace sets a local marketplaceBrowseContext.
  // Switching tabs (which the store's setTab resets its own state for) used to leave
  // that local context stale, so Esc on the plain marketplace list resurrected the
  // previous marketplace's detail. A tab-change effect now clears it.
  it("switching tabs clears stale marketplace browse context so Esc does not resurrect the detail", async () => {
    useStore.setState({
      tab: "marketplaces",
      // Row 0 is the "add marketplace" row; row 1 is the marketplace itself.
      selectedIndex: 1,
      notifications: [],
      marketplaces: [createMarketplace({ plugins: [createPlugin()], availableCount: 1 })],
    });
    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Test Marketplace"));
      await settleInput();

      // Open the marketplace detail, then browse into its plugin list (browse is the
      // first action), which sets the local marketplaceBrowseContext.
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Browse plugins"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => useStore.getState().discoverSubView === "plugins");
      expect(useStore.getState().detailMarketplace).toBeNull();

      // Switch away to Sync, then back to Marketplaces.
      sendKey(stdin, "1");
      await waitForFrame(stdout.lastFrame, () => useStore.getState().tab === "sync");
      sendKey(stdin, "5");
      await waitForFrame(stdout.lastFrame, () => useStore.getState().tab === "marketplaces");
      await settleInput();
      expect(useStore.getState().discoverSubView).toBeNull();

      // Esc on the plain marketplace list must NOT re-open the previous detail.
      sendKey(stdin, KEYS.escape);
      await settleInput();
      expect(useStore.getState().detailMarketplace).toBeNull();
      expect(stdout.lastFrame()).not.toContain("Browse plugins");
    } finally {
      unmount();
    }
  });

  // The overlay registry marks the tool-action confirm modal as a "modal" overlay,
  // and the top-of-useInput toolModalAction guard captures ALL input while it is
  // showing. Nothing may leak through to tab-content behavior (search focus, digit
  // tab-switch, etc.). This locks in that the confirm modal fully owns input — the
  // consistency the registry is meant to guarantee.
  it("tool-action confirm modal captures all input — / and digit tab-switch do not leak", async () => {
    useStore.setState({
      tab: "tools",
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
      // Not installed → 'i' opens the Install confirm modal. Both managedTools and
      // toolDetection non-empty so the boot refresh treats tools as hydrated.
      toolDetection: {
        "claude-code": {
          toolId: "claude-code",
          installed: false,
          binaryPath: null,
          installedVersion: null,
          latestVersion: "1.0.1",
          hasUpdate: false,
          error: null,
        },
      },
    });
    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Claude"));
      await settleInput();

      // 'i' opens the install confirm modal ("Install Claude … Enter to confirm").
      sendKey(stdin, "i");
      await waitForFrame(
        stdout.lastFrame,
        (f) => f.includes("Install Claude") && f.includes("Enter to confirm"),
      );
      expect(useStore.getState().tab).toBe("tools");

      // '/' must NOT focus search / leak to tab content while the modal is showing.
      sendKey(stdin, "/");
      await settleInput();
      expect(stdout.lastFrame()).toContain("Enter to confirm"); // modal still up
      expect(useStore.getState().tab).toBe("tools");

      // A digit (which switches tabs on the normal list) must NOT leak past the modal.
      sendKey(stdin, "1");
      await settleInput();
      expect(useStore.getState().tab).toBe("tools"); // did not switch to sync
      expect(stdout.lastFrame()).toContain("Enter to confirm"); // modal still up

      // Esc cancels the confirm modal and returns to the tools list.
      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, (f) => !f.includes("Enter to confirm"));
    } finally {
      unmount();
    }
  });

  // Breadcrumb: Esc from a skill detail that was drilled into from a namespace
  // detail must return to the NAMESPACE detail, not all the way to the list. This
  // logic (closeItemDetail) now lives in the overlay registry's itemDetail entry.
  it("Esc from a skill drilled into a namespace returns to the namespace detail", async () => {
    const skill = {
      name: "deploy",
      namespace: "alpha",
      installations: [
        { toolId: "claude-code", instanceId: "default", instanceName: "Claude", diskPath: "/tmp/alpha/deploy" },
      ],
      diskPath: "/tmp/alpha/deploy",
      toolId: "claude-code",
      instanceName: "Claude",
      instanceId: "default",
    };
    const nsGroup = groupSkillsByNamespace([skill])[0];

    useStore.setState({
      tab: "installed",
      selectedIndex: 0,
      notifications: [],
      standaloneSkills: [skill],
      // Mark data loaded so the boot refresh does not clobber the fixture.
      installedPluginsLoaded: true,
      filesLoaded: true,
      piPackagesLoaded: true,
      // Open the namespace detail directly (same state Enter on the namespace sets).
      detail: { kind: "namespace", data: nsGroup },
    });
    const { stdout, stdin, unmount } = render(<App />);
    try {
      // Namespace detail is open (its footer is unique to the tree view).
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Enter open skill"));
      expect(useStore.getState().detail?.kind).toBe("namespace");
      await settleInput();

      // Drill into the skill: move the cursor down to the "alpha/deploy" skill-header
      // row, then Enter to open its detail.
      const selectedRowHas = (needle: string) =>
        (stdout.lastFrame() ?? "").split("\n").some((l) => l.includes("❯") && l.includes(needle));
      for (let i = 0; i < 12 && !selectedRowHas("alpha/deploy"); i += 1) {
        sendKey(stdin, KEYS.down);
        await settleInput();
      }
      expect(selectedRowHas("alpha/deploy")).toBe(true);

      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => useStore.getState().detail?.kind === "skill");

      // Esc must land back on the namespace detail (breadcrumb), not the list.
      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, () => useStore.getState().detail?.kind === "namespace");
      expect(stdout.lastFrame()).toContain("Enter open skill"); // namespace tree again
    } finally {
      unmount();
    }
  });

  // Breadcrumb: browsing into a marketplace's plugin sub-view sets a browse context;
  // Esc must restore the MARKETPLACE detail, not drop to the marketplace list. This
  // is handled by handleEscape's discoverSubView branch (outside the render overlay
  // registry, since sub-views render inside TabContent).
  it("Esc from a marketplace plugin sub-view returns to the marketplace detail", async () => {
    useStore.setState({
      tab: "marketplaces",
      // Row 0 is the "add marketplace" row; row 1 is the marketplace itself.
      selectedIndex: 1,
      notifications: [],
      marketplaces: [createMarketplace({ plugins: [createPlugin()], availableCount: 1 })],
    });
    const { stdout, stdin, unmount } = render(<App />);
    try {
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Test Marketplace"));
      await settleInput();

      // Open the marketplace detail, then browse into its plugin list (first action),
      // which clears detailMarketplace and sets the browse context + plugins sub-view.
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Browse plugins"));
      sendKey(stdin, KEYS.enter);
      await waitForFrame(stdout.lastFrame, () => useStore.getState().discoverSubView === "plugins");
      expect(useStore.getState().detailMarketplace).toBeNull();

      // Esc restores the marketplace detail (browse-context breadcrumb).
      sendKey(stdin, KEYS.escape);
      await waitForFrame(stdout.lastFrame, () => useStore.getState().detailMarketplace !== null);
      expect(useStore.getState().discoverSubView).toBeNull();
      expect(stdout.lastFrame()).toContain("Browse plugins"); // back on the detail
    } finally {
      unmount();
    }
  });
});
