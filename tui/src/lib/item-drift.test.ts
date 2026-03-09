import { describe, expect, it, vi } from "vitest";
import { computeItemDrift } from "./item-drift.js";
import type { ManagedItem } from "./managed-item.js";

vi.mock("./plugin-drift.js", () => ({
  computePluginDrift: vi.fn(async () => ({ "skill:foo": "source-changed" })),
}));

function pluginItem(): ManagedItem {
  return {
    name: "p",
    kind: "plugin",
    marketplace: "m",
    description: "",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
    _plugin: {
      name: "p",
      marketplace: "m",
      description: "",
      source: "./p",
      skills: ["foo"],
      commands: [],
      agents: [],
      hooks: [],
      hasMcp: false,
      hasLsp: false,
      homepage: "",
      installed: true,
      scope: "user",
    },
  };
}

function fileItem(): ManagedItem {
  return {
    name: "AGENTS.md",
    kind: "file",
    marketplace: "local",
    description: "",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
    _file: {
      name: "AGENTS.md",
      source: "assets/AGENTS.md",
      target: "AGENTS.md",
      kind: "file",
      instances: [
        {
          toolId: "claude",
          instanceId: "main",
          instanceName: "Claude",
          configDir: "~/.claude",
          targetRelPath: "AGENTS.md",
          sourcePath: "/src/AGENTS.md",
          targetPath: "/home/.claude/AGENTS.md",
          status: "drifted",
          message: "",
          driftKind: "target-changed",
        },
      ],
    },
  };
}

describe("computeItemDrift", () => {
  it("computes plugin drift via plugin-drift module", async () => {
    const result = await computeItemDrift(pluginItem());
    expect(result.kind).toBe("plugin");
    if (result.kind === "plugin") {
      expect(result.plugin["skill:foo"]).toBe("source-changed");
    }
  });

  it("maps file instance drift statuses", async () => {
    const result = await computeItemDrift(fileItem());
    expect(result.kind).toBe("file");
    if (result.kind === "file") {
      expect(result.instances["claude:main"]).toBe("changed");
      expect(result.driftKinds["claude:main"]).toBe("target-changed");
    }
  });

  it("reports pi package update status", async () => {
    const result = await computeItemDrift({
      name: "pkg",
      kind: "pi-package",
      marketplace: "npm",
      description: "",
      installed: true,
      incomplete: false,
      scope: "user",
      instances: [],
      _piPackage: {
        name: "pkg",
        description: "",
        version: "1.0.0",
        source: "npm:pkg",
        sourceType: "npm",
        marketplace: "npm",
        installed: true,
        hasUpdate: true,
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      },
    });

    expect(result).toEqual({ kind: "pi-package", status: "update-available" });
  });
});
