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
  symlinkSync,
} from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { tmpdir } from "os";
import {
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  updatePlugin,
  getAllInstalledPlugins,
  getInstalledPluginsForInstance,
  loadManifest,
  saveManifest,
  isSymlink,
  createSymlink,
  removeSymlink,
  getPluginsCacheDir,
  getPluginToolStatus,
  syncPluginInstances,
  getStandaloneSkills,
  installSkillToInstance,
  pullbackSkillToSource,
  migrateLegacyStandaloneSkillLayout,
  buildManifestItemKey,
  buildBackupPath,
  migrateManifestKeys,
  uninstallPluginFromInstance,
  deleteFileEverywhere,
  reconcileStaleInstallArtifacts,
  uninstallSkillFromInstance,
  downloadPlugin,
} from "./install.js";
import { skillsShResultToPlugin } from "./skillssh.js";
import { uninstallPluginItemsFromInstance } from "./adapters/managed.js";
import * as manifestModule from "./manifest.js";
import { flattenNamespacedName, resolveInstanceSubdirPath } from "./path-utils.js";
import { listBackups } from "./modules/backup.js";
import { togglePluginComponent } from "./plugin-status.js";
import type { FileStatus } from "./types.js";
import { invalidatePluginToolStatusCache } from "./plugin-status.js";
import { getCacheDir, getToolInstances, updateToolInstanceConfig, TOOL_IDS } from "./config.js";
import { getConfigPath as getYamlConfigPath, loadConfig as loadYamlConfig } from "./config/loader.js";
import { saveConfig as saveYamlConfig } from "./config/writer.js";
import type { Plugin, ToolInstance } from "./types.js";

// Simulate a cross-filesystem (EXDEV) boundary for renames that move between two
// different directory trees (e.g. a tool's config dir and the cache dir). The
// mock passes through to the real renameSync unless `exdevState.active` is set,
// in which case any rename whose src/dest live in different directories fails
// with EXDEV — exactly the condition renameOrCopy must tolerate. Off by default
// so every other test exercises the real filesystem.
const exdevState = vi.hoisted(() => ({ active: false }));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const { dirname } = await import("path");
  return {
    ...actual,
    renameSync: (src: string, dest: string) => {
      if (exdevState.active && dirname(src) !== dirname(dest)) {
        const err = new Error("EXDEV: cross-device link not permitted") as NodeJS.ErrnoException;
        err.code = "EXDEV";
        throw err;
      }
      return actual.renameSync(src, dest);
    },
  };
});

const TEST_PLUGIN_NAME = "blackbook-test-plugin";
const TEST_SKILL_NAME = "blackbook-test-skill";
const TEST_COMMAND_NAME = "blackbook-test-command";
const TEST_AGENT_NAME = "blackbook-test-agent";
const TEST_MARKETPLACE = "blackbook-test-marketplace";
const TEST_ROOT = join(tmpdir(), `blackbook-integration-${Date.now()}`);
const TEST_CONFIG_HOME = join(TEST_ROOT, "config");
const TEST_CACHE_HOME = join(TEST_ROOT, "cache");
const TEST_TOOL_DIR = join(TEST_ROOT, "tools");
// Some playbooks (Codex/OpenCode/Amp/Pi's `skills` component) point at an
// absolute `~/.agents/skills` override rather than a path relative to the
// tool's own configDir. That override expands via the real os.homedir(),
// so HOME must be sandboxed here too — otherwise these tests write into the
// developer's actual ~/.agents/skills instead of the test fixture.
const TEST_HOME = join(TEST_ROOT, "home");
const ORIGINAL_HOME = process.env.HOME;

function setupTestEnvironment(): void {
  process.env.XDG_CONFIG_HOME = TEST_CONFIG_HOME;
  process.env.XDG_CACHE_HOME = TEST_CACHE_HOME;
  process.env.HOME = TEST_HOME;
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_TOOL_DIR, { recursive: true });
  mkdirSync(TEST_HOME, { recursive: true });

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
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
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
      // Flat paths (legacy) and namespaced paths
      const flatSkillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME);
      const nsSkillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
      for (const skillPath of [flatSkillPath, nsSkillPath]) {
        rmSync(skillPath, { recursive: true, force: true });
        rmSync(`${skillPath}.bak`, { recursive: true, force: true });
        for (let i = 1; i <= 30; i++) {
          rmSync(`${skillPath}.bak.${i}`, { recursive: true, force: true });
        }
      }
      // Also clean up plugin namespace dir if empty
      const nsPluginDir = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_PLUGIN_NAME);
      try {
        if (existsSync(nsPluginDir) && readdirSync(nsPluginDir).length === 0) {
          rmSync(nsPluginDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
    if (instance.commandsSubdir) {
      const flatCmdPath = join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`);
      const nsCmdPath = join(instance.configDir, instance.commandsSubdir, TEST_PLUGIN_NAME, `${TEST_COMMAND_NAME}.md`);
      for (const cmdPath of [flatCmdPath, nsCmdPath]) {
        rmSync(cmdPath, { force: true });
        rmSync(`${cmdPath}.bak`, { force: true });
        for (let i = 1; i <= 30; i++) {
          rmSync(`${cmdPath}.bak.${i}`, { force: true });
        }
      }
      const nsPluginDir = join(instance.configDir, instance.commandsSubdir, TEST_PLUGIN_NAME);
      try {
        if (existsSync(nsPluginDir) && readdirSync(nsPluginDir).length === 0) {
          rmSync(nsPluginDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
    if (instance.agentsSubdir) {
      const flatAgentPath = join(instance.configDir, instance.agentsSubdir, `${TEST_AGENT_NAME}.md`);
      const nsAgentPath = join(instance.configDir, instance.agentsSubdir, TEST_PLUGIN_NAME, `${TEST_AGENT_NAME}.md`);
      for (const agentPath of [flatAgentPath, nsAgentPath]) {
        rmSync(agentPath, { force: true });
        rmSync(`${agentPath}.bak`, { force: true });
        for (let i = 1; i <= 30; i++) {
          rmSync(`${agentPath}.bak.${i}`, { force: true });
        }
      }
      const nsPluginDir = join(instance.configDir, instance.agentsSubdir, TEST_PLUGIN_NAME);
      try {
        if (existsSync(nsPluginDir) && readdirSync(nsPluginDir).length === 0) {
          rmSync(nsPluginDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
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
        const skillPath = instance.pluginFlatInstall
          ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME)
          : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
        expect(existsSync(skillPath), `skill should exist for ${toolId}`).toBe(true);
        expect(existsSync(join(skillPath, "SKILL.md"))).toBe(true);

        const content = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
        expect(content).toContain("Test Skill");
      }
    }
  });

  it("copies a plugin's mcp.json alongside its skill for Amp/OpenCode", async () => {
    // Not asserting Codex/Pi *lack* the file: they share physical storage
    // with OpenCode/Amp via the .agents/skills redirect, so they'd see the
    // same file too (harmless — neither reads mcp.json from a skill
    // directory — but not a meaningful "did this tool's own copy logic run"
    // signal). Claude would be the clean comparison (separate ~/.claude/
    // skills storage), but exercising it here would enable the Claude
    // instance and go through installMcpServersToInstance's real `claude`
    // CLI shell-out — not something to risk invoking unmocked in this file.
    const pluginName = "mcp-plugin";
    const skillName = "mcp-skill";
    const pluginDir = join(getPluginsCacheDir(), TEST_MARKETPLACE, pluginName);
    mkdirSync(join(pluginDir, "skills", skillName), { recursive: true });
    writeFileSync(join(pluginDir, "skills", skillName, "SKILL.md"), `# ${skillName}\n\nHas an MCP server.`);
    writeFileSync(
      join(pluginDir, "mcp.json"),
      JSON.stringify({ mcpServers: { search: { command: "npx", args: ["search-mcp"] } } }),
    );

    const plugin: Plugin = {
      name: pluginName,
      marketplace: TEST_MARKETPLACE,
      description: "MCP-bundling test plugin",
      source: `./plugins/${pluginName}`,
      skills: [skillName],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: true,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    await enablePlugin(plugin);

    for (const toolId of ["opencode", "amp-code"]) {
      const instance = getInstance(toolId);
      const skillPath = instance.pluginFlatInstall
        ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, skillName)
        : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, pluginName, skillName);
      const mcpPath = join(skillPath, "mcp.json");
      expect(existsSync(mcpPath), `mcp.json should be copied alongside the skill for ${toolId}`).toBe(true);
      const copied = JSON.parse(readFileSync(mcpPath, "utf-8"));
      expect(copied.mcpServers.search).toEqual({ command: "npx", args: ["search-mcp"] });
    }
  });

  it("skips disabled tools", async () => {
    // OpenCode/Amp/Codex/Pi all share the same ~/.agents/skills location, so
    // disabling only OpenCode isn't enough to prove the skill was skipped —
    // one of the other three would still have written the file there.
    // Disable every tool sharing that location to isolate the assertion.
    updateToolInstanceConfig("opencode", "default", { enabled: false });
    updateToolInstanceConfig("amp-code", "default", { enabled: false });
    updateToolInstanceConfig("openai-codex", "default", { enabled: false });
    updateToolInstanceConfig("pi", "default", { enabled: false });
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);

    const opencodeKey = `${getInstance("opencode").toolId}:${getInstance("opencode").instanceId}`;
    expect(result.linkedInstances[opencodeKey]).toBeUndefined();

    const opencode = getInstance("opencode");
    if (opencode.skillsSubdir) {
      const skillPath = opencode.pluginFlatInstall
        ? resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir, TEST_SKILL_NAME)
        : resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
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
        const cmdPath = instance.pluginFlatInstall
          ? join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`)
          : join(instance.configDir, instance.commandsSubdir, TEST_PLUGIN_NAME, `${TEST_COMMAND_NAME}.md`);
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
        const agentPath = instance.pluginFlatInstall
          ? join(instance.configDir, instance.agentsSubdir, `${TEST_AGENT_NAME}.md`)
          : join(instance.configDir, instance.agentsSubdir, TEST_PLUGIN_NAME, `${TEST_AGENT_NAME}.md`);
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
    expect(manifest.tools[opencodeKey].items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)]).toBeDefined();
    expect(manifest.tools[opencodeKey].items[buildManifestItemKey(TEST_PLUGIN_NAME, "command", TEST_COMMAND_NAME)]).toBeDefined();
    expect(manifest.tools[opencodeKey].items[buildManifestItemKey(TEST_PLUGIN_NAME, "agent", TEST_AGENT_NAME)]).toBeDefined();

    const skillItem = manifest.tools[opencodeKey].items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)];
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

describe("updatePlugin", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    cleanupAllTestArtifacts();
  });

  it("updates only instances where plugin is already installed", async () => {
    const pluginName = "update-installed-only-plugin";
    const skillName = "update-installed-only-skill";
    const marketplace = "playbook";

    const repoRoot = join(TEST_ROOT, "playbook-update-repo");
    const marketplaceDir = join(repoRoot, ".claude-plugin");
    const marketplaceJsonPath = join(marketplaceDir, "marketplace.json");
    const pluginSourceDir = join(repoRoot, "plugins", pluginName);

    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(marketplaceJsonPath, JSON.stringify({ name: marketplace, plugins: [] }));

    mkdirSync(join(pluginSourceDir, "skills", skillName), { recursive: true });
    writeFileSync(join(pluginSourceDir, "skills", skillName, "SKILL.md"), "# Updated Skill");

    const opencode = getInstance("opencode");
    const opencodeSkillDir = resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir!, pluginName, skillName);
    mkdirSync(opencodeSkillDir, { recursive: true });
    writeFileSync(join(opencodeSkillDir, "SKILL.md"), "# Old Skill");


    const amp = getInstance("amp-code");
    const codex = getInstance("openai-codex");
    const ampSkillDir = resolveInstanceSubdirPath(amp.configDir, amp.skillsSubdir!, pluginName, skillName);
    const codexSkillDir = resolveInstanceSubdirPath(codex.configDir, codex.skillsSubdir!, pluginName, skillName);
    rmSync(ampSkillDir, { recursive: true, force: true });
    rmSync(codexSkillDir, { recursive: true, force: true });

    const plugin: Plugin = {
      name: pluginName,
      marketplace,
      description: "Update only installed instances",
      source: `./plugins/${pluginName}`,
      skills: [skillName],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    const result = await updatePlugin(plugin, marketplaceJsonPath);

    expect(result.success).toBe(true);
    expect(result.linkedInstances[`opencode:${opencode.instanceId}`]).toBeGreaterThan(0);
    expect(result.linkedInstances[`amp-code:${amp.instanceId}`]).toBeUndefined();
    expect(result.linkedInstances[`openai-codex:${codex.instanceId}`]).toBeUndefined();

    expect(readFileSync(join(opencodeSkillDir, "SKILL.md"), "utf-8")).toContain("Updated Skill");
    expect(existsSync(ampSkillDir)).toBe(false);
    expect(existsSync(codexSkillDir)).toBe(false);
  });
});

describe("backup and rollback behavior", () => {
  it("installs same-named skills from different plugins independently", async () => {
    const skillName = "shared-skill";
    const pluginAName = "backup-plugin-a";
    const pluginBName = "backup-plugin-b";

    createPluginInCache(pluginAName, skillName, undefined, "Plugin A");
    createPluginInCache(pluginBName, skillName, undefined, "Plugin B");

    const instance = getInstance("opencode");
    const skillPathA = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, pluginAName, skillName);
    const skillPathB = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, pluginBName, skillName);

    const pluginA = createPluginWithName(pluginAName, skillName);
    const pluginB = createPluginWithName(pluginBName, skillName);

    const resultA = await enablePlugin(pluginA);
    expect(resultA.success).toBe(true);
    expect(readFileSync(join(skillPathA, "SKILL.md"), "utf-8")).toContain("Plugin A");

    const resultB = await enablePlugin(pluginB);
    expect(resultB.success).toBe(true);
    expect(readFileSync(join(skillPathB, "SKILL.md"), "utf-8")).toContain("Plugin B");

    // Both skills should coexist
    expect(existsSync(skillPathA)).toBe(true);
    expect(existsSync(skillPathB)).toBe(true);

    await uninstallPlugin(pluginB);
    // Plugin A's skill should remain after uninstalling B
    expect(existsSync(skillPathA)).toBe(true);
    expect(existsSync(skillPathB)).toBe(false);
  });

  it("rolls back partial installs when a later step fails", async () => {
    // Codex and the shared .agents pseudo-tool only declare a `skills`
    // component (no `commands`), so they'd never hit the commands failure
    // below and would legitimately keep their install — but since they now
    // share the same physical ~/.agents/skills file as OpenCode, their
    // success would clobber OpenCode's rolled-back state. Disable every
    // instance except OpenCode (which has both skills and commands, so a
    // commands failure genuinely aborts its own skill install too) to keep
    // this a single-instance rollback test.
    updateToolInstanceConfig("amp-code", "default", { enabled: false });
    updateToolInstanceConfig("openai-codex", "default", { enabled: false });
    updateToolInstanceConfig("pi", "default", { enabled: false });
    updateToolInstanceConfig("agents", "default", { enabled: false });

    const skillName = "rollback-skill";
    const commandName = "rollback-command";
    const pluginName = "rollback-plugin";

    const pluginDir = createPluginInCache(pluginName, skillName, commandName, "Rollback Skill");
    const commandsDir = join(pluginDir, "commands");
    chmodSync(commandsDir, 0o000);

    const instance = getInstance("opencode");
    const skillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, pluginName, skillName);
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
    invalidatePluginToolStatusCache();
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
      const skillPath = resolveInstanceSubdirPath(primary.configDir, primary.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
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
    updateToolInstanceConfig("pi", "default", { enabled: false });
    const secondaryDir = join(TEST_TOOL_DIR, "opencode-secondary-disabled");
    mkdirSync(secondaryDir, { recursive: true });
    updateToolInstanceConfig("opencode", "secondary-disabled", {
      enabled: false,
      configDir: secondaryDir,
      name: "OpenCode Secondary Disabled",
    });

    const plugin = createTestPlugin();
    if (primary.skillsSubdir) {
      const skillPath = resolveInstanceSubdirPath(primary.configDir, primary.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
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
        const skillPath = instance.pluginFlatInstall
          ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME)
          : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
        expect(existsSync(skillPath)).toBe(true);
      }
    }

    const result = await disablePlugin(plugin);

    expect(result.success).toBe(true);

    for (const toolId of ["opencode", "amp-code", "openai-codex"]) {
      const instance = getInstance(toolId);
      if (instance.skillsSubdir) {
        const skillPath = instance.pluginFlatInstall
          ? resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_SKILL_NAME)
          : resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
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
        const cmdPath = instance.pluginFlatInstall
          ? join(instance.configDir, instance.commandsSubdir, `${TEST_COMMAND_NAME}.md`)
          : join(instance.configDir, instance.commandsSubdir, TEST_PLUGIN_NAME, `${TEST_COMMAND_NAME}.md`);
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
    // OpenCode/Amp/Codex's skill component all share the same physical
    // ~/.agents/skills file. Instances are processed in playbook order
    // (opencode, then amp-code, then openai-codex), so only the first to
    // touch the shared skill actually removes a file there — the rest find
    // it already gone and only remove their own per-tool command/agent
    // files (Codex has neither, so it removes nothing).
    expect(result.linkedInstances[opencodeKey]).toBe(3);
    expect(result.linkedInstances[ampKey]).toBe(2);
    expect(result.linkedInstances[codexKey]).toBe(0);
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
    const skillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, TEST_PLUGIN_NAME, TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const skillItem = manifest.tools[opencodeKey]?.items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)];
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
    const cmdPath = join(instance.configDir, instance.commandsSubdir!, TEST_PLUGIN_NAME, `${TEST_COMMAND_NAME}.md`);

    mkdirSync(join(instance.configDir, instance.commandsSubdir!, TEST_PLUGIN_NAME), { recursive: true });
    writeFileSync(cmdPath, "# Original Command\n\nExisting user command.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const commandItem = manifest.tools[opencodeKey]?.items[buildManifestItemKey(TEST_PLUGIN_NAME, "command", TEST_COMMAND_NAME)];
    expect(commandItem?.backup).toBeTruthy();
    const backupPath = commandItem?.backup ?? "";
    expect(existsSync(backupPath)).toBe(true);

    const backupContent = readFileSync(backupPath, "utf-8");
    expect(backupContent).toContain("Original Command");
  });

  it("restores backup when disabling", async () => {
    const instance = getInstance("opencode");
    const skillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, TEST_PLUGIN_NAME, TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();
    const enableResult = await enablePlugin(plugin);

    expect(enableResult.success).toBe(true);

    const manifest = loadManifest();
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const skillItem = manifest.tools[opencodeKey]?.items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)];
    expect(skillItem).toBeDefined();
    expect(skillItem?.backup).toBeTruthy();
    const backupPath = skillItem?.backup ?? "";
    expect(existsSync(backupPath)).toBe(true);
    expect(skillItem?.source).toContain(TEST_PLUGIN_NAME);

    const disableResult = await disablePlugin(plugin);
    expect(disableResult.success).toBe(true);
    expect(disableResult.linkedInstances[opencodeKey]).toBeGreaterThan(0);

    const manifestAfterDisable = loadManifest();
    const itemAfterDisable = manifestAfterDisable.tools[opencodeKey]?.items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)];
    expect(itemAfterDisable).toBeUndefined();

    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(backupPath)).toBe(false);

    const restoredContent = readFileSync(join(skillPath, "SKILL.md"), "utf-8");
    expect(restoredContent).toContain("Original Content");
  });

  it("backs up and restores across a simulated cross-device (EXDEV) boundary", async () => {
    const instance = getInstance("opencode");
    const skillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, TEST_PLUGIN_NAME, TEST_SKILL_NAME);

    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, "SKILL.md"), "# Original Content\n\nExisting user skill.");

    createTestPluginInCache();
    const plugin = createTestPlugin();

    exdevState.active = true;
    try {
      // Enable moves the user's original file into the cache-backed backup dir
      // (cross-device) and stages the new content into the config dir.
      const enableResult = await enablePlugin(plugin);
      expect(enableResult.success).toBe(true);

      const manifest = loadManifest();
      const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
      const skillItem =
        manifest.tools[opencodeKey]?.items[buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME)];
      expect(skillItem?.backup).toBeTruthy();
      const backupPath = skillItem?.backup ?? "";
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(join(backupPath, "SKILL.md"), "utf-8")).toContain("Original Content");

      // Disable restores the backup from the cache dir back into the config dir
      // (again cross-device).
      const disableResult = await disablePlugin(plugin);
      expect(disableResult.success).toBe(true);

      expect(existsSync(skillPath)).toBe(true);
      expect(existsSync(backupPath)).toBe(false);
      expect(readFileSync(join(skillPath, "SKILL.md"), "utf-8")).toContain("Original Content");
    } finally {
      exdevState.active = false;
    }
  });

  it("overwrites existing backup (single backup per item)", async () => {
    const instance = getInstance("opencode");
    const skillPath = resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    // Backup paths are now scoped by tool instance + plugin, so a stale backup
    // from a prior install of the SAME item still gets overwritten (single
    // backup per item), while different instances/plugins never collide.
    const opencodeKey = `${instance.toolId}:${instance.instanceId}`;
    const backupPath = buildBackupPath(opencodeKey, TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);

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
      agentsSubdir: null, kind: "tool" as const,
      enabled: true,
      pluginFlatInstall: false,
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

describe("syncPluginInstances", () => {
  it("refreshes stale cached plugin source from marketplace before syncing", async () => {
    const pluginName = "updated-plugin";
    const skillName = "new-skill";
    const marketplace = "local-updated-marketplace";

    const staleCacheDir = join(getPluginsCacheDir(), marketplace, pluginName);
    mkdirSync(join(staleCacheDir, "skills", "old-skill"), { recursive: true });
    writeFileSync(join(staleCacheDir, "skills", "old-skill", "SKILL.md"), "# Old skill");

    const marketplaceDir = join(TEST_ROOT, "local-marketplace-source");
    const pluginSourceDir = join(marketplaceDir, "plugins", pluginName);
    mkdirSync(join(pluginSourceDir, "skills", skillName), { recursive: true });
    writeFileSync(join(pluginSourceDir, "skills", skillName, "SKILL.md"), "# New skill");

    const plugin: Plugin = {
      name: pluginName,
      marketplace,
      description: "Updated plugin",
      source: `./plugins/${pluginName}`,
      skills: [skillName],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    const opencodeInstance = getInstance("opencode");
    const targetDir = resolveInstanceSubdirPath(opencodeInstance.configDir, opencodeInstance.skillsSubdir!, pluginName, skillName);
    rmSync(targetDir, { recursive: true, force: true });

    const result = await syncPluginInstances(plugin, marketplaceDir, [
      {
        toolId: "opencode",
        instanceId: opencodeInstance.instanceId,
        name: opencodeInstance.name,
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.syncedInstances[`opencode:${opencodeInstance.instanceId}`]).toBeGreaterThan(0);
    expect(existsSync(join(targetDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(staleCacheDir, "skills", skillName, "SKILL.md"))).toBe(true);
  });

  it("resolves local marketplace plugin sources relative to repo root when URL points to .claude-plugin/marketplace.json", async () => {
    const pluginName = "eval-model";
    const skillName = "eval-model";
    const marketplace = "playbook";

    const repoRoot = join(TEST_ROOT, "playbook-repo");
    const marketplaceDir = join(repoRoot, ".claude-plugin");
    const marketplaceJsonPath = join(marketplaceDir, "marketplace.json");
    const pluginSourceDir = join(repoRoot, "plugins", pluginName);

    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(marketplaceJsonPath, JSON.stringify({ name: marketplace, plugins: [] }));

    mkdirSync(join(pluginSourceDir, "skills", skillName), { recursive: true });
    writeFileSync(join(pluginSourceDir, "skills", skillName, "SKILL.md"), "# Eval Model");

    const plugin: Plugin = {
      name: pluginName,
      marketplace,
      description: "Eval model skill",
      source: `./plugins/${pluginName}`,
      skills: [skillName],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    const opencodeInstance = getInstance("opencode");
    const targetDir = resolveInstanceSubdirPath(opencodeInstance.configDir, opencodeInstance.skillsSubdir!, pluginName, skillName);
    rmSync(targetDir, { recursive: true, force: true });

    const result = await syncPluginInstances(plugin, marketplaceJsonPath, [
      {
        toolId: "opencode",
        instanceId: opencodeInstance.instanceId,
        name: opencodeInstance.name,
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.syncedInstances[`opencode:${opencodeInstance.instanceId}`]).toBeGreaterThan(0);
    expect(existsSync(join(targetDir, "SKILL.md"))).toBe(true);
  });

  it("resolves local marketplace plugin sources when the marketplace URL is a file:// URL", async () => {
    const pluginName = "eval-model-fileurl";
    const skillName = "eval-model-fileurl";
    const marketplace = "playbook-fileurl";

    const repoRoot = join(TEST_ROOT, "playbook-repo-fileurl");
    const marketplaceDir = join(repoRoot, ".claude-plugin");
    const marketplaceJsonPath = join(marketplaceDir, "marketplace.json");
    const pluginSourceDir = join(repoRoot, "plugins", pluginName);

    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(marketplaceJsonPath, JSON.stringify({ name: marketplace, plugins: [] }));

    mkdirSync(join(pluginSourceDir, "skills", skillName), { recursive: true });
    writeFileSync(join(pluginSourceDir, "skills", skillName, "SKILL.md"), "# Eval Model");

    const plugin: Plugin = {
      name: pluginName,
      marketplace,
      description: "Eval model skill",
      source: `./plugins/${pluginName}`,
      skills: [skillName],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    const opencodeInstance = getInstance("opencode");
    const targetDir = resolveInstanceSubdirPath(opencodeInstance.configDir, opencodeInstance.skillsSubdir!, pluginName, skillName);
    rmSync(targetDir, { recursive: true, force: true });

    const result = await syncPluginInstances(plugin, pathToFileURL(marketplaceJsonPath).href, [
      {
        toolId: "opencode",
        instanceId: opencodeInstance.instanceId,
        name: opencodeInstance.name,
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.syncedInstances[`opencode:${opencodeInstance.instanceId}`]).toBeGreaterThan(0);
    expect(existsSync(join(targetDir, "SKILL.md"))).toBe(true);
  });

  it("syncs standalone installed skill sources (no package root) to missing instances", async () => {
    const standaloneSource = join(TEST_ROOT, "standalone-skill-source", TEST_SKILL_NAME);
    mkdirSync(standaloneSource, { recursive: true });
    writeFileSync(join(standaloneSource, "SKILL.md"), "# Standalone Skill");

    const plugin: Plugin = {
      name: TEST_SKILL_NAME,
      marketplace: "local",
      description: "Standalone skill",
      source: standaloneSource,
      skills: [TEST_SKILL_NAME],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    };

    const opencodeInstance = getInstance("opencode");
    const target = resolveInstanceSubdirPath(opencodeInstance.configDir, opencodeInstance.skillsSubdir!, TEST_SKILL_NAME, TEST_SKILL_NAME, "SKILL.md");
    rmSync(resolveInstanceSubdirPath(opencodeInstance.configDir, opencodeInstance.skillsSubdir!, TEST_SKILL_NAME, TEST_SKILL_NAME), { recursive: true, force: true });

    const result = await syncPluginInstances(plugin, undefined, [
      {
        toolId: "opencode",
        instanceId: opencodeInstance.instanceId,
        name: opencodeInstance.name,
        installed: false,
        supported: true,
        enabled: true,
      },
    ]);

    expect(result.success).toBe(true);
    expect(result.syncedInstances[`opencode:${opencodeInstance.instanceId}`]).toBeGreaterThan(0);
    expect(existsSync(target)).toBe(true);
  });
});

describe("standalone skill scanning compatibility", () => {
  function configureSourceRepoWithSsmpSkill(skillName: string): string {
    const sourceRepo = join(TEST_ROOT, "source-repo");
    const sourceSkillDir = join(sourceRepo, "skills", "ssmp", skillName);
    mkdirSync(sourceSkillDir, { recursive: true });
    writeFileSync(join(sourceSkillDir, "SKILL.md"), `# ${skillName}\n\nsource copy\n`);

    const configPath = getYamlConfigPath();
    const loaded = loadYamlConfig(configPath);
    expect(loaded.errors).toEqual([]);
    saveYamlConfig(
      {
        ...loaded.config,
        settings: {
          ...loaded.config.settings,
          source_repo: sourceRepo,
        },
      },
      configPath,
    );
    return sourceRepo;
  }

  it("detects flat Pi skills on disk and maps them to ssmp namespace via source_repo", () => {
    const skillName = "ambient-texture-drones";
    configureSourceRepoWithSsmpSkill(skillName);

    const piInstance = getInstance("pi");
    expect(piInstance.skillsSubdir).toBeTruthy();
    expect(piInstance.pluginFlatInstall).toBe(false);

    const flatSkillDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, skillName);
    mkdirSync(flatSkillDir, { recursive: true });
    writeFileSync(join(flatSkillDir, "SKILL.md"), "# ambient-texture-drones\n\nsource copy\n");

    const skills = getStandaloneSkills([]);
    const found = skills.find((s) => s.name === skillName);

    expect(found).toBeDefined();
    expect(found?.namespace).toBe("ssmp");
    expect(found?.installations.length).toBeGreaterThan(0);
    expect(
      found?.installations.some(
        (i) => i.toolId === "pi" && i.instanceId === piInstance.instanceId,
      ),
    ).toBe(true);
  });

  it("installs standalone skills to namespaced paths on non-flat tools", () => {
    const skillName = "midi-drum-production";
    const sourceRepo = configureSourceRepoWithSsmpSkill(skillName);
    const sourceSkillDir = join(sourceRepo, "skills", "ssmp", skillName);

    const piInstance = getInstance("pi");
    const skill = {
      name: skillName,
      namespace: "ssmp",
      installations: [],
      diskPath: sourceSkillDir,
      toolId: "",
      instanceId: "",
      instanceName: "",
      sourcePath: sourceSkillDir,
    } as any;

    const ok = installSkillToInstance(skill, "pi", piInstance.instanceId);
    expect(ok).toBe(true);

    const namespacedPath = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, "ssmp", skillName, "SKILL.md");
    const flatPath = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, skillName, "SKILL.md");

    expect(existsSync(namespacedPath)).toBe(true);
    expect(existsSync(flatPath)).toBe(false);
  });

  it("symlinks instead of copying when skill_sync_mode is 'symlink'", () => {
    const skillName = "symlink-mode-skill";
    const sourceRepo = configureSourceRepoWithSsmpSkill(skillName);
    const sourceSkillDir = join(sourceRepo, "skills", "ssmp", skillName);

    const configPath = getYamlConfigPath();
    const loaded = loadYamlConfig(configPath);
    saveYamlConfig(
      { ...loaded.config, settings: { ...loaded.config.settings, skill_sync_mode: "symlink" } },
      configPath,
    );

    const piInstance = getInstance("pi");
    const skill = {
      name: skillName, namespace: "ssmp", installations: [],
      diskPath: sourceSkillDir, toolId: "", instanceId: "", instanceName: "",
      sourcePath: sourceSkillDir,
    } as any;

    const ok = installSkillToInstance(skill, "pi", piInstance.instanceId);
    expect(ok).toBe(true);

    const targetDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, "ssmp", skillName);
    expect(lstatSync(targetDir).isSymbolicLink()).toBe(true);
    expect(realpathSync(targetDir)).toBe(realpathSync(sourceSkillDir));

    // Genuinely linked, not copied: editing the source is immediately visible
    // through the target, with no separate on-disk copy to fall out of sync.
    writeFileSync(join(sourceSkillDir, "SKILL.md"), `# ${skillName}\n\nedited after install\n`);
    expect(readFileSync(join(targetDir, "SKILL.md"), "utf-8")).toContain("edited after install");
  });

  it("migrates legacy flat standalone skills to namespaced paths", () => {
    const skillName = "ambient-texture-drones";
    configureSourceRepoWithSsmpSkill(skillName);

    const piInstance = getInstance("pi");
    const flatSkillDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, skillName);
    const namespacedSkillDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, "ssmp", skillName);

    mkdirSync(flatSkillDir, { recursive: true });
    writeFileSync(join(flatSkillDir, "SKILL.md"), "# ambient-texture-drones\n\nlegacy flat\n");
    expect(existsSync(join(flatSkillDir, "SKILL.md"))).toBe(true);

    const result = migrateLegacyStandaloneSkillLayout();
    expect(result.moved).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    expect(existsSync(join(namespacedSkillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(flatSkillDir)).toBe(false);
  });

  it("backs up an existing (drifted) install before overwriting it", () => {
    const skillName = "arrangement-production-architecture";
    const sourceRepo = configureSourceRepoWithSsmpSkill(skillName);
    const sourceSkillDir = join(sourceRepo, "skills", "ssmp", skillName);

    const piInstance = getInstance("pi");
    const skill = {
      name: skillName, namespace: "ssmp", installations: [],
      diskPath: sourceSkillDir, toolId: "", instanceId: "", instanceName: "",
      sourcePath: sourceSkillDir,
    } as any;

    // Pre-existing install carrying user edits at the namespaced target.
    const targetDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, "ssmp", skillName);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "# user-edited local version\n");

    expect(installSkillToInstance(skill, "pi", piInstance.instanceId)).toBe(true);

    // Target overwritten with the source copy…
    expect(readFileSync(join(targetDir, "SKILL.md"), "utf-8")).toContain("source copy");
    // …and the user's prior version was backed up recoverably.
    const backups = listBackups(`skill:${skillName}`);
    expect(backups.length).toBeGreaterThan(0);
    expect(readFileSync(join(backups[0], skillName, "SKILL.md"), "utf-8")).toContain("user-edited");
  });

  it("backs up the source-repo skill before pullback overwrites it", () => {
    const skillName = "mixing-fundamentals";
    const sourceRepo = configureSourceRepoWithSsmpSkill(skillName);
    const sourceSkillDir = join(sourceRepo, "skills", "ssmp", skillName);
    // Distinct "old" source content we expect to be preserved on pullback.
    writeFileSync(join(sourceSkillDir, "SKILL.md"), "# old source, perhaps uncommitted\n");

    const piInstance = getInstance("pi");
    // A disk install holding the newer content to be pulled back.
    const diskDir = resolveInstanceSubdirPath(piInstance.configDir, piInstance.skillsSubdir!, "ssmp", skillName);
    mkdirSync(diskDir, { recursive: true });
    writeFileSync(join(diskDir, "SKILL.md"), "# newer disk version\n");

    const skill = {
      name: skillName, namespace: "ssmp", sourcePath: sourceSkillDir,
      installations: [
        { toolId: "pi", instanceId: piInstance.instanceId, instanceName: "Pi", diskPath: diskDir, drifted: true },
      ],
    } as any;

    expect(pullbackSkillToSource(skill, "pi", piInstance.instanceId)).toBe(true);

    // Source now holds the disk version…
    expect(readFileSync(join(sourceSkillDir, "SKILL.md"), "utf-8")).toContain("newer disk version");
    // …and the prior source content was backed up before removal.
    const backups = listBackups(`skill-source:${skillName}`);
    expect(backups.length).toBeGreaterThan(0);
    expect(readFileSync(join(backups[0], skillName, "SKILL.md"), "utf-8")).toContain("old source");
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

// ─────────────────────────────────────────────────────────────────────────────
// P1 data-integrity fixes (backup scoping, manifest key migration, update
// ordering, Claude/Pi uninstall, partial-failure reporting).
// ─────────────────────────────────────────────────────────────────────────────

describe("manifest key migration (item 2)", () => {
  it("migrates legacy owner-less keys with zero data loss across owners", () => {
    const legacy = {
      tools: {
        "opencode:default": {
          items: {
            // Plugin B overwrote plugin A's same-named skill: A survives only
            // nested in B's `previous` — the legacy data-loss / orphaning case.
            "skill:review": {
              kind: "skill",
              name: "review",
              source: "/cache/mkt/plugin-b/skills/review",
              dest: "skills/plugin-b/review",
              backup: null,
              owner: "plugin-b",
              previous: {
                kind: "skill",
                name: "review",
                source: "/cache/mkt/plugin-a/skills/review",
                dest: "skills/plugin-a/review",
                backup: null,
                owner: "plugin-a",
                previous: null,
              },
            },
            // A plain owned entry.
            "command:build": {
              kind: "command",
              name: "build",
              source: "/cache/mkt/plugin-a/commands/build.md",
              dest: "commands/plugin-a/build.md",
              backup: null,
              owner: "plugin-a",
              previous: null,
            },
            // A very old entry with NO recorded owner — must NOT be dropped.
            "agent:legacy": {
              kind: "agent",
              name: "legacy",
              source: "/somewhere/agents/legacy.md",
              dest: "agents/legacy.md",
              backup: null,
              previous: null,
            },
          },
        },
      },
    };

    const manifest = JSON.parse(JSON.stringify(legacy));
    const changed = migrateManifestKeys(manifest);
    expect(changed).toBe(true);

    const items = manifest.tools["opencode:default"].items;

    // Both owners' `review` skills survive under distinct owner-scoped keys.
    const bKey = buildManifestItemKey("plugin-b", "skill", "review");
    const aKey = buildManifestItemKey("plugin-a", "skill", "review");
    expect(items[bKey]).toBeDefined();
    expect(items[aKey]).toBeDefined();
    expect(items[aKey].owner).toBe("plugin-a");
    expect(items[bKey].owner).toBe("plugin-b");
    // Plugin A's entry is promoted to top-level (no longer buried under B).
    expect(items[bKey].previous).toBeNull();
    expect(items[aKey].previous).toBeNull();

    // Owned command migrated.
    expect(items[buildManifestItemKey("plugin-a", "command", "build")]).toBeDefined();

    // No-owner entry preserved under a clearly-marked fallback key.
    expect(items["__unowned__:agent:legacy"]).toBeDefined();

    // Nothing gained or lost: exactly 4 entries.
    expect(Object.keys(items)).toHaveLength(4);

    // Idempotent: re-running over already-migrated data is a no-op.
    const secondPass = JSON.parse(JSON.stringify(manifest));
    expect(migrateManifestKeys(secondPass)).toBe(false);
  });
});

describe("P1 data-integrity behavior", () => {
  it("scopes backups per tool instance so they never collide (item 1)", async () => {
    // OpenCode and Codex now share the same physical ~/.agents/skills
    // location by design (see the .agents pseudo-tool), so they can no
    // longer serve as the "two independent instances" half of this test —
    // use Claude Code instead, whose skills stay in its own ~/.claude/skills.
    updateToolInstanceConfig("claude-code", "default", { enabled: true });
    const opencode = getInstance("opencode");
    const claude = getInstance("claude-code");

    const ocSkill = resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir!, TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    // Claude is flat-install, so a plugin's skill lands under a
    // plugin-prefixed flattened name (see flattenNamespacedName), not the
    // bare skill name.
    const claudeSkill = resolveInstanceSubdirPath(
      claude.configDir,
      claude.skillsSubdir!,
      flattenNamespacedName(TEST_PLUGIN_NAME, TEST_SKILL_NAME),
    );
    mkdirSync(ocSkill, { recursive: true });
    writeFileSync(join(ocSkill, "SKILL.md"), "# Opencode Original");
    mkdirSync(claudeSkill, { recursive: true });
    writeFileSync(join(claudeSkill, "SKILL.md"), "# Claude Original");

    createTestPluginInCache();
    await enablePlugin(createTestPlugin());

    const manifest = loadManifest();
    const key = buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);
    const ocBackup = manifest.tools[`opencode:${opencode.instanceId}`]?.items[key]?.backup ?? "";
    const claudeBackup = manifest.tools[`claude-code:${claude.instanceId}`]?.items[key]?.backup ?? "";

    expect(ocBackup).toBeTruthy();
    expect(claudeBackup).toBeTruthy();
    // Distinct backup locations — the second instance did not clobber the first.
    expect(ocBackup).not.toBe(claudeBackup);
    expect(readFileSync(join(ocBackup, "SKILL.md"), "utf-8")).toContain("Opencode Original");
    expect(readFileSync(join(claudeBackup, "SKILL.md"), "utf-8")).toContain("Claude Original");
  });

  it("updatePlugin leaves the installed copy untouched when the download fails (item 3)", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    plugin.source = ""; // force downloadPlugin to fail (no resolvable repo URL)

    await enablePlugin(plugin);
    invalidatePluginToolStatusCache();

    const codex = getInstance("openai-codex");
    const codexKey = `openai-codex:${codex.instanceId}`;
    const itemKey = buildManifestItemKey(TEST_PLUGIN_NAME, "skill", TEST_SKILL_NAME);

    const before = loadManifest();
    const dest = before.tools[codexKey]?.items[itemKey]?.dest;
    expect(dest).toBeTruthy();
    // installPluginItemsToInstance records an absolute dest; resolve robustly.
    const installedPath = dest!.startsWith("/") ? dest! : join(codex.configDir, dest!);
    expect(existsSync(installedPath)).toBe(true);

    // Point at a marketplace that cannot resolve — the download must fail.
    const result = await updatePlugin(plugin, "/tmp/blackbook-nonexistent-marketplace/marketplace.json");

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("left untouched"))).toBe(true);

    // The previously-installed item and its files are still present.
    const after = loadManifest();
    expect(after.tools[codexKey]?.items[itemKey]).toBeDefined();
    expect(existsSync(installedPath)).toBe(true);
  });

  it("Claude uninstall goes through the native CLI (item 4)", async () => {
    const binDir = join(TEST_ROOT, "fakebin");
    const recordFile = join(TEST_ROOT, "claude-invocations.log");
    mkdirSync(binDir, { recursive: true });
    const claudeBin = join(binDir, "claude");
    writeFileSync(claudeBin, `#!/bin/sh\necho "$@" >> ${JSON.stringify(recordFile)}\nexit 0\n`);
    chmodSync(claudeBin, 0o755);

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath ?? ""}`;
    try {
      updateToolInstanceConfig("claude-code", "default", {
        enabled: true,
        configDir: join(TEST_TOOL_DIR, "claude-code"),
      });

      const result = await uninstallPluginFromInstance(createTestPlugin(), "claude-code", "default");

      expect(result).toBe(true);
      const log = readFileSync(recordFile, "utf-8");
      expect(log).toContain("plugin uninstall");
      expect(log).toContain(`${TEST_PLUGIN_NAME}@${TEST_MARKETPLACE}`);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it("Pi uninstall awaits the bridge and reports failure (item 5)", async () => {
    // Force a deterministic bridge failure regardless of whether the Pi bridge
    // package happens to be present: point the Pi instance at a non-existent
    // working directory so the underlying `bun -e` spawn (or the readiness
    // check) fails. The fix must AWAIT that failure and return false, rather
    // than fire-and-forget a bogus `true`.
    const missingDir = join(TEST_ROOT, "pi-missing-configdir");
    updateToolInstanceConfig("pi", "default", { enabled: true, configDir: missingDir });
    const result = await uninstallPluginFromInstance(createTestPlugin(), "pi", "default");
    expect(result).toBe(false);
  });

  it("deleteFileEverywhere reports partial target-removal failures (item 6)", () => {
    const okTarget = join(TEST_ROOT, "delete-ok.txt");
    const failDir = join(TEST_ROOT, "delete-fail-dir");
    writeFileSync(okTarget, "content");
    // Non-empty directory: rmSync(target, { force: true }) (no recursive) throws.
    mkdirSync(join(failDir, "child"), { recursive: true });

    const mkInstance = (toolId: string, name: string, targetPath: string) => ({
      toolId,
      instanceId: "default",
      instanceName: name,
      configDir: TEST_ROOT,
      targetRelPath: targetPath,
      sourcePath: "/does/not/exist/source",
      targetPath,
      status: "ok" as const,
      message: "",
    });

    const file: FileStatus = {
      name: "blackbook-nonexistent-config-entry",
      source: "/does/not/exist/source",
      target: "target",
      kind: "file",
      instances: [
        mkInstance("opencode", "OpenCode", okTarget),
        mkInstance("openai-codex", "Codex", failDir),
      ],
    };

    const result = deleteFileEverywhere(file);
    expect(result.ok).toBe(false);
    expect(result.targets).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Codex");
    expect(result.error).toBeTruthy();
    expect(existsSync(okTarget)).toBe(false);
  });

  it("togglePluginComponent returns false when a per-instance operation fails (item 9)", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const opencode = getInstance("opencode");
    const namespaceDir = resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir!, TEST_PLUGIN_NAME);
    // Make the parent directory read-only so removing the installed skill fails.
    chmodSync(namespaceDir, 0o500);
    try {
      const result = togglePluginComponent(plugin, "skill", TEST_SKILL_NAME, false);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      chmodSync(namespaceDir, 0o755);
    }
  });
});

describe("crash resilience: incremental manifest persistence", () => {
  beforeEach(() => {
    cleanupAllTestArtifacts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupAllTestArtifacts();
  });

  function countItems(manifest: { tools: Record<string, { items: Record<string, unknown> }> }): number {
    return Object.values(manifest.tools).reduce(
      (total, tool) => total + Object.keys(tool.items).length,
      0,
    );
  }

  it("persists the manifest after each item so a crash cannot strand files", async () => {
    createTestPluginInCache();
    const plugin = createTestPlugin(); // 1 skill + 1 command + 1 agent per managed instance

    // Record the item-count of every manifest snapshot handed to saveManifest.
    // A pre-fix install would only save once (at the very end), so the only
    // snapshot would be the final full count. The fix saves per item, so we
    // should observe intermediate snapshots — meaning a crash at that point
    // still leaves a recoverable manifest record for the already-copied files.
    const realSave = manifestModule.saveManifest;
    const snapshots: number[] = [];
    const spy = vi
      .spyOn(manifestModule, "saveManifest")
      .mockImplementation((manifest, cacheDir) => {
        snapshots.push(countItems(manifest as never));
        return realSave(manifest, cacheDir);
      });

    await enablePlugin(plugin);
    spy.mockRestore();

    expect(snapshots.length).toBeGreaterThan(1);
    const finalCount = Math.max(...snapshots);
    expect(finalCount).toBeGreaterThanOrEqual(3);
    // Crucial invariant: at least one persisted snapshot held a partial set of
    // items (0 < n < final). Pre-fix, no such intermediate snapshot exists.
    expect(snapshots.some((n) => n > 0 && n < finalCount)).toBe(true);

    // And the final on-disk manifest records everything that was installed.
    const onDisk = loadManifest();
    expect(countItems(onDisk)).toBe(finalCount);
  });
});

describe("crash resilience: reconcileStaleInstallArtifacts", () => {
  const SCOPE = "recon-scope";
  const PLUGIN = "recon-plugin";

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(join(getCacheDir(), "backups", SCOPE), { recursive: true, force: true });
  });

  it("completes an interrupted backup move when the final slot is free", () => {
    const backupPath = buildBackupPath(SCOPE, PLUGIN, "command", "recon-cmd");
    // Simulate a crash mid-copyWithBackup: the user's original file was renamed
    // to the temp name but never moved onto the final backup path.
    const orphan = `${backupPath}.new.1700000000000`;
    writeFileSync(orphan, "ORIGINAL USER CONTENT");
    expect(existsSync(backupPath)).toBe(false);

    const result = reconcileStaleInstallArtifacts();

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf-8")).toBe("ORIGINAL USER CONTENT");
    expect(result.restored).toContain(backupPath);
    expect(result.needsReview).toHaveLength(0);
  });

  it("flags for review (never overwrites) when the final slot is occupied", () => {
    const backupPath = buildBackupPath(SCOPE, PLUGIN, "command", "recon-cmd2");
    const orphan = `${backupPath}.new.1700000000000`;
    writeFileSync(backupPath, "EXISTING BACKUP");
    writeFileSync(orphan, "ORPHANED ORIGINAL");

    const result = reconcileStaleInstallArtifacts();

    // Neither file is touched — silently overwriting could destroy user content.
    expect(existsSync(orphan)).toBe(true);
    expect(readFileSync(orphan, "utf-8")).toBe("ORPHANED ORIGINAL");
    expect(readFileSync(backupPath, "utf-8")).toBe("EXISTING BACKUP");
    expect(result.needsReview).toContain(orphan);
    expect(result.restored).not.toContain(backupPath);
  });
});

describe("claude derived view (~/.claude/skills as symlinks into ~/.agents/skills)", () => {
  const agentsRoot = () => join(TEST_HOME, ".agents", "skills");

  function enableClaude(): ToolInstance {
    updateToolInstanceConfig("claude-code", "default", { enabled: true });
    const instance = getInstance("claude-code");
    expect(instance.enabled).toBe(true);
    expect(instance.pluginFlatInstall).toBe(true);
    return instance;
  }

  function claudeSkillsDir(instance: ToolInstance): string {
    return resolveInstanceSubdirPath(instance.configDir, instance.skillsSubdir!);
  }

  it("plugin install creates a per-skill symlink resolving into ~/.agents/skills/<plugin>/<skill>", async () => {
    const claude = enableClaude();
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);
    expect(result.success).toBe(true);

    const flatName = flattenNamespacedName(TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    const linkPath = join(claudeSkillsDir(claude), flatName);
    const storePath = join(agentsRoot(), TEST_PLUGIN_NAME, TEST_SKILL_NAME);

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(storePath));
    expect(readFileSync(join(linkPath, "SKILL.md"), "utf-8")).toContain("Test Skill");
    // The store copy is a real directory, not a link back to the cache.
    expect(lstatSync(storePath).isDirectory()).toBe(true);
  });

  it("plugin install materializes the store copy when only claude is enabled", async () => {
    enableClaude();
    // Disable every .agents-sharing tool so nothing else can materialize it.
    for (const toolId of TOOL_IDS) {
      if (toolId !== "claude-code") {
        updateToolInstanceConfig(toolId, "default", { enabled: false });
      }
    }
    createTestPluginInCache();
    const plugin = createTestPlugin();

    const result = await enablePlugin(plugin);
    expect(result.success).toBe(true);

    const storePath = join(agentsRoot(), TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    expect(existsSync(join(storePath, "SKILL.md"))).toBe(true);
  });

  it("claude uninstall unlinks the derived view without destroying the store copy", async () => {
    const claude = enableClaude();
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const flatName = flattenNamespacedName(TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    const linkPath = join(claudeSkillsDir(claude), flatName);
    const storePath = join(agentsRoot(), TEST_PLUGIN_NAME, TEST_SKILL_NAME);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(existsSync(join(storePath, "SKILL.md"))).toBe(true);

    const removed = uninstallPluginItemsFromInstance(TEST_PLUGIN_NAME, claude);
    expect(removed).toBeGreaterThan(0);

    expect(existsSync(linkPath)).toBe(false);
    expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
    // Other tools still read the shared store entry.
    expect(existsSync(join(storePath, "SKILL.md"))).toBe(true);
  });

  it("prunes the empty namespace shell after the last skill in it is uninstalled", async () => {
    // Sole owner of the shared store dir — with amp/codex also enabled they'd
    // share the physical path, and uninstalling one must leave it for the rest.
    updateToolInstanceConfig("amp-code", "default", { enabled: false });
    updateToolInstanceConfig("openai-codex", "default", { enabled: false });
    const opencode = getInstance("opencode");
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    // Non-flat install: <skillsRoot>/<plugin>/<skill>/SKILL.md
    const nsDir = resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir!, TEST_PLUGIN_NAME);
    const skillDir = join(nsDir, TEST_SKILL_NAME);
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);

    uninstallPluginItemsFromInstance(TEST_PLUGIN_NAME, opencode);

    // Both the skill and its now-empty namespace parent are gone; the skills
    // root itself survives.
    expect(existsSync(skillDir)).toBe(false);
    expect(existsSync(nsDir)).toBe(false);
    expect(existsSync(resolveInstanceSubdirPath(opencode.configDir, opencode.skillsSubdir!))).toBe(true);
  });

  it("uninstallPlugin removes the shared store copy even when Claude (symlink dest) is one of the tools", async () => {
    // Claude installs its skill as a SYMLINK into ~/.agents/skills, so its
    // manifest dest is the link, not the store — its uninstall unlinks but
    // never removes the store target. With the other tools' entries being
    // sharedInstall no-ops, nothing would remove the physical store copy
    // without uninstallPlugin's orphaned-namespace cleanup.
    enableClaude();
    createTestPluginInCache();
    const plugin = createTestPlugin();
    await enablePlugin(plugin);

    const storeNsDir = join(agentsRoot(), TEST_PLUGIN_NAME);
    expect(existsSync(join(storeNsDir, TEST_SKILL_NAME, "SKILL.md"))).toBe(true);

    const ok = await uninstallPlugin(plugin);
    expect(ok).toBe(true);

    // The physical store copy is fully gone — no orphan left behind.
    expect(existsSync(storeNsDir)).toBe(false);
  });

  it("standalone skill install links claude at the store and uninstall only unlinks", () => {
    const claude = enableClaude();
    const skillName = "derived-view-skill";
    const sourceRepo = join(TEST_ROOT, "source-repo");
    const sourceSkillDir = join(sourceRepo, "skills", "testns", skillName);
    mkdirSync(sourceSkillDir, { recursive: true });
    writeFileSync(join(sourceSkillDir, "SKILL.md"), `# ${skillName}\n\nsource copy\n`);

    const skill = {
      name: skillName, namespace: "testns", installations: [],
      diskPath: sourceSkillDir, toolId: "", instanceId: "", instanceName: "",
      sourcePath: sourceSkillDir,
    } as any;

    expect(installSkillToInstance(skill, "claude-code", claude.instanceId)).toBe(true);

    const linkPath = join(claudeSkillsDir(claude), flattenNamespacedName("testns", skillName));
    const storePath = join(agentsRoot(), "testns", skillName);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(storePath));
    expect(readFileSync(join(linkPath, "SKILL.md"), "utf-8")).toContain("source copy");

    // Re-install is idempotent: the existing correct link is kept.
    expect(installSkillToInstance(skill, "claude-code", claude.instanceId)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

    const withInstall = {
      ...skill,
      installations: [
        { toolId: "claude-code", instanceId: claude.instanceId, instanceName: "Claude", diskPath: linkPath },
      ],
    } as any;
    expect(uninstallSkillFromInstance(withInstall, "claude-code", claude.instanceId)).toBe(true);
    expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(storePath, "SKILL.md"))).toBe(true);
  });

  describe("downloadPlugin (skills.sh discovery source)", () => {
    function makeSkillsShPlugin(): Plugin {
      return skillsShResultToPlugin({
        id: "acme/agent-skills/widget-builder",
        skillId: "widget-builder",
        name: "widget-builder",
        installs: 42,
        source: "acme/agent-skills",
      });
    }

    it("fetches via the download API and lays out the canonical skills/<id>/SKILL.md shape", async () => {
      const plugin = makeSkillsShPlugin();
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [
            { path: "SKILL.md", contents: "---\nname: widget-builder\n---\n\nBuild widgets." },
            { path: "references/patterns.md", contents: "# Patterns" },
          ],
        }),
      } as Response);

      const result = await downloadPlugin(plugin, "");
      expect(result).not.toBeNull();

      const skillMd = join(result!, "skills", "widget-builder", "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, "utf-8")).toContain("Build widgets");
      expect(existsSync(join(result!, "skills", "widget-builder", "references", "patterns.md"))).toBe(true);
    });

    it("never git-clones — the whole repo is not fetched, only the download API", async () => {
      const plugin = makeSkillsShPlugin();
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ files: [{ path: "SKILL.md", contents: "content" }] }),
      } as Response);

      await downloadPlugin(plugin, "");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe("https://skills.sh/api/download/acme/agent-skills/widget-builder");
    });

    it("returns null and cleans up when the download API responds non-ok", async () => {
      const plugin = makeSkillsShPlugin();
      vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 404 } as Response);

      const result = await downloadPlugin(plugin, "");
      expect(result).toBeNull();
      expect(existsSync(join(getPluginsCacheDir(), "skills.sh", plugin.name))).toBe(false);
    });

    it("returns null when the response has no SKILL.md", async () => {
      const plugin = makeSkillsShPlugin();
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ files: [{ path: "README.md", contents: "no skill file here" }] }),
      } as Response);

      const result = await downloadPlugin(plugin, "");
      expect(result).toBeNull();
    });
  });
});
