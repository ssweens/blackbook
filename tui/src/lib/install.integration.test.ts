import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  lstatSync,
  realpathSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  enablePlugin,
  disablePlugin,
  getAllInstalledPlugins,
  getInstalledPlugins,
  getInstalledPluginsForTool,
  loadManifest,
  saveManifest,
  isSymlink,
  createSymlink,
  removeSymlink,
  getPluginsCacheDir,
} from "./install.js";
import { getCacheDir, getTools, updateToolConfig, TOOL_IDS } from "./config.js";
import type { Plugin } from "./types.js";

const TEST_PLUGIN_NAME = "blackbook-test-plugin";
const TEST_SKILL_NAME = "blackbook-test-skill";
const TEST_COMMAND_NAME = "blackbook-test-command";
const TEST_AGENT_NAME = "blackbook-test-agent";
const TEST_MARKETPLACE = "blackbook-test-marketplace";
const TEST_ROOT = join(tmpdir(), `blackbook-integration-${Date.now()}`);
const TEST_CONFIG_HOME = join(TEST_ROOT, "config");
const TEST_CACHE_HOME = join(TEST_ROOT, "cache");
const TEST_TOOL_DIR = join(TEST_ROOT, "tools");

function setupTestEnvironment(): void {
  process.env.XDG_CONFIG_HOME = TEST_CONFIG_HOME;
  process.env.XDG_CACHE_HOME = TEST_CACHE_HOME;
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_TOOL_DIR, { recursive: true });

  for (const toolId of TOOL_IDS) {
    const toolDir = join(TEST_TOOL_DIR, toolId);
    mkdirSync(toolDir, { recursive: true });
    updateToolConfig(toolId, { enabled: toolId !== "claude-code", configDir: toolDir });
  }
}

function cleanupTestEnvironment(): void {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

beforeEach(() => {
  setupTestEnvironment();
});

afterEach(() => {
  cleanupTestEnvironment();
});

function createTestPluginInCache(): string {
  const pluginDir = join(getPluginsCacheDir(), TEST_MARKETPLACE, TEST_PLUGIN_NAME);

  mkdirSync(join(pluginDir, "skills", TEST_SKILL_NAME), { recursive: true });
  writeFileSync(
    join(pluginDir, "skills", TEST_SKILL_NAME, "SKILL.md"),
    "# Test Skill\n\nThis is a test skill for integration testing."
  );

  mkdirSync(join(pluginDir, "commands"), { recursive: true });
  writeFileSync(
    join(pluginDir, "commands", `${TEST_COMMAND_NAME}.md`),
    "# Test Command\n\nThis is a test command."
  );

  mkdirSync(join(pluginDir, "agents"), { recursive: true });
  writeFileSync(
    join(pluginDir, "agents", `${TEST_AGENT_NAME}.md`),
    "# Test Agent\n\nThis is a test agent."
  );

  return pluginDir;
}

function cleanupAllTestArtifacts(): void {
  const manifest = loadManifest();
  for (const toolId of Object.keys(manifest.tools)) {
    const toolManifest = manifest.tools[toolId];
    if (toolManifest) {
      for (const key of Object.keys(toolManifest.items)) {
        if (key.includes(TEST_PLUGIN_NAME) || key.includes(TEST_SKILL_NAME) || 
            key.includes(TEST_COMMAND_NAME) || key.includes(TEST_AGENT_NAME)) {
          delete toolManifest.items[key];
        }
      }
    }
  }
  saveManifest(manifest);

  const pluginDir = join(getPluginsCacheDir(), TEST_MARKETPLACE, TEST_PLUGIN_NAME);
  try {
    rmSync(pluginDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const tools = getTools();
  for (const [, tool] of Object.entries(tools)) {
    if (tool.skillsSubdir) {
      const skillPath = join(tool.configDir, tool.skillsSubdir, TEST_SKILL_NAME);
      rmSync(skillPath, { recursive: true, force: true });
      rmSync(`${skillPath}.bak`, { recursive: true, force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${skillPath}.bak.${i}`, { recursive: true, force: true });
      }
    }
    if (tool.commandsSubdir) {
      const cmdPath = join(tool.configDir, tool.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
      rmSync(cmdPath, { force: true });
      rmSync(`${cmdPath}.bak`, { force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${cmdPath}.bak.${i}`, { force: true });
      }
    }
    if (tool.agentsSubdir) {
      const agentPath = join(tool.configDir, tool.agentsSubdir, `${TEST_AGENT_NAME}.md`);
      rmSync(agentPath, { force: true });
      rmSync(`${agentPath}.bak`, { force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${agentPath}.bak.${i}`, { force: true });
      }
    }
  }
}

function createTestPlugin(): Plugin {
  return {
    name: TEST_PLUGIN_NAME,
    marketplace: TEST_MARKETPLACE,
    description: "Test plugin for integration testing",
    source: "",
    skills: [TEST_SKILL_NAME],
    commands: [TEST_COMMAND_NAME],
    agents: [TEST_AGENT_NAME],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: true,
    scope: "user",
  };
}

describe("enablePlugin", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("copies skills to all non-claude tools", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    expect(result.success).toBe(true);

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const tool = getTools()[toolId];
      if (tool.skillsSubdir) {
        const skillPath = join(tool.configDir, tool.skillsSubdir, TEST_SKILL_NAME);
        expect(existsSync(skillPath), `skill should exist for ${toolId}`).toBe(true);
        expect(existsSync(join(skillPath, "SKILL.md"))).toBe(true);

        const content = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
        expect(content).toContain("Test Skill");
      }
    }
  });

  it("skips disabled tools", async () => {
    updateToolConfig("opencode", { enabled: false });
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    expect(result.linkedTools["opencode"]).toBeUndefined();

    const opencode = getTools()["opencode"];
    if (opencode.skillsSubdir) {
      const skillPath = join(opencode.configDir, opencode.skillsSubdir, TEST_SKILL_NAME);
      expect(existsSync(skillPath)).toBe(false);
    }
  });

  it("copies commands to tools with commandsSubdir", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    await enablePlugin(plugin);

    for (const toolId of ["opencode", "amp-code"]) {
      const tool = getTools()[toolId];
      if (tool.commandsSubdir) {
        const cmdPath = join(tool.configDir, tool.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
        expect(existsSync(cmdPath), `command should exist for ${toolId}`).toBe(true);

        const content = readFileSync(cmdPath, "utf-8");
        expect(content).toContain("Test Command");
      }
    }

    const codexTool = getTools()["openai-codex"];
    expect(codexTool.commandsSubdir).toBeNull();
  });

  it("copies agents to tools with agentsSubdir", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    await enablePlugin(plugin);

    for (const toolId of ["opencode", "amp-code"]) {
      const tool = getTools()[toolId];
      if (tool.agentsSubdir) {
        const agentPath = join(tool.configDir, tool.agentsSubdir, `${TEST_AGENT_NAME}.md`);
        expect(existsSync(agentPath), `agent should exist for ${toolId}`).toBe(true);

        const content = readFileSync(agentPath, "utf-8");
        expect(content).toContain("Test Agent");
      }
    }
  });

  it("returns correct linked counts per tool", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    expect(result.linkedTools["opencode"]).toBe(3);
    expect(result.linkedTools["amp-code"]).toBe(3);
    expect(result.linkedTools["openai-codex"]).toBe(1);
  });

  it("records items in manifest with correct metadata", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    await enablePlugin(plugin);

    const manifest = loadManifest();

    expect(manifest.tools["opencode"]).toBeDefined();
    expect(manifest.tools["opencode"].items[`skill:${TEST_SKILL_NAME}`]).toBeDefined();
    expect(manifest.tools["opencode"].items[`command:${TEST_COMMAND_NAME}`]).toBeDefined();
    expect(manifest.tools["opencode"].items[`agent:${TEST_AGENT_NAME}`]).toBeDefined();

    const skillItem = manifest.tools["opencode"].items[`skill:${TEST_SKILL_NAME}`];
    expect(skillItem.kind).toBe("skill");
    expect(skillItem.name).toBe(TEST_SKILL_NAME);
    expect(skillItem.source).toContain(TEST_PLUGIN_NAME);
  });

  it("fails when plugin source not found and no marketplace URL", async () => {
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(`Plugin source not found for ${TEST_PLUGIN_NAME}`);
  });
});

describe("disablePlugin", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("removes skills from all tools", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const tool = getTools()[toolId];
      if (tool.skillsSubdir) {
        const skillPath = join(tool.configDir, tool.skillsSubdir, TEST_SKILL_NAME);
        expect(existsSync(skillPath)).toBe(true);
      }
    }

    const result = await disablePlugin(plugin);

    expect(result.success).toBe(true);

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const tool = getTools()[toolId];
      if (tool.skillsSubdir) {
        const skillPath = join(tool.configDir, tool.skillsSubdir, TEST_SKILL_NAME);
        expect(existsSync(skillPath), `skill should be removed for ${toolId}`).toBe(false);
      }
    }
  });

  it("removes commands from all tools", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const result = await disablePlugin(plugin);

    expect(result.success).toBe(true);

    for (const toolId of ["opencode", "amp-code"]) {
      const tool = getTools()[toolId];
      if (tool.commandsSubdir) {
        const cmdPath = join(tool.configDir, tool.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
        expect(existsSync(cmdPath)).toBe(false);
      }
    }
  });

  it("clears items from manifest", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    await disablePlugin(plugin);

    const manifest = loadManifest();

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const toolManifest = manifest.tools[toolId];
      if (toolManifest) {
        const hasTestItems = Object.values(toolManifest.items).some((item) =>
          item.source.includes(TEST_PLUGIN_NAME)
        );
        expect(hasTestItems, `manifest should not have items for ${toolId}`).toBe(false);
      }
    }
  });

  it("returns correct removal counts", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const result = await disablePlugin(plugin);

    expect(result.linkedTools["opencode"]).toBe(3);
    expect(result.linkedTools["amp-code"]).toBe(3);
    expect(result.linkedTools["openai-codex"]).toBe(1);
  });
});

describe("backup and restore", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("backs up existing skill directory before overwriting", async () => {
    const tool = getTools()["opencode"];
    const skillPath = join(tool.configDir, tool.skillsSubdir!, TEST_SKILL_NAME);
    const backupPath = join(getCacheDir(), "backups", TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(join(backupPath, "SKILL.md"))).toBe(true);

    const backupContent = readFileSync(join(backupPath, "SKILL.md"), "utf-8");
    expect(backupContent).toContain("Original Content");

    const newContent = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    expect(newContent).toContain("Test Skill");
  });

  it("backs up existing command file before overwriting", async () => {
    const tool = getTools()["opencode"];
    const cmdPath = join(tool.configDir, tool.commandsSubdir!, `${TEST_COMMAND_NAME}.md`);
    const backupPath = join(getCacheDir(), "backups", TEST_PLUGIN_NAME, "command", `${TEST_COMMAND_NAME}.md`);

    mkdirSync(join(tool.configDir, tool.commandsSubdir!), { recursive: true });
    writeFileSync(cmdPath, "# Original Command\n\nExisting user command.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    expect(existsSync(backupPath)).toBe(true);

    const backupContent = readFileSync(backupPath, "utf-8");
    expect(backupContent).toContain("Original Command");
  });

  it("restores backup when disabling", async () => {
    const tool = getTools()["opencode"];
    const skillPath = join(tool.configDir, tool.skillsSubdir!, TEST_SKILL_NAME);
    const backupPath = join(getCacheDir(), "backups", TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    const enableResult = await enablePlugin(plugin);

    expect(enableResult.success).toBe(true);
    expect(existsSync(backupPath)).toBe(true);

    const manifest = loadManifest();
    const skillItem = manifest.tools["opencode"]?.items[`skill:${TEST_SKILL_NAME}`];
    expect(skillItem).toBeDefined();
    expect(skillItem?.backup).toBe(backupPath);
    expect(skillItem?.source).toContain(TEST_PLUGIN_NAME);

    const disableResult = await disablePlugin(plugin);
    expect(disableResult.success).toBe(true);
    expect(disableResult.linkedTools["opencode"]).toBeGreaterThan(0);

    const manifestAfterDisable = loadManifest();
    const itemAfterDisable = manifestAfterDisable.tools["opencode"]?.items[`skill:${TEST_SKILL_NAME}`];
    expect(itemAfterDisable).toBeUndefined();

    expect(
      existsSync(skillPath),
      `skillPath ${skillPath} should exist after restore. backupPath ${backupPath} exists: ${existsSync(backupPath)}`
    ).toBe(true);
    expect(existsSync(backupPath)).toBe(false);

    const restoredContent = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    expect(restoredContent).toContain("Original Content");
  });

  it("overwrites previous backup (max one per plugin)", async () => {
    const tool = getTools()["opencode"];
    const skillPath = join(tool.configDir, tool.skillsSubdir!, TEST_SKILL_NAME);
    const backupPath = join(getCacheDir(), "backups", TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# First Version");

    mkdirSync(backupPath, { recursive: true });
    writeFileSync(join(backupPath, "SKILL.md"), "# Pre-existing backup");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    expect(existsSync(backupPath)).toBe(true);

    const backupContent = readFileSync(join(backupPath, "SKILL.md"), "utf-8");
    expect(backupContent).toContain("First Version");
  });
});

describe("getInstalledPlugins", () => {
  it("returns plugins from Claude cache (if any exist)", () => {
    const plugins = getInstalledPlugins();
    expect(Array.isArray(plugins)).toBe(true);
  });
});

describe("getInstalledPluginsForTool", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("finds skills installed to specific tool", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const plugins = getInstalledPluginsForTool("opencode");

    const testPlugin = plugins.find((p) => p.name === TEST_SKILL_NAME);
    expect(testPlugin).toBeDefined();
    expect(testPlugin!.skills).toContain(TEST_SKILL_NAME);
  });

  it("returns empty array for unknown tool", () => {
    const plugins = getInstalledPluginsForTool("nonexistent-tool");
    expect(plugins).toEqual([]);
  });
});

describe("getAllInstalledPlugins", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("aggregates plugins from all tools", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const { byTool } = getAllInstalledPlugins();

    expect(byTool["claude-code"]).toBeDefined();
    expect(byTool["opencode"]).toBeDefined();
    expect(byTool["amp-code"]).toBeDefined();
    expect(byTool["openai-codex"]).toBeDefined();

    const opencodePlugins = byTool["opencode"];
    expect(opencodePlugins.some((p) => p.skills.includes(TEST_SKILL_NAME))).toBe(true);
  });

  it("deduplicates plugins across tools", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const { plugins } = getAllInstalledPlugins();

    const testPluginOccurrences = plugins.filter(
      (p) => p.name === TEST_PLUGIN_NAME || p.name === TEST_SKILL_NAME
    );
    expect(testPluginOccurrences.length).toBeLessThanOrEqual(2);
  });
});

describe("createSymlink and removeSymlink", () => {
  const TMP_DIR = join(tmpdir(), `blackbook-symlink-test-${Date.now()}`);
  const SOURCE_FILE = join(TMP_DIR, "source.txt");
  const TARGET_FILE = join(TMP_DIR, "target.txt");

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(SOURCE_FILE, "source content");
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("creates symlink pointing to source", () => {
    const result = createSymlink(SOURCE_FILE, TARGET_FILE);

    expect(result).toBe(true);
    expect(isSymlink(TARGET_FILE)).toBe(true);
    expect(realpathSync(TARGET_FILE)).toBe(realpathSync(SOURCE_FILE));
  });

  it("returns false when source does not exist", () => {
    const result = createSymlink(join(TMP_DIR, "nonexistent"), TARGET_FILE);
    expect(result).toBe(false);
  });

  it("backs up existing file when creating symlink", () => {
    writeFileSync(TARGET_FILE, "existing content");

    const result = createSymlink(SOURCE_FILE, TARGET_FILE);

    expect(result).toBe(true);
    expect(existsSync(`${TARGET_FILE}.bak`)).toBe(true);
    expect(readFileSync(`${TARGET_FILE}.bak`, "utf-8")).toBe("existing content");
  });

  it("returns true without changes when symlink already correct", () => {
    createSymlink(SOURCE_FILE, TARGET_FILE);

    const result = createSymlink(SOURCE_FILE, TARGET_FILE);

    expect(result).toBe(true);
    expect(existsSync(`${TARGET_FILE}.bak`)).toBe(false);
  });

  it("removeSymlink removes existing symlink", () => {
    createSymlink(SOURCE_FILE, TARGET_FILE);
    expect(isSymlink(TARGET_FILE)).toBe(true);

    const result = removeSymlink(TARGET_FILE);

    expect(result).toBe(true);
    expect(existsSync(TARGET_FILE)).toBe(false);
  });

  it("removeSymlink returns false for non-symlink", () => {
    writeFileSync(TARGET_FILE, "regular file");

    const result = removeSymlink(TARGET_FILE);

    expect(result).toBe(false);
    expect(existsSync(TARGET_FILE)).toBe(true);
  });
});

describe("manifest operations", () => {
  const TMP_CACHE = join(tmpdir(), `blackbook-manifest-test-${Date.now()}`);

  afterEach(() => {
    try {
      rmSync(TMP_CACHE, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("loadManifest returns empty manifest when file does not exist", () => {
    const manifest = loadManifest(TMP_CACHE);
    expect(manifest).toEqual({ tools: {} });
  });

  it("saveManifest creates directory and writes JSON", () => {
    const manifest = {
      tools: {
        opencode: {
          items: {
            "skill:test": {
              kind: "skill" as const,
              name: "test",
              source: "/source",
              dest: "/dest",
              backup: null,
            },
          },
        },
      },
    };

    saveManifest(manifest, TMP_CACHE);

    const loaded = loadManifest(TMP_CACHE);
    expect(loaded).toEqual(manifest);
  });

  it("loadManifest handles corrupted JSON gracefully", () => {
    mkdirSync(TMP_CACHE, { recursive: true });
    writeFileSync(join(TMP_CACHE, "installed_items.json"), "{ invalid json }");

    const manifest = loadManifest(TMP_CACHE);
    expect(manifest).toEqual({ tools: {} });
  });
});
