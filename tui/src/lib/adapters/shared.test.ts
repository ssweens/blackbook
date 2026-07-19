import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { pluginSkillPresentForInstance, pluginInstalledForManagedInstance } from "./shared.js";
import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";

// agentsSkillsDir resolves against the real homedir(), so sandbox HOME.
const ORIGINAL_HOME = process.env.HOME;
let home: string;

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "myplugin",
    marketplace: "mkt",
    description: "",
    source: "",
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

function makeInstance(overrides: Partial<ToolInstance> = {}): ToolInstance {
  return {
    toolId: "opencode",
    instanceId: "default",
    name: "OpenCode",
    configDir: join(home, ".config", "opencode"),
    skillsSubdir: "~/.agents/skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
    ...overrides,
  };
}

const EMPTY_MANIFEST = { version: 1, tools: {} } as unknown as Manifest;

function writeStoreSkill(namespace: string | null, name: string): void {
  const dir = namespace
    ? join(home, ".agents", "skills", namespace, name)
    : join(home, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `# ${name}\n`);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "bb-shared-"));
  process.env.HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

describe("pluginSkillPresentForInstance", () => {
  it("finds a namespaced plugin-component skill in the shared store", () => {
    writeStoreSkill("myplugin", "myskill");
    const plugin = makePlugin({ skills: ["myskill"] });
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(true);
  });

  it("finds a flat/standalone skill of the same name (skill installed standalone, not as a component)", () => {
    // e.g. crafting-interfaces: the plugin's skill lives at the top level.
    writeStoreSkill(null, "crafting-interfaces");
    const plugin = makePlugin({ name: "crafting-interfaces", skills: ["crafting-interfaces"] });
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(true);
  });

  it("returns false when the skill is absent from the store", () => {
    const plugin = makePlugin({ skills: ["missing"] });
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(false);
  });

  it("requires ALL of a multi-skill plugin's skills to be present", () => {
    writeStoreSkill("myplugin", "a");
    const plugin = makePlugin({ skills: ["a", "b"] });
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(false);
    writeStoreSkill("myplugin", "b");
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(true);
  });

  it("checks the Claude overlay (flat prefixed name or bare name) for flat-install tools", () => {
    const claudeConfig = join(home, ".claude");
    const skillsDir = join(claudeConfig, "skills");
    mkdirSync(join(skillsDir, "myplugin-myskill"), { recursive: true });
    writeFileSync(join(skillsDir, "myplugin-myskill", "SKILL.md"), "# myskill\n");

    const claude = makeInstance({
      toolId: "claude-code",
      configDir: claudeConfig,
      skillsSubdir: "skills",
      pluginFlatInstall: true,
    });
    const plugin = makePlugin({ skills: ["myskill"] });
    expect(pluginSkillPresentForInstance(plugin, claude)).toBe(true);
  });

  it("returns false for a plugin with no skills", () => {
    const plugin = makePlugin({ skills: [], commands: ["c"] });
    expect(pluginSkillPresentForInstance(plugin, makeInstance())).toBe(false);
  });
});

describe("pluginInstalledForManagedInstance", () => {
  it("true via the shared store even with no per-tool manifest entry (skills-only plugin)", () => {
    writeStoreSkill("myplugin", "myskill");
    const plugin = makePlugin({ skills: ["myskill"] });
    expect(pluginInstalledForManagedInstance(plugin, makeInstance(), EMPTY_MANIFEST)).toBe(true);
  });

  it("true via a per-tool manifest entry (command/agent into the tool's own dir)", () => {
    const manifest = {
      version: 1,
      tools: {
        "opencode:default": {
          items: { "myplugin::command::c": { kind: "command", name: "c", owner: "myplugin" } },
        },
      },
    } as unknown as Manifest;
    const plugin = makePlugin({ commands: ["c"] });
    expect(pluginInstalledForManagedInstance(plugin, makeInstance(), manifest)).toBe(true);
  });

  it("false when neither the store nor the manifest has it", () => {
    const plugin = makePlugin({ skills: ["nope"] });
    expect(pluginInstalledForManagedInstance(plugin, makeInstance(), EMPTY_MANIFEST)).toBe(false);
  });
});
