import { describe, it, expect } from "vitest";
import { resolveToolFilter } from "./tool-filter.js";
import type { ToolInstance } from "../types.js";

function mkInstance(overrides: Partial<ToolInstance> = {}): ToolInstance {
  return {
    toolId: "claude-code",
    instanceId: "default",
    name: "Claude",
    configDir: "/home/.claude",
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
    ...overrides,
  };
}

describe("resolveToolFilter", () => {
  const claude = mkInstance();
  const codex = mkInstance({ toolId: "openai-codex", instanceId: "default", name: "Codex" });
  const codexSecondary = mkInstance({ toolId: "openai-codex", instanceId: "secondary", name: "Codex Secondary" });
  const instances = [claude, codex, codexSecondary];

  it("returns a null filter (no scoping) when no --tool arg is given", () => {
    const result = resolveToolFilter(undefined, instances);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filter).toBeNull();
  });

  it("matches by exact toolId, case-insensitively", () => {
    const result = resolveToolFilter("Claude-Code", instances);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filter?.matchedInstances).toEqual([claude]);
  });

  it("matches by display name, case-insensitively", () => {
    const result = resolveToolFilter("codex", instances);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both Codex instances share the display-name prefix but "Codex" only
      // exactly matches the primary instance's name.
      expect(result.filter?.matchedInstances).toEqual([codex]);
    }
  });

  it("matches multiple instances of the same tool by toolId when names differ", () => {
    const result = resolveToolFilter("openai-codex", instances);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter?.matchedInstances).toEqual([codex, codexSecondary]);
    }
  });

  it("disambiguates a specific instance via toolId:instanceId", () => {
    const result = resolveToolFilter("openai-codex:secondary", instances);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter?.matchedInstances).toEqual([codexSecondary]);
    }
  });

  it("returns a clear error listing known tools when nothing matches", () => {
    const result = resolveToolFilter("nonexistent", instances);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("nonexistent");
      expect(result.error).toContain("claude-code:default");
      expect(result.error).toContain("openai-codex:default");
    }
  });

  it("reports '(none configured)' when there are no instances at all", () => {
    const result = resolveToolFilter("anything", []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("(none configured)");
  });

  describe("predicate", () => {
    it("matches by toolId+instanceId when both are given", () => {
      const result = resolveToolFilter("openai-codex", instances);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.filter) throw new Error("expected a filter");
      expect(result.filter.predicate("openai-codex", "default")).toBe(true);
      expect(result.filter.predicate("openai-codex", "secondary")).toBe(true);
      expect(result.filter.predicate("openai-codex", "tertiary")).toBe(false);
      expect(result.filter.predicate("claude-code", "default")).toBe(false);
    });

    it("matches by toolId alone (instanceId omitted) for single-target kinds like tool/piPackage", () => {
      const result = resolveToolFilter("codex", instances);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.filter) throw new Error("expected a filter");
      expect(result.filter.predicate("openai-codex")).toBe(true);
      expect(result.filter.predicate("claude-code")).toBe(false);
    });
  });
});
