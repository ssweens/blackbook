import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useStore } from "./store.js";
import { getToolInstances, updateToolInstanceConfig, getEnabledToolInstances } from "./config.js";
import {
  getAllInstalledPlugins,
  getPluginToolStatus,
  syncPluginInstances,
} from "./install.js";
import { getConfigPath as getYamlConfigPath, loadConfig as loadYamlConfig } from "./config/loader.js";
import { resolveSourcePath, expandPath as expandConfigPath } from "./config/path.js";
import { getAllPlaybooks, resolveToolInstances, isSyncTarget } from "./config/playbooks.js";
import { runCheck, runApply } from "./modules/orchestrator.js";
import type { Plugin, Marketplace, ToolInstance, ManagedToolRow, ToolDetectionResult } from "./types.js";

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
  };
});

vi.mock("./marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./marketplace.js")>();
  return {
    ...actual,
    fetchMarketplace: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("./config/loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config/loader.js")>();
  return {
    ...actual,
    getConfigPath: vi.fn().mockReturnValue("/tmp/blackbook/config.toml"),
    loadConfig: vi.fn().mockReturnValue({ config: { files: [], settings: {}, tools: {}, plugins: {} }, configPath: "/tmp/blackbook/config.yaml", errors: [] }),
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

    expect(updateToolInstanceConfig).toHaveBeenCalledWith(
      tool.toolId,
      tool.instanceId,
      expect.objectContaining({ enabled: false })
    );
    expect(refreshAll).toHaveBeenCalled();
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
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.toml");

    const files = await useStore.getState().loadFiles();

    expect(files).toEqual([]);
    expect(useStore.getState().files).toEqual([]);
    expect(loadYamlConfig).not.toHaveBeenCalled();
  });

  it("returns empty when YAML config has errors", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {} } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [{ source: "yaml", message: "parse error" }],
    });

    const files = await useStore.getState().loadFiles();

    expect(files).toEqual([]);
  });

  it("returns empty when config has no files and playbooks have no config_files", async () => {
    vi.mocked(getYamlConfigPath).mockReturnValue("/tmp/blackbook/config.yaml");
    vi.mocked(loadYamlConfig).mockReturnValue({
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {} } as any,
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
          { name: "CLAUDE.md", source: "CLAUDE.md", target: "CLAUDE.md", pullback: false },
        ],
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm" },
        tools: {},
        plugins: {},
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
          { name: "settings.json", source: "settings.json", target: "settings.json", pullback: false },
        ],
        settings: { package_manager: "pnpm" },
        tools: {},
        plugins: {},
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
            { name: "read", source: "read", target: "read", pullback: false },
          ],
          settings: { package_manager: "pnpm" },
          tools: {},
          plugins: {},
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
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm" },
        tools: {},
        plugins: {},
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const playbooks = new Map([
      ["pi", {
        syncable: true,
        config_files: [
          { name: "Pi Config", path: "settings.json", format: "json", pullback: true },
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
    expect(files[0].pullback).toBe(true);
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
          { name: "AGENTS.md", source: "AGENTS.md", target: "AGENTS.md", pullback: false, overrides: { "claude-code:default": "CLAUDE.md" } },
        ],
        settings: { source_repo: "~/dotfiles", package_manager: "pnpm" },
        tools: {},
        plugins: {},
      } as any,
      configPath: "/tmp/blackbook/config.yaml",
      errors: [],
    });

    const playbooks = new Map([
      ["claude-code", {
        syncable: true,
        config_files: [
          { name: "CLAUDE.md", path: "CLAUDE.md", format: "markdown", pullback: true },
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
          pullback: false,
          instances: [{ toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/tmp", targetRelPath: "ok.md", sourcePath: "/src/ok.md", targetPath: "/tmp/ok.md", status: "ok", message: "File matches" }],
        },
        {
          name: "missing-file",
          source: "missing.md",
          target: "missing.md",
          pullback: false,
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
      config: { files: [], settings: { source_repo: "~/dotfiles", package_manager: "pnpm" }, tools: {}, plugins: {} } as any,
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
          pullback: false,
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

  it("uses directory-sync module when syncing directory entries", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "blackbook-sync-src-"));
    const sourceDir = join(sourceRoot, "read");
    mkdirSync(sourceDir, { recursive: true });

    try {
      vi.mocked(loadYamlConfig).mockReturnValue({
        config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {} } as any,
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
            pullback: false,
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
      config: { files: [], settings: { package_manager: "pnpm" }, tools: {}, plugins: {} } as any,
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
          pullback: false,
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
