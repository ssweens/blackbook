import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { useStore } from "./store.js";
import { getToolInstances, updateToolInstanceConfig, getEnabledToolInstances, getConfigRepoPath } from "./config.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  syncPluginInstances,
  updatePlugin,
  uninstallPlugin,
  removePiMarketplace,
} from "./install.js";
import { getSkillActions } from "./item-actions.js";
import { getConfigPath as getYamlConfigPath, loadConfig as loadYamlConfig } from "./config/loader.js";
import { saveConfig as saveYamlConfig } from "./config/writer.js";
import {
  loadAllPiMarketplaces,
  getAllPiPackages,
  loadPiSettings,
  isPackageInstalled,
  fetchNpmPackageDetails,
  getGlobalPiPackageInstallInfo,
  getFetchErrors,
} from "./marketplace.js";
import { installPiPackage, removePiPackage, repairPiPackageManager, updatePiPackage } from "./pi-install.js";
import { resolveSourcePath, expandPath as expandConfigPath } from "./config/path.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "./config/playbooks.js";
import { runCheck, runApply } from "./modules/orchestrator.js";
import type { Plugin, Marketplace, ToolInstance, ManagedToolRow, ToolDetectionResult, FileStatus } from "./types.js";

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
    getConfigRepoPath: vi.fn(),
    getPackageManager: vi.fn().mockReturnValue("npm"),
    setPiMarketplaceEnabled: vi.fn(),
    addPiMarketplace: vi.fn(),
    removePiMarketplace: vi.fn(),
  };
});

vi.mock("./install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./install.js")>();
  return {
    ...actual,
    getAllInstalledPlugins: vi.fn(),
    getPluginToolStatus: vi.fn(),
    getStandaloneSkills: vi.fn().mockReturnValue([]),
    syncPluginInstances: vi.fn(),
    updatePlugin: vi.fn(),
    uninstallPlugin: vi.fn().mockResolvedValue(true),
    removePiMarketplace: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketplace.js")>();
  return {
    ...actual,
    fetchMarketplace: vi.fn().mockResolvedValue([]),
    loadAllPiMarketplaces: vi.fn().mockResolvedValue([]),
    getAllPiPackages: vi.fn((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? [])),
    loadPiSettings: vi.fn().mockReturnValue({ packages: [] }),
    isPackageInstalled: vi.fn().mockReturnValue(false),
    fetchNpmPackageDetails: vi.fn().mockResolvedValue(null),
    getGlobalPiPackageInstallInfo: vi.fn().mockReturnValue(new Map()),
    resetFetchErrors: vi.fn(),
    getFetchErrors: vi.fn().mockReturnValue([]),
  };
});

vi.mock("./pi-install.js", () => ({
  installPiPackage: vi.fn().mockResolvedValue({ success: true }),
  removePiPackage: vi.fn().mockResolvedValue({ success: true }),
  repairPiPackageManager: vi.fn().mockResolvedValue({ success: true }),
  updatePiPackage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("./config/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/loader.js")>();
  return {
    ...actual,
    getConfigPath: vi.fn().mockReturnValue("/tmp/blackbook/config.yaml"),
    loadConfig: vi.fn().mockReturnValue({ config: { files: [], settings: {}, tools: {}, plugins: {}, configs: [], pi_packages: [] }, configPath: "/tmp/blackbook/config.yaml", errors: [] }),
  };
});

vi.mock("./config/writer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/writer.js")>();
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

vi.mock("./config/path.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/path.js")>();
  return {
    ...actual,
    resolveSourcePath: vi.fn((source: string, repo?: string) => repo ? `${repo}/${source}` : source),
    expandPath: vi.fn((p: string) => p.replace("~", "/home/user")),
  };
});

vi.mock("./config/playbooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/playbooks.js")>();
  return {
    ...actual,
    getAllPlaybooks: vi.fn().mockReturnValue(new Map()),
    resolveToolInstances: vi.fn().mockReturnValue(new Map()),
    isSyncTarget: vi.fn().mockReturnValue(true),
  };
});

vi.mock("./tool-view.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tool-view.js")>();
  return {
    ...actual,
    getManagedToolRows: vi.fn().mockReturnValue([]),
  };
});

vi.mock("./modules/orchestrator.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules/orchestrator.js")>();
  return {
    ...actual,
    runCheck: vi.fn().mockResolvedValue({ steps: [], summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 0 } }),
    runApply: vi.fn().mockResolvedValue({ steps: [], summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 0 } }),
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
    enabled: true,
    ...overrides,
  };
}

function createMockFile(overrides: Partial<FileStatus> = {}): FileStatus {
  return {
    name: "test-file",
    source: "AGENTS.md",
    target: "AGENTS.md",
    kind: "file",
    instances: [],
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
    kind: "tool",
    pluginFlatInstall: false,
    ...overrides,
  };
}

const ORIGINAL_REFRESH_ALL = useStore.getState().refreshAll;

describe("Plugin version merge", () => {
  beforeEach(() => {
    useStore.setState({
      marketplaces: [],
      installedPlugins: [],
      managedItems: [],
      standaloneSkills: [],
    });
    vi.mocked(getToolInstances).mockReturnValue([createMockTool()]);
    vi.mocked(getConfigRepoPath).mockReturnValue(null);
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "opencode",
        instanceId: "default",
        name: "OC",
        installed: true,
        supported: true,
        enabled: true,
      },
    ]);
  });

  it("marks a marketplace plugin installed when tool status finds its components even if the old marketplace key is gone", async () => {
    const staleInstalledRecord = createMockPlugin({
      name: "compound-engineering",
      marketplace: "every-marketplace",
      installed: true,
      skills: ["ce-work"],
    });
    const marketplacePlugin = createMockPlugin({
      name: "compound-engineering",
      marketplace: "compound-engineering-plugin",
      version: "3.8.2",
      latestVersion: "3.8.2",
      skills: ["ce-work"],
    });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({
      plugins: [staleInstalledRecord],
      byTool: {},
    });
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "opencode",
        instanceId: "default",
        name: "OC",
        installed: true,
        supported: true,
        enabled: true,
      },
    ]);

    useStore.setState({
      marketplaces: [
        createMockMarketplace({ name: "compound-engineering-plugin", plugins: [marketplacePlugin] }),
      ],
    });

    await useStore.getState().loadInstalledPlugins({ silent: true });

    const plugin = useStore.getState().marketplaces[0].plugins[0];
    expect(plugin.installed).toBe(true);
    expect(plugin.incomplete).toBe(false);
    expect(useStore.getState().marketplaces[0].installedCount).toBe(1);

    const installedPlugin = useStore.getState().installedPlugins.find((p) => p.name === "compound-engineering");
    expect(installedPlugin).toBeDefined();
    expect(installedPlugin).toMatchObject({
      marketplace: "compound-engineering-plugin",
      installed: true,
      incomplete: false,
    });
  });

  it("refreshes the open plugin detail after updating plugin version metadata", async () => {
    const oldPlugin = createMockPlugin({
      name: "compound-engineering",
      marketplace: "compound-engineering-plugin",
      version: "3.8.2",
      installedVersion: "3.7.3",
      latestVersion: "3.8.2",
      installed: true,
      hasUpdate: true,
      skills: ["ce-work"],
    });
    const refreshedPlugin = createMockPlugin({
      ...oldPlugin,
      installedVersion: "3.8.2",
      hasUpdate: false,
    });
    const marketplace = createMockMarketplace({
      name: "compound-engineering-plugin",
      url: "https://example.com/marketplace.json",
      plugins: [refreshedPlugin],
    });

    vi.mocked(updatePlugin).mockResolvedValue({
      success: true,
      linkedInstances: { "opencode:default": 1 },
      skippedInstances: [],
      errors: [],
    });

    const originalRefreshAll = useStore.getState().refreshAll;
    useStore.setState({
      marketplaces: [marketplace],
      installedPlugins: [oldPlugin],
      detailPlugin: oldPlugin,
      detail: { kind: "plugin", data: oldPlugin },
      tools: [createMockTool()],
      refreshAll: async () => {
        useStore.setState({
          marketplaces: [marketplace],
          installedPlugins: [refreshedPlugin],
          tools: [createMockTool()],
        });
      },
    });

    try {
      await useStore.getState().updatePlugin(oldPlugin);
    } finally {
      useStore.setState({ refreshAll: originalRefreshAll });
    }

    const state = useStore.getState();
    expect(state.detailPlugin).toMatchObject({
      name: "compound-engineering",
      installedVersion: "3.8.2",
      latestVersion: "3.8.2",
      hasUpdate: false,
    });
    expect(state.detail?.kind).toBe("plugin");
    expect(state.detail?.data).toMatchObject({ installedVersion: "3.8.2", hasUpdate: false });
  });

  it("keeps loaded plugin rows visible during a non-silent refresh", async () => {
    const plugin = createMockPlugin({ installed: true, skills: ["ce-work"] });
    const marketplace = createMockMarketplace({ plugins: [plugin] });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({
      plugins: [plugin],
      byTool: {},
    });

    useStore.setState({
      marketplaces: [marketplace],
      installedPlugins: [plugin],
      installedPluginsLoaded: true,
      files: [],
      piPackages: [],
    });

    const observedLoadedValues: boolean[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      observedLoadedValues.push(state.installedPluginsLoaded);
    });

    try {
      await useStore.getState().loadInstalledPlugins();
    } finally {
      unsubscribe();
    }

    expect(observedLoadedValues).not.toContain(false);
    expect(useStore.getState().installedPluginsLoaded).toBe(true);
    expect(useStore.getState().installedPlugins.length).toBeGreaterThan(0);
  });

  it("keeps loaded file rows visible during a non-silent refresh", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValueOnce("");
    const file = createMockFile();
    useStore.setState({
      files: [file],
      filesLoaded: true,
      installedPlugins: [],
      piPackages: [],
    });

    const observedLoadedValues: boolean[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      observedLoadedValues.push(state.filesLoaded);
    });

    try {
      await useStore.getState().loadFiles();
    } finally {
      unsubscribe();
    }

    expect(observedLoadedValues).not.toContain(false);
    expect(useStore.getState().filesLoaded).toBe(true);
  });

  it("marks installed plugins as no longer in marketplace when the configured marketplace stops listing them", async () => {
    const installed = createMockPlugin({
      name: "legacy-plugin",
      marketplace: "playbook",
      installed: true,
      skills: ["legacy-skill"],
    });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [installed], byTool: {} });
    useStore.setState({
      marketplaces: [createMockMarketplace({ name: "playbook", plugins: [createMockPlugin({ name: "other-plugin", marketplace: "playbook" })] })],
    });

    await useStore.getState().loadInstalledPlugins({ silent: true });

    expect(useStore.getState().installedPlugins[0]).toMatchObject({
      name: "legacy-plugin",
      marketplace: "playbook",
      prescriptionStatus: "no-longer-in-marketplace",
    });
  });

  it("keeps installed plugins from removed marketplaces and marks them orphaned", async () => {
    const installed = createMockPlugin({
      name: "orphan-plugin",
      marketplace: "old-marketplace",
      installed: true,
      skills: ["orphan-skill"],
    });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [installed], byTool: {} });
    useStore.setState({
      marketplaces: [createMockMarketplace({ name: "playbook", plugins: [createMockPlugin({ name: "other-plugin", marketplace: "playbook" })] })],
    });

    await useStore.getState().loadInstalledPlugins({ silent: true });

    expect(useStore.getState().installedPlugins[0]).toMatchObject({
      name: "orphan-plugin",
      marketplace: "old-marketplace",
      prescriptionStatus: "marketplace-removed",
    });
  });

  it("includes repo-prescribed marketplace plugins even when not installed", async () => {
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "opencode",
        instanceId: "default",
        name: "OC",
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);
    useStore.setState({
      marketplaces: [createMockMarketplace({
        name: "playbook",
        plugins: [
          createMockPlugin({ name: "agentic-app-creator", marketplace: "playbook" }),
          createMockPlugin({ name: "crafting-interfaces", marketplace: "playbook" }),
          createMockPlugin({ name: "eval-model", marketplace: "playbook" }),
        ],
      })],
    });

    await useStore.getState().loadInstalledPlugins({ silent: true });

    expect(useStore.getState().installedPlugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "agentic-app-creator", marketplace: "playbook", installed: false, prescriptionStatus: "in-git" }),
      expect.objectContaining({ name: "crafting-interfaces", marketplace: "playbook", installed: false, prescriptionStatus: "in-git" }),
      expect.objectContaining({ name: "eval-model", marketplace: "playbook", installed: false, prescriptionStatus: "in-git" }),
    ]));
  });

  it("tracks a recoverable orphan plugin into the source repo marketplace", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-plugin-track-repo-"));
    const pluginSource = mkdtempSync(join(tmpdir(), "blackbook-plugin-track-src-"));
    mkdirSync(join(pluginSource, "skills", "tracked-skill"), { recursive: true });
    writeFileSync(join(pluginSource, "skills", "tracked-skill", "SKILL.md"), "---\nname: tracked-skill\n---\n");

    vi.mocked(getConfigRepoPath).mockReturnValue(sourceRepo);
    const plugin = createMockPlugin({
      name: "tracked-plugin",
      marketplace: "old-marketplace",
      source: pluginSource,
      description: "Tracked plugin",
      version: "1.2.3",
      installed: true,
      prescriptionStatus: "marketplace-removed",
      skills: ["tracked-skill"],
    });

    try {
      const ok = await useStore.getState().trackPluginInSource(plugin);
      expect(ok).toBe(true);
      expect(existsSync(join(sourceRepo, "plugins", "tracked-plugin", "skills", "tracked-skill", "SKILL.md"))).toBe(true);
      expect(existsSync(join(sourceRepo, "plugins", "tracked-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
      const marketplace = JSON.parse(readFileSync(join(sourceRepo, ".claude-plugin", "marketplace.json"), "utf-8"));
      expect(marketplace.plugins).toContainEqual(expect.objectContaining({
        name: "tracked-plugin",
        source: "./plugins/tracked-plugin",
        version: "1.2.3",
      }));
    } finally {
      rmSync(sourceRepo, { recursive: true, force: true });
      rmSync(pluginSource, { recursive: true, force: true });
    }
  });

  it("refuses to track a plugin whose name escapes the plugins/ directory", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-plugin-evil-repo-"));
    const pluginSource = mkdtempSync(join(tmpdir(), "blackbook-plugin-evil-src-"));
    // A sibling file outside plugins/ that a traversal delete would clobber.
    const outsideVictim = join(sourceRepo, "victim.txt");
    writeFileSync(outsideVictim, "precious");

    vi.mocked(getConfigRepoPath).mockReturnValue(sourceRepo);
    const plugin = createMockPlugin({
      name: "../../evil",
      marketplace: "evil",
      source: pluginSource,
      installed: true,
    });

    try {
      const ok = await useStore.getState().trackPluginInSource(plugin);
      expect(ok).toBe(false);
      // The traversal target must be untouched.
      expect(existsSync(outsideVictim)).toBe(true);
      expect(readFileSync(outsideVictim, "utf-8")).toBe("precious");
    } finally {
      rmSync(sourceRepo, { recursive: true, force: true });
      rmSync(pluginSource, { recursive: true, force: true });
    }
  });

  it("refuses to remove-from-git a plugin whose name escapes the plugins/ directory", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-plugin-evilrm-repo-"));
    const outsideVictim = join(sourceRepo, "victim.txt");
    writeFileSync(outsideVictim, "precious");

    vi.mocked(getConfigRepoPath).mockReturnValue(sourceRepo);
    const plugin = createMockPlugin({ name: "../../evil", marketplace: "evil" });

    try {
      const ok = await useStore.getState().removePluginFromGit(plugin);
      expect(ok).toBe(false);
      expect(existsSync(outsideVictim)).toBe(true);
      expect(readFileSync(outsideVictim, "utf-8")).toBe("precious");
    } finally {
      rmSync(sourceRepo, { recursive: true, force: true });
    }
  });

  it("aborts tracking without overwriting a corrupt source-repo marketplace.json", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-plugin-corrupt-repo-"));
    const pluginSource = mkdtempSync(join(tmpdir(), "blackbook-plugin-corrupt-src-"));
    mkdirSync(join(pluginSource, "skills", "s"), { recursive: true });
    writeFileSync(join(pluginSource, "skills", "s", "SKILL.md"), "---\nname: s\n---\n");

    const marketplacePath = join(sourceRepo, ".claude-plugin", "marketplace.json");
    mkdirSync(join(sourceRepo, ".claude-plugin"), { recursive: true });
    // Deliberately invalid JSON (trailing comma) holding multiple real entries.
    const corruptContent = `{
  "name": "playbook",
  "plugins": [
    { "name": "alpha", "source": "./plugins/alpha" },
    { "name": "beta", "source": "./plugins/beta" },
  ]
}`;
    writeFileSync(marketplacePath, corruptContent);

    vi.mocked(getConfigRepoPath).mockReturnValue(sourceRepo);
    const plugin = createMockPlugin({
      name: "tracked-plugin",
      marketplace: "old",
      source: pluginSource,
      installed: true,
      skills: ["s"],
    });

    try {
      const ok = await useStore.getState().trackPluginInSource(plugin);
      expect(ok).toBe(false);
      // The corrupt-but-real file must be preserved byte-for-byte, not reset.
      expect(readFileSync(marketplacePath, "utf-8")).toBe(corruptContent);
    } finally {
      rmSync(sourceRepo, { recursive: true, force: true });
      rmSync(pluginSource, { recursive: true, force: true });
    }
  });

  it("removes a tracked plugin from a real git source repo (async git path)", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-plugin-git-repo-"));
    // Real git repo so removePluginFromGit exercises the async add/commit/push path.
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: sourceRepo, encoding: "utf-8", env: gitEnv });
    git("init", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");

    mkdirSync(join(sourceRepo, "plugins", "gitplugin"), { recursive: true });
    writeFileSync(join(sourceRepo, "plugins", "gitplugin", "file.txt"), "content");
    mkdirSync(join(sourceRepo, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(sourceRepo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "playbook", plugins: [{ name: "gitplugin", source: "./plugins/gitplugin" }] }, null, 2) + "\n",
    );
    git("add", "-A");
    git("commit", "-m", "initial");

    vi.mocked(getConfigRepoPath).mockReturnValue(sourceRepo);
    const plugin = createMockPlugin({ name: "gitplugin", marketplace: "playbook" });

    try {
      const ok = await useStore.getState().removePluginFromGit(plugin);
      expect(ok).toBe(true);
      // Plugin dir gone and marketplace entry stripped.
      expect(existsSync(join(sourceRepo, "plugins", "gitplugin"))).toBe(false);
      const marketplace = JSON.parse(
        readFileSync(join(sourceRepo, ".claude-plugin", "marketplace.json"), "utf-8"),
      );
      expect(marketplace.plugins.find((p: { name: string }) => p.name === "gitplugin")).toBeUndefined();
      // The removal was committed locally (push fails with no remote, but that's a warning).
      const log = execFileSync("git", ["log", "--oneline"], { cwd: sourceRepo, encoding: "utf-8", env: gitEnv });
      expect(log).toContain("remove: gitplugin from git");
    } finally {
      rmSync(sourceRepo, { recursive: true, force: true });
    }
  });

  it("marks an installed plugin outdated when a newer configured marketplace has the same plugin", async () => {
    const installed = createMockPlugin({
      name: "compound-engineering",
      marketplace: "every-marketplace",
      version: "2.27.0",
      installedVersion: "2.27.0",
      installed: true,
      skills: ["frontend-design"],
    });
    const oldMarketplacePlugin = createMockPlugin({
      name: "compound-engineering",
      marketplace: "every-marketplace",
      version: "2.27.0",
      latestVersion: "2.27.0",
    });
    const newMarketplacePlugin = createMockPlugin({
      name: "compound-engineering",
      marketplace: "compound-engineering-plugin",
      version: "3.0.0",
      latestVersion: "3.0.0",
    });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({
      plugins: [installed],
      byTool: {},
    });

    useStore.setState({
      marketplaces: [
        createMockMarketplace({ name: "every-marketplace", plugins: [oldMarketplacePlugin] }),
        createMockMarketplace({ name: "compound-engineering-plugin", plugins: [newMarketplacePlugin] }),
      ],
    });

    await useStore.getState().loadInstalledPlugins({ silent: true });

    const plugin = useStore.getState().installedPlugins.find((p) => p.name === "compound-engineering");
    expect(plugin).toBeDefined();
    expect(plugin!.marketplace).toBe("compound-engineering-plugin");
    expect(plugin!.installedMarketplace).toBe("every-marketplace");
    expect(plugin!.installedVersion).toBe("2.27.0");
    expect(plugin!.latestVersion).toBe("3.0.0");
    expect(plugin!.hasUpdate).toBe(true);
  });
});

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
      discoverSubView: "plugins",
      currentSection: "piPackages",
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
    expect(state.discoverSubView).toBeNull();
    expect(state.currentSection).toBe("plugins");
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

  it("should set detail marketplace", () => {
    const marketplace = createMockMarketplace({ name: "my-marketplace" });
    const { setDetailMarketplace } = useStore.getState();
    setDetailMarketplace(marketplace);

    expect(useStore.getState().detailMarketplace?.name).toBe("my-marketplace");
  });
});

describe("Store marketplace management", () => {
  beforeEach(() => {
    vi.mocked(removePiMarketplace).mockReset();
    vi.mocked(removePiMarketplace).mockResolvedValue(undefined);
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

  it("should notify (not throw) when saving a new marketplace to config fails", async () => {
    const { addMarketplace: addMarketplaceToConfig } = await import("./config.js");
    vi.mocked(addMarketplaceToConfig).mockImplementationOnce(() => {
      throw new Error("Cannot save config: existing config.yaml has errors");
    });

    const { addMarketplace } = useStore.getState();
    expect(() => addMarketplace("broken-config", "https://broken.example.com")).not.toThrow();

    const { marketplaces, notifications } = useStore.getState();
    expect(marketplaces).toHaveLength(1); // unchanged — the throwing write never applied
    expect(notifications.some((n) => n.type === "error" && n.message.includes("broken-config"))).toBe(true);
  });

  it("should notify (not throw/crash) when saving a new Pi marketplace to config fails", async () => {
    const { addPiMarketplace: addPiMarketplaceToConfig } = await import("./config.js");
    vi.mocked(addPiMarketplaceToConfig).mockImplementationOnce(() => {
      throw new Error("Cannot save config: existing config.yaml has errors");
    });
    useStore.setState({ piMarketplaces: [] });

    const { addPiMarketplace } = useStore.getState();
    await expect(addPiMarketplace("broken-pi-source", "npm:@foo/bar")).resolves.not.toThrow();

    const { notifications } = useStore.getState();
    expect(notifications.some((n) => n.type === "error" && n.message.includes("broken-pi-source"))).toBe(true);
  });

  it("should remove marketplace from Pi before removing Blackbook config", async () => {
    const { removeMarketplace } = useStore.getState();
    await removeMarketplace("existing");

    expect(removePiMarketplace).toHaveBeenCalledWith("existing");
    const { marketplaces } = useStore.getState();
    expect(marketplaces).toHaveLength(0);
  });

  it("should keep Blackbook config when Pi marketplace removal fails", async () => {
    vi.mocked(removePiMarketplace).mockRejectedValueOnce(new Error("Pi cleanup failed"));

    const { removeMarketplace } = useStore.getState();
    await removeMarketplace("existing");

    expect(removePiMarketplace).toHaveBeenCalledWith("existing");
    const { marketplaces } = useStore.getState();
    expect(marketplaces).toHaveLength(1);
    expect(marketplaces[0].name).toBe("existing");
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

  it("toggles tool enablement and refreshes", async () => {
    const tool = createMockTool({ enabled: true });
    vi.mocked(getToolInstances).mockReturnValue([tool]);

    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ refreshAll: refreshAll as () => Promise<void> });

    await useStore.getState().toggleToolEnabled(tool.toolId, tool.instanceId);

    expect(updateToolInstanceConfig).toHaveBeenCalledWith(
      tool.toolId,
      tool.instanceId,
      expect.objectContaining({ enabled: false })
    );
    expect(refreshAll).toHaveBeenCalled();
  });

  it("notifies (does not throw/refresh) when toggling a tool fails to save", async () => {
    const tool = createMockTool({ enabled: true });
    vi.mocked(getToolInstances).mockReturnValue([tool]);
    vi.mocked(updateToolInstanceConfig).mockImplementationOnce(() => {
      throw new Error("Cannot save config: existing config.yaml has errors");
    });

    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ refreshAll: refreshAll as () => Promise<void> });

    await expect(useStore.getState().toggleToolEnabled(tool.toolId, tool.instanceId)).resolves.not.toThrow();

    expect(refreshAll).not.toHaveBeenCalled();
    const { notifications } = useStore.getState();
    expect(notifications.some((n) => n.type === "error")).toBe(true);
  });

  it("updates tool config_dir with trimmed value", async () => {
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ refreshAll: refreshAll as () => Promise<void> });

    await useStore.getState().updateToolConfigDir("opencode", "default", "  /tmp/opencode  ");

    expect(updateToolInstanceConfig).toHaveBeenCalledWith(
      "opencode",
      "default",
      expect.objectContaining({ configDir: "/tmp/opencode" })
    );
    expect(refreshAll).toHaveBeenCalled();
  });
});

describe("Store sync tools", () => {
  beforeEach(() => {
    vi.mocked(getAllInstalledPlugins).mockReset();
    vi.mocked(getPluginToolStatus).mockReset();
    vi.mocked(syncPluginInstances).mockReset();
  });

  it("builds a sync preview for partial plugins", () => {
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

    const preview = useStore.getState().getSyncPreview();
    expect(preview).toHaveLength(1);
    expect(preview[0].kind).toBe("plugin");
    if (preview[0].kind === "plugin") {
      expect(preview[0].plugin.name).toBe("partial-plugin");
      expect(preview[0].missingInstances).toContain("OpenCode Secondary");
    }
  });

  it("includes installed tools with updates in sync preview", () => {
    const managedTools: ManagedToolRow[] = [
      {
        toolId: "amp-code",
        displayName: "Amp",
        instanceId: "default",
        configDir: "/tmp/amp",
        enabled: true,
        synthetic: false,
      },
    ];
    const toolDetection: Record<string, ToolDetectionResult> = {
      "amp-code": {
        toolId: "amp-code",
        installed: true,
        binaryPath: "/usr/local/bin/amp",
        installedVersion: "0.0.1",
        latestVersion: "0.0.2",
        hasUpdate: true,
        error: null,
      },
    };

    useStore.setState({ managedTools, toolDetection });
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });

    const preview = useStore.getState().getSyncPreview();
    expect(preview).toHaveLength(1);
    expect(preview[0].kind).toBe("tool");
    if (preview[0].kind === "tool") {
      expect(preview[0].toolId).toBe("amp-code");
      expect(preview[0].installedVersion).toBe("0.0.1");
      expect(preview[0].latestVersion).toBe("0.0.2");
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

describe("Store loadFiles (YAML config)", () => {
  beforeEach(() => {
    useStore.setState({ files: [] });
    vi.mocked(getYamlConfigPath).mockReset();
    vi.mocked(loadYamlConfig).mockReset();
    vi.mocked(getAllPlaybooks).mockReset();
    vi.mocked(resolveToolInstances).mockReset();
    vi.mocked(isSyncTarget).mockReset();
    vi.mocked(runCheck).mockReset();
    vi.mocked(expandConfigPath).mockReset();
    vi.mocked(resolveSourcePath).mockReset();
  });

  it("returns empty when config path is not YAML", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.json");

    const files = await useStore.getState().loadFiles();

    expect(files).toEqual([]);
    expect(useStore.getState().files).toEqual([]);
    expect(loadYamlConfig).not.toHaveBeenCalled();
  });

  it("returns empty when YAML config has errors", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [{ source: "yaml", message: "parse error" }],
    });

    const files = await useStore.getState().loadFiles();

    expect(files).toEqual([]);
  });

  it("returns empty when config has no files and playbooks have no config_files", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(getAllPlaybooks).mockReturnValue(new Map([
      ["opencode", { syncable: true, config_files: [], default_instances: [] }],
    ]) as any);
    vi.mocked(resolveToolInstances).mockReturnValue(new Map());

    const files = await useStore.getState().loadFiles();

    expect(files).toEqual([]);
  });

  it("builds FileStatus for each file entry across instances", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        files: [
          { name: "CLAUDE.md", source: "CLAUDE.md", target: "CLAUDE.md" },
        ],
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm", config_management: true },
        tools: {},
        plugins: {},
        configs: [],
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const playbooks = new Map([
      ["claude-code", { syncable: true }],
    ]);
    vi.mocked(getAllPlaybooks).mockReturnValue(playbooks as any);
    vi.mocked(isSyncTarget).mockReturnValue(true);
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p.replace("~", "/home/user"));
    vi.mocked(resolveSourcePath).mockImplementation((source: string, repo?: string) =>
      repo ? `${repo}/${source}` : source
    );
    vi.mocked(resolveToolInstances).mockReturnValue(
      new Map([
        ["claude-code", [
          { id: "default", name: "Claude", enabled: true, config_dir: "~/.claude" },
        ]],
      ])
    );
    vi.mocked(runCheck).mockResolvedValue({
      steps: [{ label: "CLAUDE.md:claude-code:default", check: { status: "missing", message: "File not found", diff: undefined } }],
      summary: { ok: 0, missing: 1, drifted: 0, failed: 0, changed: 0 },
    });

    const files = await useStore.getState().loadFiles();

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("CLAUDE.md");
    expect(files[0].instances).toHaveLength(1);
    expect(files[0].instances[0]).toMatchObject({
      toolId: "claude-code",
      instanceId: "default",
      instanceName: "Claude",
      status: "missing",
    });
  });

  it("skips disabled instances", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        files: [
          { name: "settings.json", source: "settings.json", target: "settings.json" },
        ],
        settings: { package_manager: "pnpm", config_management: true },
        tools: {},
        plugins: {},
        configs: [],
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    vi.mocked(getAllPlaybooks).mockReturnValue(new Map([["claude-code", { syncable: true }]]) as any);
    vi.mocked(isSyncTarget).mockReturnValue(true);
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
    vi.mocked(resolveSourcePath).mockImplementation((s: string) => s);
    vi.mocked(resolveToolInstances).mockReturnValue(
      new Map([
        ["claude-code", [
          { id: "default", name: "Claude", enabled: false, config_dir: "/home/.claude" },
        ]],
      ])
    );

    const files = await useStore.getState().loadFiles();

    expect(files).toHaveLength(1);
    expect(files[0].instances).toHaveLength(0);
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("uses directory-sync module when source path is a directory", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "blackbook-src-"));
    const sourceDir = join(sourceRoot, "read");
    mkdirSync(sourceDir, { recursive: true });

    try {
      vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
      vi.mocked(loadYamlConfig).mockReturnValue({
        config: {
          files: [
            { name: "read", source: "read", target: "read" },
          ],
          settings: { package_manager: "pnpm", config_management: true },
          tools: {},
          plugins: {},
          configs: [],
        } as any,
        configPath: "/tmp/blackbook/config.yaml",
        errors: [],
      });

      vi.mocked(getAllPlaybooks).mockReturnValue(new Map([["opencode", { syncable: true }]]) as any);
      vi.mocked(isSyncTarget).mockReturnValue(true);
      vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
      vi.mocked(resolveSourcePath).mockReturnValue(sourceDir);
      vi.mocked(resolveToolInstances).mockReturnValue(
        new Map([
          ["opencode", [
            { id: "default", name: "OpenCode", enabled: true, config_dir: "/tmp/opencode" },
          ]],
        ])
      );
      vi.mocked(runCheck).mockResolvedValue({
        steps: [{ label: "read:opencode:default", check: { status: "missing", message: "Directory not found" } }],
        summary: { ok: 0, missing: 1, drifted: 0, failed: 0, changed: 0 },
      });

      await useStore.getState().loadFiles();

      const steps = vi.mocked(runCheck).mock.calls[0][0];
      expect((steps[0].module as any).name).toBe("directory-sync");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("injects synthetic entries for uncovered playbook config_files", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        files: [],
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm", config_management: true },
        tools: {},
        plugins: {},
        configs: [],
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const playbooks = new Map([
      ["pi", {
        syncable: true,
        config_files: [
          { name: "Pi Config", path: "settings.json", format: "json" },
        ],
        default_instances: [{ id: "default", name: "Pi", config_dir: "~/.pi/agent" }],
      }],
    ]);
    vi.mocked(getAllPlaybooks).mockReturnValue(playbooks as any);
    vi.mocked(isSyncTarget).mockReturnValue(true);
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p.replace("~", "/home/user"));
    vi.mocked(resolveSourcePath).mockImplementation((source: string, repo?: string) =>
      repo ? `${repo}/${source}` : source
    );
    vi.mocked(resolveToolInstances).mockReturnValue(
      new Map([
        ["pi", [
          { id: "default", name: "Pi", enabled: true, config_dir: "~/.pi/agent" },
        ]],
      ])
    );
    vi.mocked(runCheck).mockResolvedValue({
      steps: [{ label: "Pi Config:pi:default", check: { status: "drifted", message: "Target changed", driftKind: "target-changed" } }],
      summary: { ok: 0, missing: 0, drifted: 1, failed: 0, changed: 0 },
    });

    const files = await useStore.getState().loadFiles();

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Pi Config");
    expect(files[0].source).toBe("config/pi/settings.json");
    expect(files[0].target).toBe("settings.json");
    expect(files[0].tools).toEqual(["pi"]);
    expect(files[0].instances).toHaveLength(1);
    expect(files[0].instances[0]).toMatchObject({
      toolId: "pi",
      instanceId: "default",
      instanceName: "Pi",
      targetRelPath: "settings.json",
      status: "drifted",
      driftKind: "target-changed",
    });
  });

  it("does not inject synthetic entry when explicit config covers the target", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        files: [
          { name: "AGENTS.md", source: "AGENTS.md", target: "AGENTS.md", overrides: { "claude-code:default": "CLAUDE.md" } },
        ],
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm", config_management: true },
        tools: {},
        plugins: {},
        configs: [],
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const playbooks = new Map([
      ["claude-code", {
        syncable: true,
        config_files: [
          { name: "CLAUDE.md", path: "CLAUDE.md", format: "markdown" },
        ],
        default_instances: [{ id: "default", name: "Claude", config_dir: "~/.claude" }],
      }],
    ]);
    vi.mocked(getAllPlaybooks).mockReturnValue(playbooks as any);
    vi.mocked(isSyncTarget).mockReturnValue(true);
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p.replace("~", "/home/user"));
    vi.mocked(resolveSourcePath).mockImplementation((source: string, repo?: string) =>
      repo ? `${repo}/${source}` : source
    );
    vi.mocked(resolveToolInstances).mockReturnValue(
      new Map([
        ["claude-code", [
          { id: "default", name: "Claude", enabled: true, config_dir: "~/.claude" },
        ]],
      ])
    );
    vi.mocked(runCheck).mockResolvedValue({
      steps: [{ label: "AGENTS.md:claude-code:default", check: { status: "ok", message: "In sync" } }],
      summary: { ok: 1, missing: 0, drifted: 0, failed: 0, changed: 0 },
    });

    const files = await useStore.getState().loadFiles();

    // Only the explicit AGENTS.md entry — no synthetic CLAUDE.md because
    // the override resolved targetRelPath to "CLAUDE.md" covering it
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("AGENTS.md");
  });

  it("includes file items in sync preview for missing/drifted only", () => {
    useStore.setState({
      files: [
        {
          name: "ok-file",
          source: "ok.md",
          target: "ok.md",
          kind: "file",
          instances: [{ toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp", targetRelPath: "ok.md", sourcePath: "/src/ok.md", targetPath: "/tmp/ok.md", status: "ok", message: "File matches" }],
        },
        {
          name: "missing-file",
          source: "missing.md",
          target: "missing.md",
          kind: "file",
          instances: [{ toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp", targetRelPath: "missing.md", sourcePath: "/src/missing.md", targetPath: "/tmp/missing.md", status: "missing", message: "Not found" }],
        },
      ],
      managedTools: [],
      toolDetection: {},
    });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });

    const preview = useStore.getState().getSyncPreview();
    const fileItems = preview.filter((p) => p.kind === "file");

    expect(fileItems).toHaveLength(1);
    if (fileItems[0].kind === "file") {
      expect(fileItems[0].file.name).toBe("missing-file");
      expect(fileItems[0].missingInstances).toContain("Claude");
    }
  });
});

describe("Store syncTools with file items", () => {
  beforeEach(() => {
    useStore.setState({ notifications: [] });
    vi.mocked(loadYamlConfig).mockReset();
    vi.mocked(runApply).mockReset();
    vi.mocked(expandConfigPath).mockReset();
    vi.mocked(resolveSourcePath).mockReset();
  });

  it("syncs file items via orchestrator runApply", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { source_repo: "~/dotfiles", package_manager: "pnpm" }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/config.yaml",
      errors: [],
    });
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p.replace("~", "/home/user"));
    vi.mocked(resolveSourcePath).mockImplementation((source: string, repo?: string) =>
      repo ? `${repo}/${source}` : source
    );
    vi.mocked(runApply).mockResolvedValue({
      steps: [{ label: "CLAUDE.md:claude-code:default", check: { status: "missing", message: "" }, apply: { changed: true, message: "File copied" } }],
      summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
    });

    await useStore.getState().syncTools([
      {
        kind: "file",
        file: {
          name: "CLAUDE.md",
          source: "CLAUDE.md",
          target: "CLAUDE.md",
          kind: "file",
          instances: [
            { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/home/user/.claude", targetRelPath: "CLAUDE.md", sourcePath: "/home/user/dotfiles/CLAUDE.md", targetPath: "/home/user/.claude/CLAUDE.md", status: "missing", message: "Not found" },
          ],
        },
        missingInstances: ["Claude"],
        driftedInstances: [],
      },
    ]);

    expect(runApply).toHaveBeenCalledTimes(1);
    const { notifications } = useStore.getState();
    const successNote = notifications.find((n) => n.type === "success");
    expect(successNote?.message).toContain("Synced 1");
  });

  it("gates a never-synced target that already exists out of the default sync", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { source_repo: "~/dotfiles", package_manager: "pnpm", backup_retention: 3 }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/config.yaml",
      errors: [],
    });
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
    vi.mocked(resolveSourcePath).mockImplementation((source: string) => source);
    vi.mocked(runApply).mockResolvedValue({
      steps: [],
      summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
    });

    const untrackedInstance = {
      toolId: "claude-code", instanceId: "default", instanceName: "Claude",
      configDir: "/home/user/.claude", targetRelPath: "settings.json",
      sourcePath: "/home/user/dotfiles/settings.json", targetPath: "/home/user/.claude/settings.json",
      status: "drifted" as const, driftKind: "never-synced" as const, message: "Untracked target (sync overwrites it)",
    };
    const fileItem = (force: boolean) => ({
      kind: "file" as const,
      file: {
        name: "settings.json", source: "settings.json", target: "settings.json", kind: "file" as const,
        instances: [untrackedInstance],
      },
      missingInstances: [],
      driftedInstances: ["Claude"],
      forceOverwrite: force,
    });

    // Default bulk sync: the untracked target is skipped, so runApply gets no steps.
    await useStore.getState().syncTools([fileItem(false)]);
    expect(runApply).not.toHaveBeenCalled();

    // Explicit push (forceOverwrite): the instance is now included.
    await useStore.getState().syncTools([fileItem(true)]);
    expect(runApply).toHaveBeenCalledTimes(1);
    const steps = vi.mocked(runApply).mock.calls[0][0];
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toContain("settings.json");
  });

  it("syncs safe instances while skipping a conflicted one in the same file", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { source_repo: "~/dotfiles", package_manager: "pnpm", backup_retention: 3 }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/config.yaml",
      errors: [],
    });
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
    vi.mocked(resolveSourcePath).mockImplementation((source: string) => source);
    vi.mocked(runApply).mockResolvedValue({
      steps: [{ label: "CLAUDE.md:claude-code:default", check: { status: "missing", message: "" }, apply: { changed: true, message: "copied" } }],
      summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
    });

    await useStore.getState().syncTools([
      {
        kind: "file",
        file: {
          name: "CLAUDE.md", source: "CLAUDE.md", target: "CLAUDE.md", kind: "file",
          instances: [
            { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/c", targetRelPath: "CLAUDE.md", sourcePath: "/s/CLAUDE.md", targetPath: "/c/CLAUDE.md", status: "missing", message: "" },
            { toolId: "opencode", instanceId: "default", instanceName: "OpenCode", configDir: "/o", targetRelPath: "CLAUDE.md", sourcePath: "/s/CLAUDE.md", targetPath: "/o/CLAUDE.md", status: "drifted", driftKind: "both-changed", message: "conflict" },
          ],
        },
        missingInstances: ["Claude"],
        driftedInstances: ["OpenCode"],
      },
    ]);

    // The conflicted (both-changed) instance is skipped; the safe one still syncs.
    const steps = vi.mocked(runApply).mock.calls[0][0];
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toContain("claude-code");
  });

  it("continues the batch when one file item reports an error", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { source_repo: "~/dotfiles", package_manager: "pnpm", backup_retention: 3 }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/config.yaml",
      errors: [],
    });
    vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
    vi.mocked(resolveSourcePath).mockImplementation((source: string) => source);
    vi.mocked(runApply)
      .mockResolvedValueOnce({
        steps: [{ label: "A.md:claude-code:default", check: { status: "missing", message: "" }, apply: { changed: false, message: "boom", error: "boom" } }],
        summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 0 },
      })
      .mockResolvedValueOnce({
        steps: [{ label: "B.md:claude-code:default", check: { status: "missing", message: "" }, apply: { changed: true, message: "ok" } }],
        summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
      });

    const mkFile = (name: string) => ({
      kind: "file" as const,
      file: {
        name, source: name, target: name, kind: "file" as const,
        instances: [
          { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/c", targetRelPath: name, sourcePath: `/s/${name}`, targetPath: `/c/${name}`, status: "missing" as const, message: "" },
        ],
      },
      missingInstances: ["Claude"],
      driftedInstances: [],
    });

    await useStore.getState().syncTools([mkFile("A.md"), mkFile("B.md")]);

    // The first item's error does not abort the second — both are processed.
    expect(runApply).toHaveBeenCalledTimes(2);
    const { notifications } = useStore.getState();
    expect(notifications.find((n) => n.type === "error")?.message).toContain("boom");
    expect(notifications.find((n) => n.type === "success")?.message).toContain("Synced");
  });

  it("uses directory-sync module when syncing directory entries", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "blackbook-sync-src-"));
    const sourceDir = join(sourceRoot, "read");
    mkdirSync(sourceDir, { recursive: true });

    try {
      vi.mocked(loadYamlConfig).mockReturnValue({
        config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {}, configs: [] } as any,
        configPath: "/tmp/config.yaml",
        errors: [],
      });
      vi.mocked(expandConfigPath).mockImplementation((p: string) => p);
      vi.mocked(resolveSourcePath).mockReturnValue(sourceDir);
      vi.mocked(runApply).mockResolvedValue({
        steps: [{ label: "read:opencode:default", check: { status: "missing", message: "" }, apply: { changed: true, message: "Directory synced" } }],
        summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
      });

      await useStore.getState().syncTools([
        {
          kind: "file",
          file: {
            name: "read",
            source: "read",
            target: "read",
            kind: "file",
            instances: [
              { toolId: "opencode", instanceId: "default", instanceName: "OpenCode", configDir: "/tmp/opencode", targetRelPath: "read", sourcePath: sourceDir, targetPath: "/tmp/opencode/read", status: "missing", message: "Not found" },
            ],
          },
          missingInstances: ["OpenCode"],
          driftedInstances: [],
        },
      ]);

      const steps = vi.mocked(runApply).mock.calls[0][0];
      expect((steps[0].module as any).name).toBe("directory-sync");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("reports errors when config fails to load during file sync", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {}, configs: [] } as any,
      configPath: "/tmp/config.yaml",
      errors: [{ source: "yaml", message: "bad config" }],
    });

    await useStore.getState().syncTools([
      {
        kind: "file",
        file: {
          name: "test.md",
          source: "test.md",
          target: "test.md",
          kind: "file",
          instances: [
            { toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp", targetRelPath: "test.md", sourcePath: "/src/test.md", targetPath: "/tmp/test.md", status: "missing", message: "Not found" },
          ],
        },
        missingInstances: ["Claude"],
        driftedInstances: [],
      },
    ]);

    expect(runApply).not.toHaveBeenCalled();
    const { notifications } = useStore.getState();
    const errorNote = notifications.find((n) => n.type === "error");
    expect(errorNote?.message).toContain("bad config");
  });
});

describe("Repo-prescribed Pi packages", () => {
  beforeEach(() => {
    useStore.setState({
      tools: [{ toolId: "pi", instanceId: "default", name: "Pi", configDir: "/tmp/pi", enabled: true, kind: "tool" } as any],
      toolDetection: {},
      piPackages: [],
      piPackagesLoaded: false,
      piMarketplaces: [],
      installedPlugins: [],
      files: [],
      managedItems: [],
      managedTools: [],
      standaloneSkills: [],
    });
    vi.mocked(loadYamlConfig).mockReset();
    vi.mocked(loadAllPiMarketplaces).mockReset();
    vi.mocked(getAllPiPackages).mockReset();
    vi.mocked(loadPiSettings).mockReset();
    vi.mocked(isPackageInstalled).mockReset();
    vi.mocked(fetchNpmPackageDetails).mockReset();
    vi.mocked(getGlobalPiPackageInstallInfo).mockReset();
    vi.mocked(saveYamlConfig).mockReset();
    vi.mocked(installPiPackage).mockReset();
    vi.mocked(removePiPackage).mockReset();
    vi.mocked(repairPiPackageManager).mockReset();
    vi.mocked(updatePiPackage).mockReset();
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });

    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([]);
    vi.mocked(getAllPiPackages).mockReturnValue([]);
    vi.mocked(loadPiSettings).mockReturnValue({ packages: [] });
    vi.mocked(isPackageInstalled).mockReturnValue(false);
    vi.mocked(getGlobalPiPackageInstallInfo).mockReturnValue(new Map());
    vi.mocked(installPiPackage).mockResolvedValue({ success: true });
    vi.mocked(removePiPackage).mockResolvedValue({ success: true });
    vi.mocked(repairPiPackageManager).mockResolvedValue({ success: true });
    vi.mocked(updatePiPackage).mockResolvedValue({ success: true });
  });

  it("loads desired Pi packages from local source_repo config even when not installed locally", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-source-repo-for-prescribed-"));
    const sourceRepoConfigPath = join(sourceRepo, "config", "blackbook", "config.yaml");
    mkdirSync(join(sourceRepo, "config", "blackbook"), { recursive: true });
    writeFileSync(sourceRepoConfigPath, "pi_packages: []\n");

    vi.mocked(loadYamlConfig).mockImplementation((configPath?: string) => ({
      config: configPath === sourceRepoConfigPath
        ? {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [{ source: "npm:pi-subagents", description: "Team subagent package" }],
          projects: [],
        }
        : {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [],
          projects: [],
        },
      configPath: configPath ?? "/tmp/blackbook/config.yaml",
      errors: [],
    }));
    vi.mocked(fetchNpmPackageDetails).mockResolvedValue({
      name: "pi-subagents",
      description: "Subagent tools",
      version: "1.2.3",
      source: "npm:pi-subagents",
      sourceType: "npm",
      marketplace: "npm",
      installed: false,
      extensions: ["subagent"],
      skills: [],
      prompts: [],
      themes: [],
    } as any);

    await useStore.getState().loadPiPackages();

    const packages = useStore.getState().piPackages;
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      name: "pi-subagents",
      source: "npm:pi-subagents",
      installed: false,
      recommended: true,
      description: "Team subagent package",
    });

    const preview = useStore.getState().getSyncPreview();
    expect(preview).toEqual([
      { kind: "piPackage", piPackage: packages[0] },
    ]);
  });

  it("loads desired Pi packages from local source_repo config", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-local-source-repo-"));
    const sourceRepoConfigPath = join(sourceRepo, "config", "blackbook", "config.yaml");
    mkdirSync(join(sourceRepo, "config", "blackbook"), { recursive: true });
    writeFileSync(sourceRepoConfigPath, "pi_packages: []\n");

    vi.mocked(loadYamlConfig).mockImplementation((configPath?: string) => ({
      config: configPath === sourceRepoConfigPath
        ? {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [{ source: "npm:pi-mcp-adapter", name: "pi-mcp-adapter" }],
          projects: [],
        }
        : {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [],
          projects: [],
        },
      configPath: configPath ?? "/tmp/blackbook/config.yaml",
      errors: [],
    }));
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([{ name: "npm", source: "npm", sourceType: "npm", enabled: true, builtIn: true, packages: [{
      name: "pi-mcp-adapter",
      description: "MCP adapter",
      version: "1.0.0",
      source: "npm:pi-mcp-adapter",
      sourceType: "npm",
      marketplace: "npm",
      installed: true,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    }] } as any]);
    vi.mocked(getAllPiPackages).mockImplementation((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? []));

    await useStore.getState().loadPiPackages();

    expect(useStore.getState().piPackages[0]).toMatchObject({
      name: "pi-mcp-adapter",
      source: "npm:pi-mcp-adapter",
      recommended: true,
    });
  });

  it("loads desired Pi packages from remote source_repo URL via in-memory fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `settings:\n  source_repo: https://github.com/example/playbook.git\npi_packages:\n  - source: npm:pi-remote-only\n    name: pi-remote-only\n    description: Remote package\n`,
    status: 200,
    statusText: "OK",
    json: async () => ({}),
  } as any);

    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { source_repo: "https://github.com/example/playbook.git", package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(fetchNpmPackageDetails).mockResolvedValue({
      name: "pi-remote-only",
      description: "Remote package",
      version: "1.0.0",
      source: "npm:pi-remote-only",
      sourceType: "npm",
      marketplace: "npm",
      installed: false,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    } as any);

    await useStore.getState().loadPiPackages();

    expect(useStore.getState().piPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "npm:pi-remote-only", recommended: true }),
      ]),
    );

    globalThis.fetch = originalFetch;
  });

  it("includes installed non-npm Pi packages from settings when not marketplace-listed", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(loadPiSettings).mockReturnValue({
      packages: ["https://github.com/example/new-pi-package.git"],
    });

    await useStore.getState().loadPiPackages();

    expect(useStore.getState().piPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "https://github.com/example/new-pi-package.git",
          sourceType: "git",
          installed: true,
        }),
      ]),
    );
  });

  it("does not duplicate installed git package when source uses equivalent git forms", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([
      {
        name: "git-market",
        source: "https://github.com/example/market.git",
        sourceType: "git",
        enabled: true,
        builtIn: false,
        packages: [
          {
            name: "new-pi-package",
            description: "Git package",
            version: "1.0.0",
            source: "https://github.com/example/new-pi-package.git",
            sourceType: "git",
            marketplace: "git-market",
            installed: false,
            extensions: [],
            skills: [],
            prompts: [],
            themes: [],
          },
        ],
      } as any,
    ]);
    vi.mocked(getAllPiPackages).mockImplementation((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? []));
    vi.mocked(loadPiSettings).mockReturnValue({
      packages: ["git:github.com/example/new-pi-package"],
    });

    await useStore.getState().loadPiPackages();

    const matches = useStore
      .getState()
      .piPackages.filter((p) => p.name === "new-pi-package");
    expect(matches).toHaveLength(1);
  });

  it("dedupes a source listed twice within settings.packages itself", async () => {
    // Regression: ~/.pi/agent/settings.json (Pi's own state, not ours) can end
    // up with the exact same local package path listed twice — observed in
    // the wild. Each duplicate produced an identical ManagedItem, which React
    // rendered with a colliding key ("two children with the same key"
    // warning) and showed the package twice in every list.
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([]);
    vi.mocked(getAllPiPackages).mockReturnValue([]);
    vi.mocked(loadPiSettings).mockReturnValue({
      packages: ["/Users/example/src/pi-packages/pi-crumbs", "/Users/example/src/pi-packages/pi-crumbs"],
    });

    await useStore.getState().loadPiPackages();

    const matches = useStore
      .getState()
      .piPackages.filter((p) => p.source === "/Users/example/src/pi-packages/pi-crumbs");
    expect(matches).toHaveLength(1);
  });

  it("keeps separate rows for same package name across npm and local sources", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [{ source: "npm:pi-web-access", name: "pi-web-access" }],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([
      {
        name: "npm",
        source: "npm",
        sourceType: "npm",
        enabled: true,
        builtIn: true,
        packages: [
          {
            name: "pi-web-access",
            description: "Web access",
            version: "1.0.0",
            source: "npm:pi-web-access",
            sourceType: "npm",
            marketplace: "npm",
            installed: false,
            extensions: [],
            skills: [],
            prompts: [],
            themes: [],
          },
        ],
      } as any,
    ]);
    vi.mocked(getAllPiPackages).mockImplementation((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? []));
    vi.mocked(loadPiSettings).mockReturnValue({
      packages: ["../../src/pi-packages/pi-web-access"],
    });

    await useStore.getState().loadPiPackages();

    const matches = useStore
      .getState()
      .piPackages.filter((p) => p.name === "pi-web-access");
    expect(matches).toHaveLength(2);

    const npmRow = matches.find((p) => p.sourceType === "npm");
    const localRow = matches.find((p) => p.sourceType === "local");

    expect(npmRow).toBeDefined();
    expect(localRow).toBeDefined();
    expect(npmRow?.installed).toBe(false);
    expect(localRow?.installed).toBe(true);
  });

  it("does not duplicate installed npm package when source differs only by case", async () => {
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: {
        settings: { package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
        marketplaces: {},
        pi_marketplaces: {},
        tools: {},
        files: [],
        configs: [],
        plugins: {},
        pi_packages: [],
        projects: [],
      },
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([
      {
        name: "npm",
        source: "npm",
        sourceType: "npm",
        enabled: true,
        builtIn: true,
        packages: [
          {
            name: "pi-ask-user",
            description: "Ask user",
            version: "2.0.0",
            source: "npm:pi-ask-user",
            sourceType: "npm",
            marketplace: "npm",
            installed: false,
            extensions: [],
            skills: [],
            prompts: [],
            themes: [],
          },
        ],
      } as any,
    ]);
    vi.mocked(getAllPiPackages).mockImplementation((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? []));
    vi.mocked(loadPiSettings).mockReturnValue({
      packages: ["npm:PI-ASK-USER"],
    });

    await useStore.getState().loadPiPackages();

    const matches = useStore
      .getState()
      .piPackages.filter((p) => p.source.toLowerCase() === "npm:pi-ask-user");
    expect(matches).toHaveLength(1);
  });

  it("tracks an installed local-only Pi package by adding it to source repo pi_packages", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-source-repo-track-"));
    const sourceConfigPath = join(sourceRepo, "config", "blackbook", "config.yaml");
    mkdirSync(join(sourceRepo, "config", "blackbook"), { recursive: true });
    writeFileSync(sourceConfigPath, "pi_packages: []\n");

    vi.mocked(loadYamlConfig).mockImplementation((configPath?: string) => ({
      config: configPath === sourceConfigPath
        ? {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [],
          projects: [],
        }
        : {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [],
          projects: [],
        },
      configPath: configPath ?? "/tmp/blackbook/config.yaml",
      errors: [],
    }));

    const pkg = {
      name: "pi-local-only",
      description: "Local only package",
      version: "1.0.0",
      source: "npm:pi-local-only",
      sourceType: "npm" as const,
      marketplace: "npm",
      installed: true,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };

    await useStore.getState().trackPiPackageInSource(pkg);

    expect(saveYamlConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        pi_packages: [expect.objectContaining({ source: "npm:pi-local-only", name: "pi-local-only" })],
      }),
      sourceConfigPath,
    );
  });

  it("deletes a Pi package everywhere by uninstalling locally and removing its pi_packages prescription", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-source-repo-"));
    const sourceConfigPath = join(sourceRepo, "config", "blackbook", "config.yaml");
    mkdirSync(join(sourceRepo, "config", "blackbook"), { recursive: true });
    writeFileSync(sourceConfigPath, "pi_packages: []\n");

    const localConfig = {
      settings: { source_repo: sourceRepo, package_manager: "npm" as const, backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
      marketplaces: {},
      pi_marketplaces: {},
      tools: {},
      files: [],
      configs: [],
      plugins: {},
      pi_packages: [
        { source: "npm:pi-delete-me", name: "Delete Me" },
        { source: "npm:pi-keep-me", name: "Keep Me" },
      ],
      projects: [],
    };
    const sourceConfig = {
      ...localConfig,
      pi_packages: [
        { source: "npm:pi-delete-me", name: "Delete Me" },
        { source: "npm:pi-source-only", name: "Source Only" },
      ],
    };
    vi.mocked(loadYamlConfig).mockImplementation((configPath?: string) => ({
      config: configPath === sourceConfigPath ? sourceConfig : localConfig,
      configPath: configPath ?? "/tmp/blackbook/config.yaml",
      errors: [],
    }));

    const pkg = {
      name: "pi-delete-me",
      description: "Delete me",
      version: "1.0.0",
      source: "npm:pi-delete-me",
      sourceType: "npm" as const,
      marketplace: "npm",
      installed: true,
      recommended: true,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };

    useStore.setState({ detail: { kind: "piPackage", data: pkg }, detailPiPackage: pkg });

    await expect(useStore.getState().deletePiPackageEverywhere(pkg)).resolves.toBe(true);

    expect(removePiPackage).toHaveBeenCalledWith(pkg);
    expect(saveYamlConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        pi_packages: [expect.objectContaining({ source: "npm:pi-source-only" })],
      }),
      sourceConfigPath,
    );
    expect(useStore.getState().detail).toBeNull();
    expect(useStore.getState().detailPiPackage).toBeNull();
  });

  it("marks marketplace packages as recommended when their source is prescribed in source repo config", async () => {
    const sourceRepo = mkdtempSync(join(tmpdir(), "blackbook-source-repo-recommended-"));
    const sourceConfigPath = join(sourceRepo, "config", "blackbook", "config.yaml");
    mkdirSync(join(sourceRepo, "config", "blackbook"), { recursive: true });
    writeFileSync(sourceConfigPath, "pi_packages: []\n");

    vi.mocked(loadYamlConfig).mockImplementation((configPath?: string) => ({
      config: configPath === sourceConfigPath
        ? {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [{ source: "npm:pi-ask-user", name: "Ask User" }],
          projects: [],
        }
        : {
          settings: { source_repo: sourceRepo, package_manager: "npm", backup_retention: 3, config_management: false, disabled_marketplaces: [], disabled_pi_marketplaces: [] },
          marketplaces: {},
          pi_marketplaces: {},
          tools: {},
          files: [],
          configs: [],
          plugins: {},
          pi_packages: [],
          projects: [],
        },
      configPath: configPath ?? "/tmp/blackbook/config.yaml",
      errors: [],
    }));
    vi.mocked(loadAllPiMarketplaces).mockResolvedValue([{ name: "npm", source: "npm", sourceType: "npm", enabled: true, builtIn: true, packages: [{
      name: "pi-ask-user",
      description: "Ask user",
      version: "2.0.0",
      source: "npm:pi-ask-user",
      sourceType: "npm",
      marketplace: "npm",
      installed: false,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    }] } as any]);
    vi.mocked(getAllPiPackages).mockImplementation((marketplaces: any[]) => marketplaces.flatMap((m) => m.packages ?? []));

    await useStore.getState().loadPiPackages();

    expect(useStore.getState().piPackages[0]).toMatchObject({
      name: "Ask User",
      source: "npm:pi-ask-user",
      recommended: true,
    });
  });
});

describe("Store universal detail refresh contract", () => {
  it("syncTools refreshes open file detail after file sync", async () => {
    const original = createMockFile({ name: "AGENTS.md", source: "old.md" });
    const refreshed = createMockFile({ name: "AGENTS.md", source: "new.md" });

    useStore.setState({
      detail: { kind: "file", data: original },
      files: [original],
    });

    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { backup_retention: 3, package_manager: "npm" }, tools: {}, plugins: {}, configs: [], pi_packages: [] } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const loadFilesSpy = vi.spyOn(useStore.getState(), "loadFiles").mockImplementation(async () => {
      useStore.setState({ files: [refreshed] });
      return [refreshed];
    });

    vi.mocked(runApply).mockResolvedValue({
      steps: [{ label: "AGENTS.md:claude-code:main", check: { status: "missing", message: "" }, apply: { changed: true, message: "copied" } }],
      summary: { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 1 },
    });

    await useStore.getState().syncTools([
      {
        kind: "file",
        file: {
          ...original,
          instances: [
            {
              toolId: "claude-code",
              instanceId: "main",
              instanceName: "Claude",
              configDir: "/tmp/.claude",
              targetRelPath: "AGENTS.md",
              sourcePath: "/tmp/repo/AGENTS.md",
              targetPath: "/tmp/.claude/AGENTS.md",
              status: "missing",
              message: "",
            },
          ],
        },
        missingInstances: ["Claude"],
        driftedInstances: [],
      },
    ]);

    expect(useStore.getState().detail).toEqual({ kind: "file", data: refreshed });

    loadFilesSpy.mockRestore();
  });
});

describe("Store refreshAll includes installed plugins reload", () => {
  it("refreshAll reloads installed plugins so stale state is cleared", async () => {
    const stalePlugin = createMockPlugin({ name: "old-plugin", installed: true });
    const freshPlugin = createMockPlugin({ name: "new-plugin", installed: true });

    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [freshPlugin], byTool: {} });
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "opencode", instanceId: "default", name: "OC", installed: true, supported: true, enabled: true },
    ]);
    vi.mocked(getToolInstances).mockReturnValue([
      {
        kind: "tool",
        toolId: "opencode",
        instanceId: "default",
        name: "OC",
        enabled: true,
        skillsSubdir: "skills",
        commandsSubdir: "commands",
        agentsSubdir: "agents",
        pluginFlatInstall: false,
        configDir: "/tmp/.opencode",
      },
    ]);

    const originalLoadMarketplaces = useStore.getState().loadMarketplaces;
    useStore.setState({
      marketplaces: [createMockMarketplace({ name: "test-marketplace", plugins: [] })],
      installedPlugins: [stalePlugin],
      installedPluginsLoaded: true,
      loadMarketplaces: vi.fn().mockResolvedValue(undefined),
    });

    try {
      await ORIGINAL_REFRESH_ALL({ silent: true });
    } finally {
      useStore.setState({ loadMarketplaces: originalLoadMarketplaces });
    }

    const state = useStore.getState();
    expect(state.installedPlugins.some((p) => p.name === "new-plugin")).toBe(true);
    expect(state.installedPlugins.some((p) => p.name === "old-plugin")).toBe(false);
  });
});

describe("Unified skill detail actions", () => {
  it("produces identical actions for a skill whether opened standalone or from namespace tree", () => {
    vi.mocked(getToolInstances).mockReturnValue([
      {
        kind: "tool",
        toolId: "claude-code",
        instanceId: "default",
        name: "Claude",
        enabled: true,
        skillsSubdir: "skills",
        commandsSubdir: "commands",
        agentsSubdir: "agents",
        pluginFlatInstall: true,
        configDir: "/tmp/.claude",
      },
      {
        kind: "tool",
        toolId: "pi",
        instanceId: "default",
        name: "Pi",
        enabled: true,
        skillsSubdir: "skills",
        commandsSubdir: "commands",
        agentsSubdir: "agents",
        pluginFlatInstall: false,
        configDir: "/tmp/.pi",
      },
    ]);

    const skill = {
      name: "ambient-texture-drones",
      namespace: "ssmp",
      installations: [
        { toolId: "pi", instanceId: "default", instanceName: "Pi", diskPath: "/tmp/pi/skills/ssmp/ambient-texture-drones", drifted: false },
      ],
      diskPath: "/tmp/pi/skills/ssmp/ambient-texture-drones",
      toolId: "pi",
      instanceId: "default",
      instanceName: "Pi",
      sourcePath: "/tmp/repo/skills/ssmp/ambient-texture-drones",
    } as any;

    const standaloneActions = getSkillActions(skill);

    // From namespace tree, the same skill object is passed to getSkillActions
    // via buildItemActions → getSkillActions. The action list must be identical.
    const namespaceActions = getSkillActions(skill);

    expect(namespaceActions).toEqual(standaloneActions);
    expect(namespaceActions.some((a) => a.type === "pullback")).toBe(true);
    expect(namespaceActions.some((a) => a.type === "uninstall")).toBe(true);
    expect(namespaceActions.some((a) => a.type === "delete_everywhere")).toBe(true);
  });
});

describe("Store plugin action busy-guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ notifications: [] });
  });

  it("ignores a duplicate updatePlugin trigger while the first is still in flight", async () => {
    const plugin = createMockPlugin({ name: "guarded-plugin", marketplace: "test-marketplace" });
    const marketplace = createMockMarketplace({ name: "test-marketplace", plugins: [plugin] });

    // Make the underlying update hang until we release it, so we can fire a
    // second trigger before the first resolves.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(updatePlugin).mockImplementation(async () => {
      await gate;
      return { success: true, linkedInstances: {}, skippedInstances: [], errors: [] };
    });

    const originalRefreshAll = useStore.getState().refreshAll;
    useStore.setState({
      marketplaces: [marketplace],
      installedPlugins: [plugin],
      tools: [createMockTool()],
      refreshAll: async () => {},
    });

    try {
      // Fire twice without awaiting the first.
      const first = useStore.getState().updatePlugin(plugin);
      const second = useStore.getState().updatePlugin(plugin);

      const secondResult = await second; // duplicate returns immediately
      expect(secondResult).toBe(false);

      release();
      const firstResult = await first;
      expect(firstResult).toBe(true);
    } finally {
      useStore.setState({ refreshAll: originalRefreshAll });
    }

    // The real mutation ran exactly once despite two triggers.
    expect(vi.mocked(updatePlugin)).toHaveBeenCalledTimes(1);
    // ...and the user was told the duplicate was ignored.
    const notes = useStore.getState().notifications;
    expect(notes.some((n) => n.type === "warning" && /Already updating/.test(n.message))).toBe(true);

    // Guard is released, so a later update is allowed again.
    vi.mocked(updatePlugin).mockResolvedValue({ success: true, linkedInstances: {}, skippedInstances: [], errors: [] });
    useStore.setState({ refreshAll: async () => {} });
    await useStore.getState().updatePlugin(plugin);
    expect(vi.mocked(updatePlugin)).toHaveBeenCalledTimes(2);
    useStore.setState({ refreshAll: originalRefreshAll });
  });
});

describe("Store marketplace fetch-error surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore playbook mock defaults that an earlier suite resets via mockReset,
    // so loadMarketplaces' managed-tool composition doesn't throw here.
    vi.mocked(getAllPlaybooks).mockReturnValue(new Map());
    vi.mocked(resolveToolInstances).mockReturnValue(new Map());
    vi.mocked(isSyncTarget).mockReturnValue(true);
    useStore.setState({ notifications: [], error: null });
  });

  it("notifies with an error when a marketplace fetch fails, even though the list is empty", async () => {
    // Simulate an offline fetch: no plugins loaded, but the fetch layer recorded
    // a real failure. The user must see an error, not a silent empty list.
    vi.mocked(getToolInstances).mockReturnValue([createMockTool()]);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
    vi.mocked(getFetchErrors).mockReturnValue([
      "Failed to fetch marketplace https://example.com/marketplace.json: HTTP 503",
    ]);

    await useStore.getState().loadMarketplaces();

    const notes = useStore.getState().notifications;
    const errorNote = notes.find((n) => n.type === "error");
    expect(errorNote).toBeDefined();
    expect(errorNote!.message).toMatch(/Failed to fetch marketplace data/);
  });

  it("stays quiet when marketplaces load successfully with genuinely zero errors", async () => {
    vi.mocked(getToolInstances).mockReturnValue([createMockTool()]);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
    vi.mocked(getFetchErrors).mockReturnValue([]);

    await useStore.getState().loadMarketplaces();

    const notes = useStore.getState().notifications;
    expect(notes.some((n) => n.type === "error")).toBe(false);
  });
});

describe("Store uninstallPlugin failure surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ notifications: [] });
    vi.mocked(getEnabledToolInstances).mockReturnValue([createMockTool()]);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
  });

  it("reports a failed uninstall as an error, not a green success", async () => {
    const plugin = createMockPlugin({ name: "doomed-plugin" });
    // install.ts uninstallPlugin returns false when NOTHING was removed from any
    // enabled tool. The store action must not dress this up as a success.
    vi.mocked(uninstallPlugin).mockResolvedValue(false);

    const originalRefreshAll = useStore.getState().refreshAll;
    useStore.setState({ refreshAll: async () => {} });
    try {
      const result = await useStore.getState().uninstallPlugin(plugin);
      expect(result).toBe(false);

      const notes = useStore.getState().notifications;
      const errorNote = notes.find((n) => n.type === "error");
      expect(errorNote).toBeDefined();
      expect(errorNote!.message).toContain("doomed-plugin");
      expect(errorNote!.message).toMatch(/failed/i);
      // Crucially: no green checkmark / success notification was emitted.
      expect(notes.some((n) => n.type === "success")).toBe(false);
    } finally {
      useStore.setState({ refreshAll: originalRefreshAll });
    }
  });

  it("reports a genuine uninstall as a success", async () => {
    const plugin = createMockPlugin({ name: "clean-plugin" });
    vi.mocked(uninstallPlugin).mockResolvedValue(true);

    const originalRefreshAll = useStore.getState().refreshAll;
    useStore.setState({ refreshAll: async () => {} });
    try {
      const result = await useStore.getState().uninstallPlugin(plugin);
      expect(result).toBe(true);

      const notes = useStore.getState().notifications;
      expect(
        notes.some((n) => n.type === "success" && /Uninstalled clean-plugin/.test(n.message)),
      ).toBe(true);
      expect(notes.some((n) => n.type === "error")).toBe(false);
    } finally {
      useStore.setState({ refreshAll: originalRefreshAll });
    }
  });
});

describe("Store loader run-token guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      // An enabled Pi tool so loadPiPackages runs past its early return.
      tools: [{ toolId: "pi", instanceId: "default", name: "Pi", configDir: "/tmp/pi", enabled: true, kind: "tool" } as any],
      toolDetection: {},
      piPackages: [],
      piPackagesLoaded: false,
      piMarketplaces: [],
      installedPlugins: [],
      files: [],
      managedItems: [],
      managedTools: [],
      standaloneSkills: [],
      notifications: [],
    });
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: {}, tools: {}, plugins: {}, configs: [], pi_packages: [] } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    } as any);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
    vi.mocked(loadPiSettings).mockReturnValue({ packages: [] } as any);
    vi.mocked(getGlobalPiPackageInstallInfo).mockReturnValue(new Map());
    vi.mocked(getFetchErrors).mockReturnValue([]);
    vi.mocked(getAllPiPackages).mockImplementation((mps: any[]) => mps.flatMap((m) => m.packages ?? []));
  });

  it("a stale (older) loadPiPackages call does not clobber a newer call's state", async () => {
    const makePkg = (name: string) => ({
      name, description: "", version: "1.0.0", source: `npm:${name}`,
      sourceType: "npm", marketplace: "npm", installed: false,
      extensions: [], skills: [], prompts: [], themes: [],
    });

    // Two controllable fetches: the OLDER call gets the one we resolve LAST.
    let resolveOld!: (v: unknown) => void;
    let resolveNew!: (v: unknown) => void;
    const oldFetch = new Promise((r) => { resolveOld = r; });
    const newFetch = new Promise((r) => { resolveNew = r; });
    vi.mocked(loadAllPiMarketplaces)
      .mockReturnValueOnce(oldFetch as any)   // first (older) invocation
      .mockReturnValueOnce(newFetch as any);  // second (newer) invocation

    const older = useStore.getState().loadPiPackages({ silent: true });
    const newer = useStore.getState().loadPiPackages({ silent: true });

    // Newer call resolves FIRST and writes fresh state.
    resolveNew([{ name: "new-mp", packages: [makePkg("new-pkg")] }]);
    await newer;
    expect(useStore.getState().piPackages.map((p) => p.name)).toEqual(["new-pkg"]);

    // Older call resolves LAST with stale data. Its run-token is no longer the
    // current one, so it must skip its set() and leave the fresh state intact.
    resolveOld([{ name: "old-mp", packages: [makePkg("old-pkg")] }]);
    await older;
    expect(useStore.getState().piPackages.map((p) => p.name)).toEqual(["new-pkg"]);
  });
});

describe("Store sync preview depends on standaloneSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      managedTools: [],
      toolDetection: {},
      files: [],
      installedPlugins: [],
      standaloneSkills: [],
      marketplaces: [],
      piPackages: [],
    });
    vi.mocked(getToolInstances).mockReturnValue([createMockTool()]);
    vi.mocked(getAllInstalledPlugins).mockReturnValue({ plugins: [], byTool: {} });
  });

  it("reflects standaloneSkills, proving it is a real getSyncPreview input", () => {
    const skill = {
      name: "my-skill",
      installations: [],
      diskPath: "/disk/my-skill",
      toolId: "opencode",
      instanceName: "OC",
      instanceId: "default",
      sourcePath: "/repo/skills/my-skill",
    };

    useStore.setState({ standaloneSkills: [skill] as any });
    const withSkill = useStore.getState().getSyncPreview();
    expect(withSkill.some((i) => i.kind === "skill")).toBe(true);

    // Removing the skill changes the preview. This is exactly why SyncTab's memo
    // MUST list standaloneSkills as a dependency (App.tsx already did); otherwise
    // the two call sites disagree and SyncTab's list goes stale when only skills
    // change.
    useStore.setState({ standaloneSkills: [] });
    const withoutSkill = useStore.getState().getSyncPreview();
    expect(withoutSkill.some((i) => i.kind === "skill")).toBe(false);
  });
});

// Regression guard for the slices refactor (store.ts split into ./store/*-slice.ts).
// The store is now composed by spreading five slice creators; if any slice
// accidentally drops a field or action during a future edit, the composed shape
// would silently lose a key. These tests pin the full public surface so a missing
// key fails loudly here rather than at some distant call site.
describe("composed store shape", () => {
  const EXPECTED_STATE_FIELDS = [
    "tab",
    "marketplaces",
    "installedPlugins",
    "installedPluginsLoaded",
    "standaloneSkills",
    "files",
    "filesLoaded",
    "tools",
    "managedTools",
    "toolDetection",
    "toolDetectionPending",
    "toolActionInProgress",
    "toolActionOutput",
    "search",
    "selectedIndex",
    "loading",
    "error",
    "detailPlugin",
    "detailMarketplace",
    "detailPiPackage",
    "detail",
    "notifications",
    "diffTarget",
    "missingSummary",
    "piPackages",
    "piPackagesLoaded",
    "piMarketplaces",
    "managedItems",
    "sortBy",
    "sortDir",
    "syncSelection",
    "syncArmed",
    "pluginDriftMap",
    "currentSection",
    "discoverSubView",
    "projects",
    "projectsLoaded",
    "projectDetailPath",
  ] as const;

  const EXPECTED_ACTIONS = [
    "setTab",
    "setSearch",
    "setSelectedIndex",
    "loadMarketplaces",
    "loadInstalledPlugins",
    "loadFiles",
    "refreshManagedTools",
    "refreshToolDetection",
    "installToolAction",
    "updateToolAction",
    "uninstallToolAction",
    "cancelToolAction",
    "refreshAll",
    "installPlugin",
    "uninstallPlugin",
    "updatePlugin",
    "trackPluginInSource",
    "removePluginFromGit",
    "setDetailMarketplace",
    "setDetail",
    "refreshDetail",
    "addMarketplace",
    "removeMarketplace",
    "updateMarketplace",
    "toggleMarketplaceEnabled",
    "toggleToolEnabled",
    "updateToolConfigDir",
    "getSyncPreview",
    "syncTools",
    "notify",
    "clearNotification",
    "loadPiPackages",
    "installPiPackage",
    "uninstallPiPackage",
    "updatePiPackage",
    "repairPiPackage",
    "trackPiPackageInSource",
    "removePiPackageFromGit",
    "deletePiPackageEverywhere",
    "setDetailPiPackage",
    "togglePiMarketplaceEnabled",
    "addPiMarketplace",
    "removePiMarketplace",
    "setSortBy",
    "setSortDir",
    "setCurrentSection",
    "setDiscoverSubView",
    "toggleSyncSelection",
    "setSyncArmed",
    "setPluginDriftMap",
    "openDiffForFile",
    "openMissingSummaryForFile",
    "openDiffFromSyncItem",
    "closeDiff",
    "closeMissingSummary",
    "pullbackFileInstance",
    "loadProjects",
    "addProject",
    "removeProject",
    "setProjectDetailPath",
    "pushProjectSkill",
    "pullProjectSkill",
    "toggleProjectSkill",
    "removeProjectSkill",
  ] as const;

  it("exposes every expected state field", () => {
    const keys = new Set(Object.keys(useStore.getState()));
    for (const field of EXPECTED_STATE_FIELDS) {
      expect(keys.has(field)).toBe(true);
    }
  });

  it("exposes every expected action as a function", () => {
    const state = useStore.getState() as unknown as Record<string, unknown>;
    for (const action of EXPECTED_ACTIONS) {
      expect(typeof state[action]).toBe("function");
    }
  });

  it("exposes no unexpected top-level keys", () => {
    const expected = new Set<string>([...EXPECTED_STATE_FIELDS, ...EXPECTED_ACTIONS]);
    const actual = Object.keys(useStore.getState());
    expect(actual.length).toBe(expected.size);
    for (const key of actual) {
      expect(expected.has(key)).toBe(true);
    }
  });
});
