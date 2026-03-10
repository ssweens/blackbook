import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plugin, FileStatus, FileInstanceStatus, PiPackage } from "./types.js";
import {
  pluginToManagedItem,
  fileToManagedItem,
  piPackageToManagedItem,
  pluginsToManagedItems,
  filesToManagedItems,
  piPackagesToManagedItems,
  type ManagedItem,
  type ItemInstanceStatus,
} from "./managed-item.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./plugin-status.js", () => ({
  getPluginToolStatus: vi.fn().mockReturnValue([]),
}));

vi.mock("./config.js", () => ({
  getToolInstances: vi.fn().mockReturnValue([]),
}));

import { getPluginToolStatus } from "./plugin-status.js";
import { getToolInstances } from "./config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

function createPlugin(overrides?: Partial<Plugin>): Plugin {
  return {
    name: "test-plugin",
    marketplace: "test-marketplace",
    description: "A test plugin",
    source: "/path/to/source",
    skills: ["skill-a"],
    commands: ["cmd-b"],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: true,
    incomplete: false,
    scope: "user",
    ...overrides,
  };
}

function createFileStatus(overrides?: Partial<FileStatus>): FileStatus {
  return {
    name: "AGENTS.md",
    source: "assets/AGENTS.md",
    target: "AGENTS.md",
    instances: [],
    kind: "file",
    ...overrides,
  };
}

function createFileInstance(overrides?: Partial<FileInstanceStatus>): FileInstanceStatus {
  return {
    toolId: "claude-code",
    instanceId: "claude-main",
    instanceName: "Claude",
    configDir: "/home/user/.claude",
    targetRelPath: "AGENTS.md",
    sourcePath: "/repo/assets/AGENTS.md",
    targetPath: "/home/user/.claude/AGENTS.md",
    status: "ok",
    message: "",
    ...overrides,
  };
}

function createPiPackage(overrides?: Partial<PiPackage>): PiPackage {
  return {
    name: "pi-themes",
    description: "Theme pack for Pi",
    version: "1.0.0",
    source: "npm:@pi/themes",
    sourceType: "npm",
    marketplace: "npm",
    installed: true,
    extensions: [],
    skills: [],
    prompts: [],
    themes: ["dark", "light"],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

describe("pluginToManagedItem", () => {
  beforeEach(() => {
    vi.mocked(getPluginToolStatus).mockReturnValue([]);
    vi.mocked(getToolInstances).mockReturnValue([]);
  });

  it("converts basic plugin fields", () => {
    const plugin = createPlugin();
    const item = pluginToManagedItem(plugin);

    expect(item.name).toBe("test-plugin");
    expect(item.kind).toBe("plugin");
    expect(item.marketplace).toBe("test-marketplace");
    expect(item.description).toBe("A test plugin");
    expect(item.installed).toBe(true);
    expect(item.incomplete).toBe(false);
    expect(item.scope).toBe("user");
    expect(item._plugin).toBe(plugin);
  });

  it("preserves plugin-specific fields", () => {
    const plugin = createPlugin({ hasMcp: true, homepage: "https://example.com" });
    const item = pluginToManagedItem(plugin);

    expect(item.skills).toEqual(["skill-a"]);
    expect(item.commands).toEqual(["cmd-b"]);
    expect(item.hasMcp).toBe(true);
    expect(item.homepage).toBe("https://example.com");
  });

  it("builds instances from tool statuses", () => {
    vi.mocked(getToolInstances).mockReturnValue([
      {
        toolId: "claude-code",
        instanceId: "main",
        name: "Claude",
        configDir: "/home/user/.claude",
        skillsSubdir: "commands",
        commandsSubdir: "commands",
        agentsSubdir: null,
        enabled: true,
        kind: "tool",
      },
    ]);
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "claude-code",
        instanceId: "main",
        name: "Claude",
        installed: true,
        supported: true,
        enabled: true,
      },
    ]);

    const item = pluginToManagedItem(createPlugin());
    expect(item.instances).toHaveLength(1);
    expect(item.instances[0].toolId).toBe("claude-code");
    expect(item.instances[0].instanceName).toBe("Claude");
    expect(item.instances[0].status).toBe("synced");
    expect(item.instances[0].configDir).toBe("/home/user/.claude");
  });

  it("marks not-installed instances", () => {
    vi.mocked(getToolInstances).mockReturnValue([]);
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "opencode",
        instanceId: "oc1",
        name: "OpenCode",
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);

    const item = pluginToManagedItem(createPlugin({ installed: false }));
    expect(item.instances[0].status).toBe("not-installed");
  });

  it("marks not-supported instances", () => {
    vi.mocked(getToolInstances).mockReturnValue([]);
    vi.mocked(getPluginToolStatus).mockReturnValue([
      {
        toolId: "pi",
        instanceId: "pi",
        name: "Pi",
        installed: false,
        supported: false,
        enabled: true,
      },
    ]);

    const item = pluginToManagedItem(createPlugin());
    expect(item.instances[0].status).toBe("not-supported");
  });

  it("filters out disabled tool instances", () => {
    vi.mocked(getPluginToolStatus).mockReturnValue([
      { toolId: "a", instanceId: "a1", name: "A", installed: true, supported: true, enabled: true },
      { toolId: "b", instanceId: "b1", name: "B", installed: false, supported: true, enabled: false },
    ]);

    const item = pluginToManagedItem(createPlugin());
    expect(item.instances).toHaveLength(1);
    expect(item.instances[0].toolId).toBe("a");
  });

  it("accepts pre-computed tool statuses", () => {
    const statuses = [
      { toolId: "x", instanceId: "x1", name: "X", installed: true, supported: true, enabled: true },
    ];
    vi.mocked(getToolInstances).mockReturnValue([]);
    vi.mocked(getPluginToolStatus).mockClear();

    const item = pluginToManagedItem(createPlugin(), statuses);
    expect(item.instances).toHaveLength(1);
    // getPluginToolStatus should NOT have been called since we passed statuses
    expect(getPluginToolStatus).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FileStatus → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

describe("fileToManagedItem", () => {
  it("converts basic file fields", () => {
    const file = createFileStatus();
    const item = fileToManagedItem(file);

    expect(item.name).toBe("AGENTS.md");
    expect(item.kind).toBe("file");
    expect(item.marketplace).toBe("local");
    expect(item.description).toBe("assets/AGENTS.md → AGENTS.md");
    expect(item._file).toBe(file);
  });

  it("maps config kind correctly", () => {
    const file = createFileStatus({ kind: "config" });
    const item = fileToManagedItem(file);
    expect(item.kind).toBe("config");
  });

  it("allows kind override", () => {
    const file = createFileStatus();
    const item = fileToManagedItem(file, "asset");
    expect(item.kind).toBe("asset");
  });

  it("maps ok instances to synced", () => {
    const file = createFileStatus({
      instances: [createFileInstance({ status: "ok" })],
    });
    const item = fileToManagedItem(file);
    expect(item.instances[0].status).toBe("synced");
    expect(item.installed).toBe(true);
  });

  it("maps drifted instances to changed", () => {
    const file = createFileStatus({
      instances: [createFileInstance({ status: "drifted", driftKind: "target-changed" })],
    });
    const item = fileToManagedItem(file);
    expect(item.instances[0].status).toBe("changed");
    expect(item.instances[0].driftKind).toBe("target-changed");
  });

  it("maps missing instances", () => {
    const file = createFileStatus({
      instances: [createFileInstance({ status: "missing" })],
    });
    const item = fileToManagedItem(file);
    expect(item.instances[0].status).toBe("missing");
    expect(item.installed).toBe(false);
    expect(item.incomplete).toBe(false);
  });

  it("detects incomplete (mix of ok + missing)", () => {
    const file = createFileStatus({
      instances: [
        createFileInstance({ status: "ok", instanceId: "a" }),
        createFileInstance({ status: "missing", instanceId: "b" }),
      ],
    });
    const item = fileToManagedItem(file);
    expect(item.installed).toBe(true);
    expect(item.incomplete).toBe(true);
  });

  it("extracts line counts from diff", () => {
    const diff = [
      "--- a/file",
      "+++ b/file",
      "@@ -1,3 +1,4 @@",
      " context",
      "+added line 1",
      "+added line 2",
      "-removed line",
    ].join("\n");
    const file = createFileStatus({
      instances: [createFileInstance({ status: "drifted", diff })],
    });
    const item = fileToManagedItem(file);
    expect(item.instances[0].linesAdded).toBe(2);
    expect(item.instances[0].linesRemoved).toBe(1);
  });

  it("preserves source and target paths", () => {
    const inst = createFileInstance({
      sourcePath: "/repo/src.md",
      targetPath: "/home/.claude/dst.md",
    });
    const file = createFileStatus({ instances: [inst] });
    const item = fileToManagedItem(file);
    expect(item.instances[0].sourcePath).toBe("/repo/src.md");
    expect(item.instances[0].targetPath).toBe("/home/.claude/dst.md");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PiPackage → ManagedItem
// ─────────────────────────────────────────────────────────────────────────────

describe("piPackageToManagedItem", () => {
  it("converts basic package fields", () => {
    const pkg = createPiPackage();
    const item = piPackageToManagedItem(pkg);

    expect(item.name).toBe("pi-themes");
    expect(item.kind).toBe("pi-package");
    expect(item.marketplace).toBe("npm");
    expect(item.description).toBe("Theme pack for Pi");
    expect(item.installed).toBe(true);
    expect(item.version).toBe("1.0.0");
    expect(item.themes).toEqual(["dark", "light"]);
    expect(item._piPackage).toBe(pkg);
  });

  it("creates single Pi instance when installed", () => {
    const item = piPackageToManagedItem(createPiPackage({ installed: true }));
    expect(item.instances).toHaveLength(1);
    expect(item.instances[0].toolId).toBe("pi");
    expect(item.instances[0].status).toBe("synced");
  });

  it("creates not-installed instance when not installed", () => {
    const item = piPackageToManagedItem(createPiPackage({ installed: false }));
    expect(item.instances[0].status).toBe("not-installed");
  });

  it("preserves npm-specific fields", () => {
    const pkg = createPiPackage({
      weeklyDownloads: 5000,
      popularity: 0.8,
      author: "test-author",
      license: "MIT",
    });
    const item = piPackageToManagedItem(pkg);
    expect(item.weeklyDownloads).toBe(5000);
    expect(item.popularity).toBe(0.8);
    expect(item.author).toBe("test-author");
    expect(item.license).toBe("MIT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch Converters
// ─────────────────────────────────────────────────────────────────────────────

describe("batch converters", () => {
  beforeEach(() => {
    vi.mocked(getPluginToolStatus).mockReturnValue([]);
    vi.mocked(getToolInstances).mockReturnValue([]);
  });

  it("pluginsToManagedItems converts array", () => {
    const items = pluginsToManagedItems([createPlugin(), createPlugin({ name: "other" })]);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("test-plugin");
    expect(items[1].name).toBe("other");
  });

  it("filesToManagedItems converts array", () => {
    const items = filesToManagedItems([
      createFileStatus(),
      createFileStatus({ name: "README.md", kind: "config" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("file");
    expect(items[1].kind).toBe("config");
  });

  it("piPackagesToManagedItems converts array", () => {
    const items = piPackagesToManagedItems([
      createPiPackage(),
      createPiPackage({ name: "pi-ext", installed: false }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].installed).toBe(true);
    expect(items[1].installed).toBe(false);
  });

  it("empty arrays return empty", () => {
    expect(pluginsToManagedItems([])).toEqual([]);
    expect(filesToManagedItems([])).toEqual([]);
    expect(piPackagesToManagedItems([])).toEqual([]);
  });
});
