import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  lstatSync,
  realpathSync,
  chmodSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  getAllInstalledPlugins,
  getInstalledPluginsForInstance,
  loadManifest,
  saveManifest,
  isSymlink,
  createSymlink,
  removeSymlink,
  getPluginsCacheDir,
  getPluginToolStatus,
} from "./install.js";
import { getCacheDir, getToolInstances, updateToolInstanceConfig, TOOL_IDS } from "./config.js";
import type { Plugin, ToolInstance } from "./types.js";

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
    updateToolInstanceConfig(toolId, "default", {
      enabled: toolId !== "claude-code",
      configDir: toolDir,
    });
  }
}

function cleanupTestEnvironment(): void {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

beforeEach(() => {
  setupTestEnvironment();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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

function createPluginInCache(
  pluginName: string,
  skillName: string,
  commandName?: string,
  skillContent = "Plugin Skill"
): string {
  const pluginDir = join(getPluginsCacheDir(), TEST_MARKETPLACE, pluginName);

  mkdirSync(join(pluginDir, "skills", skillName), { recursive: true });
  writeFileSync(
    join(pluginDir, "skills", skillName, "SKILL.md"),
    `# ${skillName}\n\n${skillContent}`
  );

  if (commandName) {
    mkdirSync(join(pluginDir, "commands"), { recursive: true });
    writeFileSync(
      join(pluginDir, "commands", `${commandName}.md`),
      `# ${commandName}\n\nCommand content`
    );
  }

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

  const instances = getToolInstances();
  for (const instance of instances) {
    if (instance.skillsSubdir) {
      const skillPath = join(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME);
      rmSync(skillPath, { recursive: true, force: true });
      rmSync(`${skillPath}.bak`, { recursive: true, force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${skillPath}.bak.${i}`, { recursive: true, force: true });
      }
    }
    if (instance.commandsSubdir) {
      const cmdPath = join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
      rmSync(cmdPath, { force: true });
      rmSync(`${cmdPath}.bak`, { force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${cmdPath}.bak.${i}`, { force: true });
      }
    }
    if (instance.agentsSubdir) {
      const agentPath = join(instance.configDir, instance.agentsSubdir, `${TEST_AGENT_NAME}.md`);
      rmSync(agentPath, { force: true });
      rmSync(`${agentPath}.bak`, { force: true });
      for (let i = 1; i <= 30; i++) {
        rmSync(`${agentPath}.bak.${i}`, { force: true });
      }
    }
  }

  const backupsDir = join(getCacheDir(), "backups");
  rmSync(join(backupsDir, "skill", TEST_SKILL_NAME), { recursive: true, force: true });
  rmSync(join(backupsDir, "command", TEST_COMMAND_NAME), { recursive: true, force: true });
  rmSync(join(backupsDir, "agent", TEST_AGENT_NAME), { recursive: true, force: true });
}

function getInstance(toolId: string): ToolInstance {
  const instance = getToolInstances().find((item) => item.toolId === toolId);
  if (!instance) {
    throw new Error(`Missing tool instance for ${toolId}`);
  }
  return instance;
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

function createPluginWithName(
  pluginName: string,
  skillName: string,
  commandName?: string
): Plugin {
  return {
    name: pluginName,
    marketplace: TEST_MARKETPLACE,
    description: "Custom test plugin",
    source: "",
    skills: [skillName],
    commands: commandName ? [commandName] : [],
    agents: [],
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
      const instance = getInstance(toolId);
      if (instance.skillsSubdir) {
        const skillPath = join(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME);
        expect(existsSync(skillPath), `skill should exist for ${toolId}`).toBe(true);
        expect(existsSync(join(skillPath, "SKILL.md"))).toBe(true);

        const content = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
        expect(content).toContain("Test Skill");
      }
    }
  });

  it("skips disabled tools", async () => {
    updateToolInstanceConfig("opencode", "default", { enabled: false });
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    expect(result.linkedInstances[opencodeKey]).toBeUndefined();

    const opencode = getInstance("opencode");
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
      const instance = getInstance(toolId);
      if (instance.commandsSubdir) {
        const cmdPath = join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
        expect(existsSync(cmdPath), `command should exist for ${toolId}`).toBe(true);

        const content = readFileSync(cmdPath, "utf-8");
        expect(content).toContain("Test Command");
      }
    }

    const codexTool = getInstance("openai-codex");
    expect(codexTool.commandsSubdir).toBeNull();
  });

  it("copies agents to tools with agentsSubdir", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    await enablePlugin(plugin);

    for (const toolId of ["opencode", "amp-code"]) {
      const instance = getInstance(toolId);
      if (instance.agentsSubdir) {
        const agentPath = join(instance.configDir, instance.agentsSubdir, `${TEST_AGENT_NAME}.md`);
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

    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    const ampKey = `${getInstance("amp-code").toolId}:${getInstance("amp-code").instanceId}`;
    const codexKey = `${getInstance("openai-codex").toolId}:${getInstance("openai-codex").instanceId}`;
    expect(result.linkedInstances[opencodeKey]).toBe(3);
    expect(result.linkedInstances[ampKey]).toBe(3);
    expect(result.linkedInstances[codexKey]).toBe(1);
  });

  it("records items in manifest with correct metadata", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();

    await enablePlugin(plugin);

    const manifest = loadManifest();

    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    expect(manifest.tools[opencodeKey]).toBeDefined();
    expect(manifest.tools[opencodeKey].items[`skill:${TEST_SKILL_NAME}`]).toBeDefined();
    expect(manifest.tools[opencodeKey].items[`command:${TEST_COMMAND_NAME}`]).toBeDefined();
    expect(manifest.tools[opencodeKey].items[`agent:${TEST_AGENT_NAME}`]).toBeDefined();

    const skillItem = manifest.tools[opencodeKey].items[`skill:${TEST_SKILL_NAME}`];
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

describe("backup and rollback behavior", () => {
  it("restores the latest backup on uninstall with a single backup per item", async () => {
    const skillName = "shared-skill";
    const pluginAName = "backup-plugin-a";
    const pluginBName = "backup-plugin-b";

    createPluginInCache(pluginAName, skillName, undefined, "Plugin A");
    createPluginInCache(pluginBName, skillName, undefined, "Plugin B");

    const instance = getInstance("opencode");
    const skillPath = join(instance.configDir, instance.skillsSubdir!, skillName);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "original");

    const pluginA = createPluginWithName(pluginAName, skillName);
    const pluginB = createPluginWithName(pluginBName, skillName);

    const resultA = await enablePlugin(pluginA);
    expect(resultA.success).toBe(true);
    expect(readFileSync(join(skillPath, "SKILL.md"), "utf-8")).toContain("Plugin A");

    const backupPath = join(getCacheDir(), "backups", "skill", skillName);
    expect(existsSync(backupPath)).toBe(true);

    const resultB = await enablePlugin(pluginB);
    expect(resultB.success).toBe(true);
    expect(readFileSync(join(skillPath, "SKILL.md"), "utf-8")).toContain("Plugin B");

    expect(existsSync(backupPath)).toBe(true);

    await uninstallPlugin(pluginB);
    expect(readFileSync(join(skillPath, "SKILL.md"), "utf-8")).toContain("Plugin A");
  });

  it("rolls back partial installs when a later step fails", async () => {
    const skillName = "rollback-skill";
    const commandName = "rollback-command";
    const pluginName = "rollback-plugin";

    const pluginDir = createPluginInCache(pluginName, skillName, commandName, "Rollback Skill");
    const commandsDir = join(pluginDir, "commands");
    chmodSync(commandsDir, 0o000);

    const instance = getInstance("opencode");
    const skillPath = join(instance.configDir, instance.skillsSubdir!, skillName);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "original");

    const plugin = createPluginWithName(pluginName, skillName, commandName);

    try {
      const result = await enablePlugin(plugin);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(readFileSync(join(skillPath, "SKILL.md"), "utf-8")).toBe("original");

      const manifest = loadManifest();
      const key = `${instance.toolId}:${instance.instanceId}`;
      const toolManifest = manifest.tools[key];
      if (toolManifest) {
        expect(toolManifest.items[`skill:${skillName}`]).toBeUndefined();
      }
    } finally {
      chmodSync(commandsDir, 0o755);
    }
  });
});

describe("plugin completeness across instances", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("marks missing when any enabled instance lacks installs", () => {
    const primary = getInstance("opencode");
    const secondaryDir = join(TEST_TOOL_DIR, "opencode-secondary");
    mkdirSync(secondaryDir, { recursive: true });
    updateToolInstanceConfig("opencode", "secondary", {
      enabled: true,
      configDir: secondaryDir,
      name: "OpenCode Secondary",
    });

    const plugin = createTestPlugin();
    if (primary.skillsSubdir) {
      const skillPath = join(primary.configDir, primary.skillsSubdir, TEST_SKILL_NAME);
      mkdirSync(skillPath, { recursive: true });
      writeFileSync(join(skillPath, "SKILL.md"), "# Test Skill");
    }

    const statuses = getPluginToolStatus(plugin);
    const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
    const installedCount = supportedEnabled.filter((status) => status.installed).length;
    expect(installedCount).toBeLessThan(supportedEnabled.length);
  });

  it("does not mark missing when only disabled instances lack installs", () => {
    const primary = getInstance("opencode");
    updateToolInstanceConfig("amp-code", "default", { enabled: false });
    updateToolInstanceConfig("openai-codex", "default", { enabled: false });
    const secondaryDir = join(TEST_TOOL_DIR, "opencode-secondary-disabled");
    mkdirSync(secondaryDir, { recursive: true });
    updateToolInstanceConfig("opencode", "secondary-disabled", {
      enabled: false,
      configDir: secondaryDir,
      name: "OpenCode Secondary Disabled",
    });

    const plugin = createTestPlugin();
    if (primary.skillsSubdir) {
      const skillPath = join(primary.configDir, primary.skillsSubdir, TEST_SKILL_NAME);
      mkdirSync(skillPath, { recursive: true });
      writeFileSync(join(skillPath, "SKILL.md"), "# Test Skill");
    }

    const statuses = getPluginToolStatus(plugin);
    const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
    const installedCount = supportedEnabled.filter((status) => status.installed).length;
    expect(installedCount).toBe(supportedEnabled.length);
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
      const instance = getInstance(toolId);
      if (instance.skillsSubdir) {
        const skillPath = join(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME);
        expect(existsSync(skillPath)).toBe(true);
      }
    }

    const result = await disablePlugin(plugin);

    expect(result.success).toBe(true);

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const instance = getInstance(toolId);
      if (instance.skillsSubdir) {
        const skillPath = join(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME);
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
      const instance = getInstance(toolId);
      if (instance.commandsSubdir) {
        const cmdPath = join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
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
      const instance = getInstance(toolId);
      const toolManifest = manifest.tools[`${instance.toolId}:${instance.instanceId}`];
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

    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    const ampKey = `${getInstance("amp-code").toolId}:${getInstance("amp-code").instanceId}`;
    const codexKey = `${getInstance("openai-codex").toolId}:${getInstance("openai-codex").instanceId}`;
    expect(result.linkedInstances[opencodeKey]).toBe(3);
    expect(result.linkedInstances[ampKey]).toBe(3);
    expect(result.linkedInstances[codexKey]).toBe(1);
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
    const instance = getInstance("opencode");
    const skillPath = join(instance.configDir, instance.skillsSubdir!, TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const skillItem = manifest.tools[opencodeKey]?.items[`skill:${TEST_SKILL_NAME}`];
    expect(skillItem?.backup).toBeTruthy();
    const backupPath = skillItem?.backup ?? "";
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(join(backupPath, "SKILL.md"))).toBe(true);

    const backupContent = readFileSync(join(backupPath, "SKILL.md"), "utf-8");
    expect(backupContent).toContain("Original Content");

    const newContent = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    expect(newContent).toContain("Test Skill");
  });

  it("backs up existing command file before overwriting", async () => {
    const instance = getInstance("opencode");
    const cmdPath = join(instance.configDir, instance.commandsSubdir!, `${TEST_COMMAND_NAME}.md`);

    mkdirSync(join(instance.configDir, instance.commandsSubdir!), { recursive: true });
    writeFileSync(cmdPath, "# Original Command\n\nExisting user command.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const commandItem = manifest.tools[opencodeKey]?.items[`command:${TEST_COMMAND_NAME}`];
    expect(commandItem?.backup).toBeTruthy();
    const backupPath = commandItem?.backup ?? "";
    expect(existsSync(backupPath)).toBe(true);

    const backupContent = readFileSync(backupPath, "utf-8");
    expect(backupContent).toContain("Original Command");
  });

  it("restores backup when disabling", async () => {
    const instance = getInstance("opencode");
    const skillPath = join(instance.configDir, instance.skillsSubdir!, TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    const enableResult = await enablePlugin(plugin);

    expect(enableResult.success).toBe(true);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const skillItem = manifest.tools[opencodeKey]?.items[`skill:${TEST_SKILL_NAME}`];
    expect(skillItem).toBeDefined();
    expect(skillItem?.backup).toBeTruthy();
    const backupPath = skillItem?.backup ?? "";
    expect(existsSync(backupPath)).toBe(true);
    expect(skillItem?.source).toContain(TEST_PLUGIN_NAME);

    const disableResult = await disablePlugin(plugin);
    expect(disableResult.success).toBe(true);
    expect(disableResult.linkedInstances[opencodeKey]).toBeGreaterThan(0);

    const manifestAfterDisable = loadManifest();
    const itemAfterDisable = manifestAfterDisable.tools[opencodeKey]?.items[`skill:${TEST_SKILL_NAME}`];
    expect(itemAfterDisable).toBeUndefined();

    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(backupPath)).toBe(false);

    const restoredContent = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    expect(restoredContent).toContain("Original Content");
  });

  it("overwrites existing backup (single backup per item)", async () => {
    const instance = getInstance("opencode");
    const skillPath = join(instance.configDir, instance.skillsSubdir!, TEST_SKILL_NAME);
    const backupPath = join(getCacheDir(), "backups", "skill", TEST_SKILL_NAME);

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
    const plugins = getInstalledPluginsForInstance(getInstance("claude-code"));
    expect(Array.isArray(plugins)).toBe(true);
  });
});

describe("getInstalledPluginsForInstance", () => {
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

    const plugins = getInstalledPluginsForInstance(getInstance("opencode"));

    // Plugin is grouped by its actual name from the cache path, not the skill name
    const testPlugin = plugins.find((p) => p.name === TEST_PLUGIN_NAME);
    expect(testPlugin).toBeDefined();
    expect(testPlugin!.skills).toContain(TEST_SKILL_NAME);
    expect(testPlugin!.marketplace).toBe(TEST_MARKETPLACE);
  });

  it("returns empty array for unknown tool", () => {
    const plugins = getInstalledPluginsForInstance({
      toolId: "nonexistent-tool",
      instanceId: "default",
      name: "Nonexistent",
      configDir: "/tmp/nonexistent-tool",
      skillsSubdir: null,
      commandsSubdir: null,
      agentsSubdir: null,
      enabled: true,
    });
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

    const claudeKey = `${getInstance("claude-code").toolId}:${getInstance("claude-code").instanceId}`;
    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    const ampKey = `${getInstance("amp-code").toolId}:${getInstance("amp-code").instanceId}`;
    const codexKey = `${getInstance("openai-codex").toolId}:${getInstance("openai-codex").instanceId}`;

    expect(byTool[claudeKey]).toBeDefined();
    expect(byTool[opencodeKey]).toBeDefined();
    expect(byTool[ampKey]).toBeDefined();
    expect(byTool[codexKey]).toBeDefined();

    const opencodePlugins = byTool[opencodeKey];
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

    expect(result.success).toBe(true);
    expect(isSymlink(TARGET_FILE)).toBe(true);
    expect(realpathSync(TARGET_FILE)).toBe(realpathSync(SOURCE_FILE));
  });

  it("returns false when source does not exist", () => {
    const result = createSymlink(join(TMP_DIR, "nonexistent"), TARGET_FILE);
    expect(result.success).toBe(false);
  });

  it("backs up existing file when creating symlink", () => {
    writeFileSync(TARGET_FILE, "existing content");

    const result = createSymlink(SOURCE_FILE, TARGET_FILE);

    expect(result.success).toBe(true);
    expect(existsSync(`${TARGET_FILE}.bak`)).toBe(true);
    expect(readFileSync(`${TARGET_FILE}.bak`, "utf-8")).toBe("existing content");
  });

  it("returns true without changes when symlink already correct", () => {
    createSymlink(SOURCE_FILE, TARGET_FILE);

    const result = createSymlink(SOURCE_FILE, TARGET_FILE);

    expect(result.success).toBe(true);
    expect(existsSync(`${TARGET_FILE}.bak`)).toBe(false);
  });

  it("removeSymlink removes existing symlink", () => {
    createSymlink(SOURCE_FILE, TARGET_FILE);
    expect(isSymlink(TARGET_FILE)).toBe(true);

    const result = removeSymlink(TARGET_FILE);

    expect(result.success).toBe(true);
    expect(existsSync(TARGET_FILE)).toBe(false);
  });

  it("removeSymlink returns false for non-symlink", () => {
    writeFileSync(TARGET_FILE, "regular file");

    const result = removeSymlink(TARGET_FILE);

    expect(result.success).toBe(false);
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
        "opencode:default": {
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

    expect(() => loadManifest(TMP_CACHE)).toThrow(/Manifest file is corrupted/);
  });
});
