import { describe, it, expect } from "vitest";
import { TOOL_REGISTRY, getToolRegistryEntry } from "./tool-registry.js";

describe("tool registry", () => {
  it("contains all default tools", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([
      "amp-code",
      "claude-code",
      "openai-codex",
      "opencode",
      "pi",
    ]);
  });

  it("provides required metadata", () => {
    const entry = TOOL_REGISTRY["claude-code"];
    expect(entry.binaryName).toBe("claude");
    expect(entry.npmPackage).toBe("@anthropic-ai/claude-code");
    expect(entry.versionArgs).toEqual(["--version"]);
    expect(entry.defaultConfigDir.length).toBeGreaterThan(0);
  });

  it("returns null for unknown tools", () => {
    expect(getToolRegistryEntry("does-not-exist")).toBeNull();
  });
});
