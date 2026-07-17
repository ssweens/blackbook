import { describe, expect, it } from "vitest";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { resolveInstalledPluginComponentPath } from "./pi-bridge.js";
import type { Plugin, ToolInstance } from "./types.js";

const piInstance: Pick<ToolInstance, "toolId" | "configDir" | "skillsSubdir" | "commandsSubdir" | "agentsSubdir"> = {
  toolId: "pi",
  configDir: join(homedir(), ".pi", "agent"),
  skillsSubdir: "skills",
  commandsSubdir: "prompts",
  agentsSubdir: "agents",
};

const plugin: Pick<Plugin, "name" | "marketplace" | "installedMarketplace"> = {
  name: "crafting-interfaces",
  marketplace: "playbook",
};

describe("resolveInstalledPluginComponentPath for Pi", () => {
  it("uses namespaced temp skill paths", () => {
    expect(resolveInstalledPluginComponentPath(piInstance, plugin, "skill", "crafting-interfaces")).toBe(
      join(tmpdir(), "pi-plugins-user-skills", "crafting-interfaces"),
    );
  });

  it("uses namespaced temp prompt paths", () => {
    expect(resolveInstalledPluginComponentPath(piInstance, plugin, "command", "verdict")).toBe(
      join(tmpdir(), "pi-plugins-user-prompts", "crafting-interfaces:verdict.md"),
    );
  });

  it("uses namespaced agent paths", () => {
    expect(resolveInstalledPluginComponentPath(piInstance, plugin, "agent", "reviewer")).toBe(
      join(homedir(), ".pi", "agent", "agents", "pi-plugins-crafting-interfaces-reviewer.md"),
    );
  });

  it("elides duplicated plugin prefixes", () => {
    expect(resolveInstalledPluginComponentPath(piInstance, plugin, "command", "crafting-interfaces-verdict")).toBe(
      join(tmpdir(), "pi-plugins-user-prompts", "crafting-interfaces:verdict.md"),
    );
  });
});

describe("resolveInstalledPluginComponentPath for a non-Pi instance", () => {
  const opencodeInstance: Pick<ToolInstance, "toolId" | "configDir" | "skillsSubdir" | "commandsSubdir" | "agentsSubdir"> = {
    toolId: "opencode",
    configDir: join(homedir(), ".config", "opencode"),
    skillsSubdir: "~/.agents/skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
  };

  it("expands a tilde-prefixed manifestDest, ignoring configDir", () => {
    // Regression: manifestDest is a relative-or-absolute string stored by the
    // install writers (e.g. "~/.agents/skills/plugin/skill"); the old check
    // only recognized a leading "/" as absolute, so a "~"-prefixed dest fell
    // through to join(configDir, manifestDest) and produced a bogus nested
    // path instead of the real shared location.
    expect(
      resolveInstalledPluginComponentPath(
        opencodeInstance,
        plugin,
        "skill",
        "crafting-interfaces",
        "~/.agents/skills/crafting-interfaces/crafting-interfaces",
      ),
    ).toBe(join(homedir(), ".agents", "skills", "crafting-interfaces", "crafting-interfaces"));
  });

  it("uses an absolute manifestDest as-is, ignoring configDir", () => {
    expect(
      resolveInstalledPluginComponentPath(opencodeInstance, plugin, "skill", "crafting-interfaces", "/shared/skills/crafting-interfaces"),
    ).toBe("/shared/skills/crafting-interfaces");
  });

  it("joins a relative manifestDest onto configDir, unchanged from prior behavior", () => {
    expect(
      resolveInstalledPluginComponentPath(opencodeInstance, plugin, "command", "verdict", "commands/crafting-interfaces/verdict.md"),
    ).toBe(join(opencodeInstance.configDir, "commands", "crafting-interfaces", "verdict.md"));
  });
});
