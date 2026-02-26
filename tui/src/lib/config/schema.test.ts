import { describe, it, expect } from "vitest";
import { ConfigSchema, FileEntrySchema, ToolInstanceSchema, SettingsSchema, PluginComponentSchema } from "./schema.js";

describe("ConfigSchema", () => {
  it("accepts empty object and fills defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.settings.package_manager).toBe("pnpm");
    expect(result.marketplaces).toEqual({});
    expect(result.tools).toEqual({});
    expect(result.files).toEqual([]);
    expect(result.plugins).toEqual({});
  });

  it("accepts a full config", () => {
    const input = {
      settings: { source_repo: "~/src/playbook/config", package_manager: "bun" },
      marketplaces: { playbook: "https://example.com/marketplace.json" },
      tools: {
        "claude-code": [
          { id: "default", name: "Claude", config_dir: "~/.claude" },
        ],
      },
      files: [
        { name: "AGENTS.md", source: "AGENTS.md", target: "AGENTS.md" },
        { name: "Settings", source: "settings.json", target: "settings.json", tools: ["claude-code"], pullback: true },
      ],
      plugins: {
        playbook: {
          "my-plugin": { disabled_skills: ["a", "b"] },
        },
      },
    };
    const result = ConfigSchema.parse(input);
    expect(result.settings.source_repo).toBe("~/src/playbook/config");
    expect(result.settings.package_manager).toBe("bun");
    expect(result.tools["claude-code"]).toHaveLength(1);
    expect(result.tools["claude-code"][0].enabled).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files[1].pullback).toBe(true);
    expect(result.files[1].tools).toEqual(["claude-code"]);
    expect(result.plugins.playbook["my-plugin"].disabled_skills).toEqual(["a", "b"]);
  });

  it("rejects invalid package_manager", () => {
    const result = ConfigSchema.safeParse({
      settings: { package_manager: "yarn" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects file entry with empty name", () => {
    const result = FileEntrySchema.safeParse({
      name: "",
      source: "test.md",
      target: "test.md",
    });
    expect(result.success).toBe(false);
  });

  it("rejects file entry missing required fields", () => {
    const result = FileEntrySchema.safeParse({ name: "test" });
    expect(result.success).toBe(false);
  });
});

describe("ToolInstanceSchema", () => {
  it("defaults id to 'default' and enabled to true", () => {
    const result = ToolInstanceSchema.parse({ name: "Claude", config_dir: "~/.claude" });
    expect(result.id).toBe("default");
    expect(result.enabled).toBe(true);
  });

  it("rejects empty name", () => {
    const result = ToolInstanceSchema.safeParse({ name: "", config_dir: "~/.claude" });
    expect(result.success).toBe(false);
  });
});

describe("SettingsSchema", () => {
  it("defaults package_manager to pnpm", () => {
    const result = SettingsSchema.parse({});
    expect(result.package_manager).toBe("pnpm");
  });

  it("accepts optional source_repo", () => {
    const result = SettingsSchema.parse({ source_repo: "~/dotfiles" });
    expect(result.source_repo).toBe("~/dotfiles");
  });
});

describe("PluginComponentSchema", () => {
  it("defaults arrays to empty", () => {
    const result = PluginComponentSchema.parse({});
    expect(result.disabled_skills).toEqual([]);
    expect(result.disabled_commands).toEqual([]);
    expect(result.disabled_agents).toEqual([]);
  });
});
