import { describe, expect, it } from "vitest";
import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";
import type { InstalledContext } from "./types.js";

import { getAdapterForTool } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { piAdapter } from "./pi.js";
import { codexAdapter, manifestHasPluginForInstance } from "./codex.js";
import { managedAdapter, extractPluginInfoFromSource } from "./managed.js";
import { getPluginsCacheDir } from "../plugin-helpers.js";
import { join } from "path";

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "myplugin",
    marketplace: "mymarket",
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
    configDir: "/tmp/does-not-matter",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
    ...overrides,
  };
}

const NO_COMPONENTS = {
  canInstallSkills: false,
  canInstallCommands: false,
  canInstallAgents: false,
  hasHooks: false,
};

function makeCtx(overrides: Partial<InstalledContext> = {}): InstalledContext {
  return {
    getClaudeInstalledIds: () => new Set<string>(),
    getCodexInstalledIds: () => new Set<string>(),
    getManifest: () => ({ version: 1, tools: {} }) as unknown as Manifest,
    ...overrides,
  };
}

describe("getAdapterForTool registry", () => {
  it("maps each tool family to its adapter, defaulting unknown to managed", () => {
    expect(getAdapterForTool("claude-code")).toBe(claudeAdapter);
    expect(getAdapterForTool("pi")).toBe(piAdapter);
    expect(getAdapterForTool("openai-codex")).toBe(codexAdapter);
    expect(getAdapterForTool("opencode")).toBe(managedAdapter);
    expect(getAdapterForTool("amp-code")).toBe(managedAdapter);
    expect(getAdapterForTool("something-else")).toBe(managedAdapter);
  });

  it("exposes usesSource matching the native-vs-file-copy split", () => {
    expect(getAdapterForTool("claude-code").usesSource).toBe(false);
    // Pi is now a plain file-copy tool (managedAdapter-composed), same as
    // OpenCode/Amp/Codex — the bridge that made it native (usesSource:
    // false) was removed.
    expect(getAdapterForTool("pi").usesSource).toBe(true);
    expect(getAdapterForTool("openai-codex").usesSource).toBe(true);
    expect(getAdapterForTool("opencode").usesSource).toBe(true);
  });
});

describe("claudeAdapter.supports", () => {
  const instance = makeInstance({ toolId: "claude-code", name: "Claude" });

  it("is supported when a component can be installed", () => {
    const r = claudeAdapter.supports({
      plugin: makePlugin(),
      instance,
      ...NO_COMPONENTS,
      canInstallSkills: true,
    });
    expect(r.supported).toBe(true);
  });

  it("is supported for MCP/LSP/hooks-only plugins (Claude-specific)", () => {
    expect(
      claudeAdapter.supports({ plugin: makePlugin({ hasMcp: true }), instance, ...NO_COMPONENTS }).supported,
    ).toBe(true);
    expect(
      claudeAdapter.supports({ plugin: makePlugin({ hasLsp: true }), instance, ...NO_COMPONENTS }).supported,
    ).toBe(true);
    expect(
      claudeAdapter.supports({ plugin: makePlugin(), instance, ...NO_COMPONENTS, hasHooks: true }).supported,
    ).toBe(true);
  });

  it("is unsupported when nothing installable and no mcp/lsp/hooks", () => {
    const r = claudeAdapter.supports({ plugin: makePlugin(), instance, ...NO_COMPONENTS });
    expect(r.supported).toBe(false);
  });

  it("supports a skills.sh skill — Claude installs it via the component surface (derived-view symlink), not the native CLI", () => {
    const r = claudeAdapter.supports({
      plugin: makePlugin({ marketplace: "skills.sh", skills: ["s"] }),
      instance,
      ...NO_COMPONENTS,
      canInstallSkills: true,
    });
    expect(r.supported).toBe(true);
  });
});

describe("claudeAdapter.isInstalled", () => {
  const instance = makeInstance({ toolId: "claude-code", name: "Claude" });

  it("matches on the selected marketplace id", () => {
    const ctx = makeCtx({ getClaudeInstalledIds: () => new Set(["myplugin@mymarket"]) });
    expect(claudeAdapter.isInstalled(makePlugin(), instance, ctx)).toBe(true);
  });

  it("matches on the installedMarketplace id when present", () => {
    const ctx = makeCtx({ getClaudeInstalledIds: () => new Set(["myplugin@oldmarket"]) });
    const plugin = makePlugin({ installedMarketplace: "oldmarket" });
    expect(claudeAdapter.isInstalled(plugin, instance, ctx)).toBe(true);
  });

  it("returns false when neither id is present", () => {
    const ctx = makeCtx({ getClaudeInstalledIds: () => new Set(["other@mymarket"]) });
    expect(claudeAdapter.isInstalled(makePlugin(), instance, ctx)).toBe(false);
  });
});

describe("piAdapter", () => {
  const instance = makeInstance({ toolId: "pi", name: "Pi" });

  // piAdapter composes managedAdapter but overrides supports()/isInstalled()
  // with real detection, unlike OpenCode/Amp's deliberate "always blocked"
  // gate — Pi used to have real status via the bridge, and inheriting the
  // managed stub after the bridge was removed regressed it to permanently
  // unsupported/not-installed regardless of real state.
  it("is supported when a component can be installed", () => {
    const r = piAdapter.supports({
      plugin: makePlugin(),
      instance,
      ...NO_COMPONENTS,
      canInstallSkills: true,
    });
    expect(r.supported).toBe(true);
  });

  it("is unsupported when nothing installable", () => {
    const r = piAdapter.supports({ plugin: makePlugin(), instance, ...NO_COMPONENTS });
    expect(r.supported).toBe(false);
  });

  it("reports installed when the manifest records a file-copy install for this instance", () => {
    const manifest = {
      version: 1,
      tools: {
        "pi:default": {
          items: {
            "myplugin::skill::foo": {
              kind: "skill",
              name: "foo",
              source: "/src/foo",
              dest: "/home/.agents/skills/foo",
              backup: null,
              owner: "myplugin",
              previous: null,
            },
          },
        },
      },
    } as unknown as Manifest;
    const ctx = makeCtx({ getManifest: () => manifest });
    expect(piAdapter.isInstalled(makePlugin(), instance, ctx)).toBe(true);
  });

  it("reports not-installed when the manifest has no matching entry", () => {
    expect(piAdapter.isInstalled(makePlugin(), instance, makeCtx())).toBe(false);
  });
});

describe("managedAdapter (OpenCode / Amp)", () => {
  const instance = makeInstance({ toolId: "opencode" });

  it("is gated off from support with a reason", () => {
    const r = managedAdapter.supports({
      plugin: makePlugin(),
      instance,
      ...NO_COMPONENTS,
      canInstallSkills: true,
    });
    expect(r.supported).toBe(false);
    expect(r.reason).toContain("blocked");
  });

  it("reports not-installed regardless of context", () => {
    expect(managedAdapter.isInstalled(makePlugin(), instance, makeCtx())).toBe(false);
  });
});

describe("codexAdapter", () => {
  const instance = makeInstance({ toolId: "openai-codex", name: "Codex" });

  it("is always supported", () => {
    expect(
      codexAdapter.supports({ plugin: makePlugin(), instance, ...NO_COMPONENTS }).supported,
    ).toBe(true);
  });

  it("is installed when the native codex list knows it", () => {
    const ctx = makeCtx({ getCodexInstalledIds: () => new Set(["myplugin@mymarket"]) });
    expect(codexAdapter.isInstalled(makePlugin(), instance, ctx)).toBe(true);
  });

  it("is installed when only the Blackbook manifest records it (file-copy)", () => {
    const manifest = {
      version: 1,
      tools: {
        "openai-codex:default": {
          items: {
            "myplugin::skill::foo": {
              kind: "skill",
              name: "foo",
              source: "/src/foo",
              dest: "skills/foo",
              backup: null,
              owner: "myplugin",
              previous: null,
            },
          },
        },
      },
    } as unknown as Manifest;
    const ctx = makeCtx({
      getCodexInstalledIds: () => new Set<string>(),
      getManifest: () => manifest,
    });
    expect(codexAdapter.isInstalled(makePlugin(), instance, ctx)).toBe(true);
  });

  it("is not installed when neither native nor manifest knows it", () => {
    expect(codexAdapter.isInstalled(makePlugin(), instance, makeCtx())).toBe(false);
  });

  it("shares the managed file-copy lifecycle (usesSource true)", () => {
    expect(codexAdapter.usesSource).toBe(true);
  });
});

describe("pure helpers", () => {
  it("extractPluginInfoFromSource parses the Blackbook cache layout", () => {
    const src = join(getPluginsCacheDir(), "mymarket", "myplugin", "skills", "foo");
    expect(extractPluginInfoFromSource(src)).toEqual({
      marketplace: "mymarket",
      pluginName: "myplugin",
    });
  });

  it("extractPluginInfoFromSource parses the Claude cache layout", () => {
    const src = "/home/u/.claude/plugins/cache/othermarket/otherplugin/1.0.0/skills/x";
    expect(extractPluginInfoFromSource(src)).toEqual({
      marketplace: "othermarket",
      pluginName: "otherplugin",
    });
  });

  it("extractPluginInfoFromSource returns null for unknown paths", () => {
    expect(extractPluginInfoFromSource("/some/random/path")).toBeNull();
  });

  it("manifestHasPluginForInstance checks both bare and instance-scoped keys", () => {
    const instance = makeInstance({ toolId: "openai-codex", instanceId: "default" });
    const withBareKey = {
      version: 1,
      tools: {
        "openai-codex": { items: { k: { owner: "myplugin" } } },
      },
    } as unknown as Manifest;
    expect(manifestHasPluginForInstance(withBareKey, instance, "myplugin")).toBe(true);
    expect(manifestHasPluginForInstance(withBareKey, instance, "nope")).toBe(false);

    const withScopedKey = {
      version: 1,
      tools: {
        "openai-codex:default": { items: { k: { owner: "myplugin" } } },
      },
    } as unknown as Manifest;
    expect(manifestHasPluginForInstance(withScopedKey, instance, "myplugin")).toBe(true);
  });
});
