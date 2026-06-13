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
