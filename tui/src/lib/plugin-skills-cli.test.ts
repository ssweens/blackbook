import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Plugin, ToolInstance } from "./types.js";

vi.mock("./config.js", async (orig) => ({
  ...(await orig<typeof import("./config.js")>()),
  parseMarketplaces: () => marketplacesMock,
}));
let marketplacesMock: Array<{ name: string; url: string }> = [];

const {
  installPluginSkillsViaCli,
  installStandaloneSkillViaCli,
  pluginSkillNames,
  pluginSkillsSource,
  removePluginSkillsViaCli,
  removeSkillViaCli,
} = await import("./plugin-skills-cli.js");

function plugin(over: Partial<Plugin> = {}): Plugin {
  return { name: "demo", marketplace: "mkt", source: "./plugins/demo", skills: [], commands: [], agents: [], ...over } as Plugin;
}

function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`);
}

let root: string;
const saved = { ...process.env };
function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
}


beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bb-plugin-skills-"));
  marketplacesMock = [];
});
afterEach(() => {
  restoreEnv(saved);
  rmSync(root, { recursive: true, force: true });
});

describe("pluginSkillNames", () => {
  it("uses frontmatter names, allows one nesting level, and honors plugin.skills", () => {
    const src = join(root, "p");
    writeSkill(join(src, "skills", "alpha-dir"), "alpha");
    writeSkill(join(src, "skills", "group", "beta"), "beta");
    expect(pluginSkillNames(plugin(), src)).toEqual(["alpha", "beta"]);
    expect(pluginSkillNames(plugin({ skills: ["alpha-dir"] }), src)).toEqual(["alpha"]);
    expect(pluginSkillNames(plugin({ skills: ["x"] }), null)).toEqual(["x"]);
  });
});

describe("pluginSkillsSource", () => {
  it("maps GitHub plugin sources and remote marketplaces to scoped github: sources", () => {
    expect(pluginSkillsSource(plugin({ source: { source: "github", repo: "acme/tools" } }))).toEqual({ source: "github:acme/tools" });
    expect(
      pluginSkillsSource(plugin(), "https://raw.githubusercontent.com/ssweens/playbook/main/.claude-plugin/marketplace.json"),
    ).toEqual({ source: "github:ssweens/playbook/plugins/demo" });
  });

  it("resolves a local marketplace checkout to its GitHub remote, or its path without one", () => {
    const repo = join(root, "playbook");
    mkdirSync(join(repo, "plugins", "demo"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    marketplacesMock = [{ name: "mkt", url: repo }];
    expect(pluginSkillsSource(plugin())?.source).toBe(join(repo, "plugins", "demo"));
    execFileSync("git", ["remote", "add", "origin", "git@github.com:ssweens/playbook.git"], { cwd: repo });
    expect(pluginSkillsSource(plugin())).toEqual({ source: "github:ssweens/playbook/plugins/demo" });
  });
});

describe("skills CLI round trip (isolated HOME)", () => {
  function isolate(): { home: string; claudeLearning: string; instances: ToolInstance[] } {
    const home = join(root, "home");
    const claudeLearning = join(home, ".claude-learning");
    mkdirSync(join(home, ".claude"), { recursive: true });
    // A detected universal agent keeps ~/.agents/skills links alive when one
    // Claude instance removes its own link (upstream "still used" check).
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(claudeLearning, { recursive: true });
    process.env.HOME = home;
    process.env.XDG_DATA_HOME = join(root, "data");
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.BLACKBOOK_SKILLS_CLI = "1";
    const inst = (toolId: string, configDir: string, id = "default") =>
      ({ toolId, instanceId: id, name: toolId, configDir, enabled: true, kind: "tool" }) as ToolInstance;
    return {
      home,
      claudeLearning,
      instances: [inst("openai-codex", join(home, ".codex")), inst("claude-code", join(home, ".claude")), inst("claude-code", claudeLearning, "learning")],
    };
  }

  it("installs a plugin's skills into the store for universal agents and every Claude instance, then removes them", () => {
    const { home, claudeLearning, instances } = isolate();
    const repo = join(root, "market");
    writeSkill(join(repo, "plugins", "demo", "skills", "alpha"), "alpha");
    writeSkill(join(repo, "skills", "alpha-elsewhere"), "unrelated");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    marketplacesMock = [{ name: "mkt", url: repo }];
    const src = join(repo, "plugins", "demo");

    expect(installPluginSkillsViaCli(plugin(), src, instances)).toEqual([]);
    const store = join(root, "data", "blackbook", "skills");
    for (const link of [join(home, ".agents/skills/alpha"), join(home, ".claude/skills/alpha"), join(claudeLearning, "skills/alpha")]) {
      expect(lstatSync(link).isSymbolicLink(), link).toBe(true);
      expect(readlinkSync(link).startsWith(store), link).toBe(true);
    }
    // Scoped to the plugin's folder: the repo's other skill was not installed.
    expect(existsSync(join(home, ".agents/skills/unrelated"))).toBe(false);
    // Local-path source: the store namespace is local/<abs path>, one shared copy.
    expect(readlinkSync(join(home, ".agents/skills/alpha"))).toBe(join(store, "local", ...src.split("/").filter(Boolean), "alpha"));

    expect(removePluginSkillsViaCli(plugin(), src, instances, { everywhere: true })).toEqual([]);
    for (const link of [join(home, ".agents/skills/alpha"), join(home, ".claude/skills/alpha"), join(claudeLearning, "skills/alpha")]) {
      expect(existsSync(link) || (() => { try { lstatSync(link); return true; } catch { return false; } })(), link).toBe(false);
    }
  }, 120_000);

  it("standalone: falls back (null) without a GitHub remote; removal per Claude instance leaves others", () => {
    const { home, claudeLearning, instances } = isolate();
    const repo = join(root, "playbook");
    writeSkill(join(repo, "skills", "beta"), "beta");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    expect(installStandaloneSkillViaCli(join(repo, "skills", "beta"), repo, instances[0])).toBeNull();

    // Install via a local plugin source to get CLI-managed links, then remove from one Claude instance only.
    marketplacesMock = [{ name: "mkt", url: repo }];
    writeSkill(join(repo, "plugins", "demo", "skills", "gamma"), "gamma");
    installPluginSkillsViaCli(plugin(), join(repo, "plugins", "demo"), instances);
    expect(removeSkillViaCli("gamma", instances[2])).toBe(true);
    expect(existsSync(join(claudeLearning, "skills/gamma"))).toBe(false);
    expect(lstatSync(join(home, ".claude/skills/gamma")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(home, ".agents/skills/gamma")).isSymbolicLink()).toBe(true);
  }, 120_000);

  it("is a no-op when disabled", () => {
    isolate();
    process.env.BLACKBOOK_SKILLS_CLI = "0";
    expect(installPluginSkillsViaCli(plugin(), null, [])).toEqual([]);
    expect(installStandaloneSkillViaCli(root, root, { toolId: "claude-code" } as ToolInstance)).toBeNull();
    expect(removeSkillViaCli("x", null, [])).toBe(false);
  });
});
