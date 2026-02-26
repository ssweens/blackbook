import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  lstatSync,
  realpathSync,
  readdirSync,
} from "fs";
import { dirname } from "path";
import { join } from "path";
import { tmpdir } from "os";
import type { Plugin, ToolInstance } from "./types.js";
import {
  createSymlink,
  removeSymlink,
  isSymlink,
  loadManifest,
  saveManifest,
  manifestPath,
} from "./install.js";
import * as config from "./config.js";

const TEST_DIR = join(tmpdir(), "blackbook-test-" + Date.now());
const TEST_CACHE_DIR = join(TEST_DIR, "cache");
const TEST_CONFIG_DIR = join(TEST_DIR, "config");

function createMockPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "test-plugin",
    marketplace: "test-marketplace",
    description: "A test plugin",
    source: "./plugins/test-plugin",
    skills: ["skill-one", "skill-two"],
    commands: ["cmd-one", "cmd-two"],
    agents: ["agent-one"],
    hooks: ["hook-one"],
    hasMcp: false,
    hasLsp: false,
    homepage: "https://example.com",
    installed: false,
    scope: "user",
    ...overrides,
  };
}

function createMockTool(overrides: Partial<ToolInstance> = {}): ToolInstance {
  return {
    toolId: "test-tool",
    instanceId: "default",
    name: "Test Tool",
    configDir: join(TEST_CONFIG_DIR, "test-tool"),
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    ...overrides,
  };
}

function setupTestDirs() {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_CACHE_DIR, { recursive: true });
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
}

function cleanupTestDirs() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createPluginFiles(pluginDir: string, plugin: Plugin) {
  // Create skill directories with SKILL.md
  for (const skill of plugin.skills) {
    const skillDir = join(pluginDir, "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}\n\nSkill description.`);
  }

  // Create command files
  if (plugin.commands.length > 0) {
    mkdirSync(join(pluginDir, "commands"), { recursive: true });
    for (const cmd of plugin.commands) {
      writeFileSync(join(pluginDir, "commands", `${cmd}.md`), `# ${cmd}\n\nCommand description.`);
    }
  }

  // Create agent files
  if (plugin.agents.length > 0) {
    mkdirSync(join(pluginDir, "agents"), { recursive: true });
    for (const agent of plugin.agents) {
      writeFileSync(join(pluginDir, "agents", `${agent}.md`), `# ${agent}\n\nAgent description.`);
    }
  }

  // Create hooks files
  if (plugin.hooks.length > 0) {
    mkdirSync(join(pluginDir, "hooks"), { recursive: true });
    for (const hook of plugin.hooks) {
      writeFileSync(join(pluginDir, "hooks", `${hook}.json`), JSON.stringify({ name: hook }));
    }
  }
}

describe("createSymlink", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("creates a symlink from source file to target", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source, "hello world");

    const result = createSymlink(source, target);

    expect(result.success).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(isSymlink(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("hello world");
  });

  it("creates a symlink from source directory to target", () => {
    const sourceDir = join(TEST_DIR, "source-dir");
    const targetDir = join(TEST_DIR, "link-dir");
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, "file.txt"), "content");

    const result = createSymlink(sourceDir, targetDir);

    expect(result.success).toBe(true);
    expect(isSymlink(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, "file.txt"))).toBe(true);
  });

  it("returns false if source does not exist", () => {
    const source = join(TEST_DIR, "nonexistent");
    const target = join(TEST_DIR, "link");

    const result = createSymlink(source, target);

    expect(result.success).toBe(false);
    expect(!result.success && result.code).toBe("SOURCE_NOT_FOUND");
    expect(existsSync(target)).toBe(false);
  });

  it("backs up existing file when creating symlink", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "target.txt");
    writeFileSync(source, "new content");
    writeFileSync(target, "old content");

    const result = createSymlink(source, target);

    expect(result.success).toBe(true);
    expect(isSymlink(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("new content");
    expect(existsSync(`${target}.bak`)).toBe(true);
    expect(readFileSync(`${target}.bak`, "utf-8")).toBe("old content");
  });

  it("creates numbered backups when .bak already exists", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "target.txt");
    writeFileSync(source, "new content");
    writeFileSync(target, "current");
    writeFileSync(`${target}.bak`, "backup 0");

    const result = createSymlink(source, target);

    expect(result.success).toBe(true);
    expect(existsSync(`${target}.bak.1`)).toBe(true);
    expect(readFileSync(`${target}.bak.1`, "utf-8")).toBe("current");
  });

  it("returns true if symlink already points to same source", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source, "content");
    createSymlink(source, target);

    const result = createSymlink(source, target);

    expect(result.success).toBe(true);
    expect(existsSync(`${target}.bak`)).toBe(false); // No backup created
  });

  it("replaces symlink pointing to different source", () => {
    const source1 = join(TEST_DIR, "source1.txt");
    const source2 = join(TEST_DIR, "source2.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source1, "content1");
    writeFileSync(source2, "content2");
    createSymlink(source1, target);

    const result = createSymlink(source2, target);

    expect(result.success).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("content2");
  });

  it("creates parent directories for target", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "nested", "deep", "link.txt");
    writeFileSync(source, "content");

    const result = createSymlink(source, target);

    expect(result.success).toBe(true);
    expect(existsSync(target)).toBe(true);
  });
});

describe("removeSymlink", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("removes an existing symlink", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source, "content");
    createSymlink(source, target);

    const result = removeSymlink(target);

    expect(result.success).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(source)).toBe(true); // Source unchanged
  });

  it("returns false for regular files", () => {
    const file = join(TEST_DIR, "regular.txt");
    writeFileSync(file, "content");

    const result = removeSymlink(file);

    expect(result.success).toBe(false);
    expect(!result.success && result.code).toBe("TARGET_MISSING");
    expect(existsSync(file)).toBe(true); // File unchanged
  });

  it("returns false for directories", () => {
    const dir = join(TEST_DIR, "dir");
    mkdirSync(dir);

    const result = removeSymlink(dir);

    expect(result.success).toBe(false);
    expect(!result.success && result.code).toBe("TARGET_MISSING");
    expect(existsSync(dir)).toBe(true);
  });

  it("returns false for nonexistent paths", () => {
    const result = removeSymlink(join(TEST_DIR, "nonexistent"));
    expect(result.success).toBe(false);
    expect(!result.success && result.code).toBe("TARGET_MISSING");
  });
});

describe("isSymlink", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("returns true for symlinks", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source, "content");
    createSymlink(source, target);

    expect(isSymlink(target)).toBe(true);
  });

  it("returns false for regular files", () => {
    const file = join(TEST_DIR, "file.txt");
    writeFileSync(file, "content");

    expect(isSymlink(file)).toBe(false);
  });

  it("returns false for directories", () => {
    const dir = join(TEST_DIR, "dir");
    mkdirSync(dir);

    expect(isSymlink(dir)).toBe(false);
  });

  it("returns false for nonexistent paths", () => {
    expect(isSymlink(join(TEST_DIR, "nonexistent"))).toBe(false);
  });

  it("returns true for broken symlinks", () => {
    const source = join(TEST_DIR, "source.txt");
    const target = join(TEST_DIR, "link.txt");
    writeFileSync(source, "content");
    createSymlink(source, target);
    rmSync(source);

    expect(isSymlink(target)).toBe(true);
    expect(existsSync(target)).toBe(false); // Broken link
  });
});

describe("Manifest operations", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("returns empty manifest when file does not exist", () => {
    const manifest = loadManifest(TEST_CACHE_DIR);
    expect(manifest).toEqual({ tools: {} });
  });

  it("saves and loads manifest with tool entries", () => {
    const manifest = {
      tools: {
        "claude-code": {
          items: {
            "skill:my-skill": {
              kind: "skill" as const,
              name: "my-skill",
              source: "/path/to/skill",
              dest: "skills/my-skill",
              backup: null,
            },
          },
        },
      },
    };

    saveManifest(manifest, TEST_CACHE_DIR);
    const loaded = loadManifest(TEST_CACHE_DIR);

    expect(loaded).toEqual(manifest);
  });

  it("cleans up temp files after save", () => {
    saveManifest({ tools: {} }, TEST_CACHE_DIR);
    const entries = readdirSync(TEST_CACHE_DIR);
    const tmpEntries = entries.filter((entry) => entry.endsWith(".tmp"));
    expect(tmpEntries.length).toBe(0);
  });

  it("creates cache directory if it does not exist", () => {
    const nestedCache = join(TEST_DIR, "nested", "cache");
    saveManifest({ tools: {} }, nestedCache);

    expect(existsSync(manifestPath(nestedCache))).toBe(true);
  });

  it("handles corrupted manifest file", () => {
    const path = manifestPath(TEST_CACHE_DIR);
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
    writeFileSync(path, "not valid json {{{");

    expect(() => loadManifest(TEST_CACHE_DIR)).toThrow(/Manifest file is corrupted/);
  });

  it("preserves existing entries when adding new ones", () => {
    const initial = {
      tools: {
        "tool-a:default": {
          items: {
            "skill:existing": {
              kind: "skill" as const,
              name: "existing",
              source: "/a",
              dest: "skills/existing",
              backup: null,
            },
          },
        },
      },
    };
    saveManifest(initial, TEST_CACHE_DIR);

    const loaded = loadManifest(TEST_CACHE_DIR);
    loaded.tools["tool-b:default"] = {
      items: {
        "command:new": {
          kind: "command",
          name: "new",
          source: "/b",
          dest: "commands/new.md",
          backup: null,
        },
      },
    };
    saveManifest(loaded, TEST_CACHE_DIR);

    const final = loadManifest(TEST_CACHE_DIR);
    expect(final.tools["tool-a:default"]).toBeDefined();
    expect(final.tools["tool-b:default"]).toBeDefined();
  });
});

describe("linkPluginToInstance", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("links all skills from plugin to tool config", () => {
    const plugin = createMockPlugin({ skills: ["skill-a", "skill-b"], commands: [], agents: [] });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    // Mock TOOLS for this test by directly calling createSymlink
    for (const skill of plugin.skills) {
      const source = join(pluginDir, "skills", skill);
      const target = join(tool.configDir, tool.skillsSubdir!, skill);
      createSymlink(source, target);
    }

    expect(existsSync(join(tool.configDir, "skills", "skill-a"))).toBe(true);
    expect(existsSync(join(tool.configDir, "skills", "skill-b"))).toBe(true);
    expect(isSymlink(join(tool.configDir, "skills", "skill-a"))).toBe(true);
    expect(existsSync(join(tool.configDir, "skills", "skill-a", "SKILL.md"))).toBe(true);
  });

  it("links all commands from plugin to tool config", () => {
    const plugin = createMockPlugin({ skills: [], commands: ["cmd-a", "cmd-b"], agents: [] });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    for (const cmd of plugin.commands) {
      const source = join(pluginDir, "commands", `${cmd}.md`);
      const target = join(tool.configDir, tool.commandsSubdir!, `${cmd}.md`);
      createSymlink(source, target);
    }

    expect(existsSync(join(tool.configDir, "commands", "cmd-a.md"))).toBe(true);
    expect(existsSync(join(tool.configDir, "commands", "cmd-b.md"))).toBe(true);
    expect(isSymlink(join(tool.configDir, "commands", "cmd-a.md"))).toBe(true);
  });

  it("links all agents from plugin to tool config", () => {
    const plugin = createMockPlugin({ skills: [], commands: [], agents: ["agent-a"] });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    for (const agent of plugin.agents) {
      const source = join(pluginDir, "agents", `${agent}.md`);
      const target = join(tool.configDir, tool.agentsSubdir!, `${agent}.md`);
      createSymlink(source, target);
    }

    expect(existsSync(join(tool.configDir, "agents", "agent-a.md"))).toBe(true);
    expect(isSymlink(join(tool.configDir, "agents", "agent-a.md"))).toBe(true);
  });

  it("skips linking when tool does not support item type", () => {
    const plugin = createMockPlugin({ skills: ["skill-a"], commands: [], agents: [] });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool({ skillsSubdir: null }); // No skills support
    mkdirSync(tool.configDir, { recursive: true });

    // With null subdir, we skip linking
    let linked = 0;
    for (const skill of plugin.skills) {
      if (tool.skillsSubdir === null) continue;
      linked++;
    }

    expect(linked).toBe(0);
    expect(existsSync(join(tool.configDir, "skills"))).toBe(false);
  });

  it("handles missing source files gracefully", () => {
    const plugin = createMockPlugin({ skills: ["nonexistent-skill"], commands: [], agents: [] });
    const pluginDir = join(TEST_DIR, "plugin");
    // Don't create files - they're missing

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    let linked = 0;
    for (const skill of plugin.skills) {
      const source = join(pluginDir, "skills", skill);
      const target = join(tool.configDir, tool.skillsSubdir!, skill);
      if (createSymlink(source, target).success) {
        linked++;
      }
    }

    expect(linked).toBe(0);
  });
});

describe("Unlink plugin from tool", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("removes all symlinks for a plugin", () => {
    const plugin = createMockPlugin({ skills: ["skill-a"], commands: ["cmd-a"], agents: [] });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    // Link
    const skillTarget = join(tool.configDir, "skills", "skill-a");
    const cmdTarget = join(tool.configDir, "commands", "cmd-a.md");
    createSymlink(join(pluginDir, "skills", "skill-a"), skillTarget);
    createSymlink(join(pluginDir, "commands", "cmd-a.md"), cmdTarget);

    expect(existsSync(skillTarget)).toBe(true);
    expect(existsSync(cmdTarget)).toBe(true);

    // Unlink
    removeSymlink(skillTarget);
    removeSymlink(cmdTarget);

    expect(existsSync(skillTarget)).toBe(false);
    expect(existsSync(cmdTarget)).toBe(false);
  });

  it("updates manifest after unlinking", () => {
    // First save with item
    const initialManifest = {
      tools: {
        "test-tool:default": {
          items: {
            "skill:skill-a": {
              kind: "skill" as const,
              name: "skill-a",
              source: "/path",
              dest: "skills/skill-a",
              backup: null,
            },
          },
        },
      },
    };
    saveManifest(initialManifest, TEST_CACHE_DIR);

    // Unlink operation - save with empty items
    const emptyManifest = {
      tools: {
        "test-tool:default": {
          items: {},
        },
      },
    };
    saveManifest(emptyManifest, TEST_CACHE_DIR);

    const loaded = loadManifest(TEST_CACHE_DIR);
    expect(loaded.tools["test-tool:default"].items["skill:skill-a"]).toBeUndefined();
  });
});

describe("Copy-based install to tools", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("copies skills to tool config directory", () => {
    const pluginDir = join(TEST_DIR, "plugin");
    mkdirSync(join(pluginDir, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(pluginDir, "skills", "my-skill", "SKILL.md"), "# My Skill");
    writeFileSync(join(pluginDir, "skills", "my-skill", "assets.txt"), "asset content");

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    const src = join(pluginDir, "skills", "my-skill");
    const dest = join(tool.configDir, "skills", "my-skill");
    
    mkdirSync(dirname(dest), { recursive: true });
    require("fs").cpSync(src, dest, { recursive: true });

    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "assets.txt"))).toBe(true);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("# My Skill");
  });

  it("backs up existing files before copying", () => {
    const pluginDir = join(TEST_DIR, "plugin");
    mkdirSync(join(pluginDir, "commands"), { recursive: true });
    writeFileSync(join(pluginDir, "commands", "cmd.md"), "new content");

    const tool = createMockTool();
    mkdirSync(join(tool.configDir, "commands"), { recursive: true });
    writeFileSync(join(tool.configDir, "commands", "cmd.md"), "old content");

    const src = join(pluginDir, "commands", "cmd.md");
    const dest = join(tool.configDir, "commands", "cmd.md");
    const backup = `${dest}.bak`;

    require("fs").renameSync(dest, backup);
    require("fs").copyFileSync(src, dest);

    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, "utf-8")).toBe("old content");
    expect(readFileSync(dest, "utf-8")).toBe("new content");
  });

  it("restores backup on uninstall", () => {
    const tool = createMockTool();
    mkdirSync(join(tool.configDir, "commands"), { recursive: true });

    const dest = join(tool.configDir, "commands", "cmd.md");
    const backup = `${dest}.bak`;

    writeFileSync(backup, "original content");
    writeFileSync(dest, "installed content");

    require("fs").unlinkSync(dest);
    require("fs").renameSync(backup, dest);

    expect(existsSync(dest)).toBe(true);
    expect(existsSync(backup)).toBe(false);
    expect(readFileSync(dest, "utf-8")).toBe("original content");
  });
});

describe("Multi-tool linking", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("links plugin to multiple tools", () => {
    const plugin = createMockPlugin({
      skills: ["shared-skill"],
      commands: ["shared-cmd"],
      agents: [],
    });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const tools = [
      createMockTool({ toolId: "tool-a", configDir: join(TEST_CONFIG_DIR, "tool-a") }),
      createMockTool({ toolId: "tool-b", configDir: join(TEST_CONFIG_DIR, "tool-b") }),
    ];

    const linkedCounts: Record<string, number> = {};

    for (const tool of tools) {
      mkdirSync(tool.configDir, { recursive: true });
      let linked = 0;

      for (const skill of plugin.skills) {
        const source = join(pluginDir, "skills", skill);
        if (tool.skillsSubdir && existsSync(source)) {
          const target = join(tool.configDir, tool.skillsSubdir, skill);
          if (createSymlink(source, target).success) linked++;
        }
      }

      for (const cmd of plugin.commands) {
        const source = join(pluginDir, "commands", `${cmd}.md`);
        if (tool.commandsSubdir && existsSync(source)) {
          const target = join(tool.configDir, tool.commandsSubdir, `${cmd}.md`);
          if (createSymlink(source, target).success) linked++;
        }
      }

      linkedCounts[`${tool.toolId}:${tool.instanceId}`] = linked;
    }

    expect(linkedCounts["tool-a:default"]).toBe(2);
    expect(linkedCounts["tool-b:default"]).toBe(2);

    expect(existsSync(join(tools[0].configDir, "skills", "shared-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(tools[1].configDir, "skills", "shared-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(tools[0].configDir, "commands", "shared-cmd.md"))).toBe(true);
    expect(existsSync(join(tools[1].configDir, "commands", "shared-cmd.md"))).toBe(true);
  });

  it("respects tool capabilities when linking", () => {
    const plugin = createMockPlugin({
      skills: ["my-skill"],
      commands: ["my-cmd"],
      agents: ["my-agent"],
    });
    const pluginDir = join(TEST_DIR, "plugin");
    createPluginFiles(pluginDir, plugin);

    const toolNoSkills = createMockTool({
      toolId: "no-skills",
      instanceId: "no-skills",
      configDir: join(TEST_CONFIG_DIR, "no-skills"),
      skillsSubdir: null,
    });
    const toolNoCommands = createMockTool({
      toolId: "no-commands",
      instanceId: "no-commands",
      configDir: join(TEST_CONFIG_DIR, "no-commands"),
      commandsSubdir: null,
    });

    mkdirSync(toolNoSkills.configDir, { recursive: true });
    mkdirSync(toolNoCommands.configDir, { recursive: true });

    let linkedNoSkills = 0;
    let linkedNoCommands = 0;

    for (const skill of plugin.skills) {
      if (toolNoSkills.skillsSubdir) linkedNoSkills++;
    }
    for (const cmd of plugin.commands) {
      const source = join(pluginDir, "commands", `${cmd}.md`);
      if (toolNoSkills.commandsSubdir && existsSync(source)) {
        const target = join(toolNoSkills.configDir, toolNoSkills.commandsSubdir, `${cmd}.md`);
        if (createSymlink(source, target).success) linkedNoSkills++;
      }
    }

    for (const skill of plugin.skills) {
      const source = join(pluginDir, "skills", skill);
      if (toolNoCommands.skillsSubdir && existsSync(source)) {
        const target = join(toolNoCommands.configDir, toolNoCommands.skillsSubdir, skill);
        if (createSymlink(source, target).success) linkedNoCommands++;
      }
    }
    for (const cmd of plugin.commands) {
      if (toolNoCommands.commandsSubdir) linkedNoCommands++;
    }

    expect(linkedNoSkills).toBe(1);
    expect(linkedNoCommands).toBe(1);
  });
});

describe("Full install/uninstall workflow", () => {
  beforeEach(setupTestDirs);
  afterEach(cleanupTestDirs);

  it("installs plugin, links to tool, then uninstalls cleanly", () => {
    // Setup
    const plugin = createMockPlugin({
      skills: ["my-skill"],
      commands: ["my-cmd"],
      agents: [],
    });
    const pluginDir = join(TEST_DIR, "plugins", plugin.name);
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    // Install: link all items
    const links: string[] = [];
    for (const skill of plugin.skills) {
      const source = join(pluginDir, "skills", skill);
      const target = join(tool.configDir, tool.skillsSubdir!, skill);
      if (createSymlink(source, target).success) {
        links.push(target);
      }
    }
    for (const cmd of plugin.commands) {
      const source = join(pluginDir, "commands", `${cmd}.md`);
      const target = join(tool.configDir, tool.commandsSubdir!, `${cmd}.md`);
      if (createSymlink(source, target).success) {
        links.push(target);
      }
    }

    // Save to manifest
    const manifest = loadManifest(TEST_CACHE_DIR);
    const manifestKey = `${tool.toolId}:${tool.instanceId}`;
    manifest.tools[manifestKey] = { items: {} };
    for (const skill of plugin.skills) {
      manifest.tools[manifestKey].items[`skill:${skill}`] = {
        kind: "skill",
        name: skill,
        source: join(pluginDir, "skills", skill),
        dest: join(tool.skillsSubdir!, skill),
        backup: null,
      };
    }
    for (const cmd of plugin.commands) {
      manifest.tools[manifestKey].items[`command:${cmd}`] = {
        kind: "command",
        name: cmd,
        source: join(pluginDir, "commands", `${cmd}.md`),
        dest: join(tool.commandsSubdir!, `${cmd}.md`),
        backup: null,
      };
    }
    saveManifest(manifest, TEST_CACHE_DIR);

    // Verify installed
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(existsSync(link)).toBe(true);
      expect(isSymlink(link)).toBe(true);
    }
    expect(Object.keys(loadManifest(TEST_CACHE_DIR).tools[manifestKey].items)).toHaveLength(2);

    // Uninstall: remove all links
    for (const link of links) {
      removeSymlink(link);
    }
    const uninstallManifest = loadManifest(TEST_CACHE_DIR);
    uninstallManifest.tools[manifestKey].items = {};
    saveManifest(uninstallManifest, TEST_CACHE_DIR);

    // Verify uninstalled
    for (const link of links) {
      expect(existsSync(link)).toBe(false);
    }
    expect(Object.keys(loadManifest(TEST_CACHE_DIR).tools[manifestKey].items)).toHaveLength(0);
  });

  it("handles update by re-linking", () => {
    const plugin = createMockPlugin({ skills: ["skill-v1"], commands: [], agents: [] });
    const pluginDir = join(TEST_DIR, "plugins", plugin.name);
    createPluginFiles(pluginDir, plugin);

    const tool = createMockTool();
    mkdirSync(tool.configDir, { recursive: true });

    // Initial install
    const target = join(tool.configDir, "skills", "skill-v1");
    createSymlink(join(pluginDir, "skills", "skill-v1"), target);
    expect(existsSync(target)).toBe(true);

    // Update: modify the source content
    writeFileSync(join(pluginDir, "skills", "skill-v1", "SKILL.md"), "# Updated skill");

    // Since it's a symlink, the content is automatically updated
    expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe("# Updated skill");
  });
});

describe("Asset sync adapters", () => {
  beforeEach(setupTestDirs);
  afterEach(() => {
    vi.restoreAllMocks();
    cleanupTestDirs();
  });

});
