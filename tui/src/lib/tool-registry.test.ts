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
    const claude = TOOL_REGISTRY["claude-code"];
    expect(claude.binaryName).toBe("claude");
    expect(claude.npmPackage).toBe("@anthropic-ai/claude-code");
    expect(claude.versionArgs).toEqual(["--version"]);
    expect(claude.defaultConfigDir.length).toBeGreaterThan(0);

    const opencode = TOOL_REGISTRY.opencode;
    expect(opencode.binaryName).toBe("opencode");
    expect(opencode.npmPackage).toBe("opencode-ai");
  });

  it("returns null for unknown tools", () => {
    expect(getToolRegistryEntry("does-not-exist")).toBeNull();
  });
});
