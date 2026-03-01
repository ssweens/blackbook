import { describe, it, expect, afterEach } from "vitest";
import {
  loadPlaybook,
  getAllPlaybooks,
  resolveToolInstances,
  isSyncTarget,
  getPlaybookMetadata,
  clearPlaybookCache,
  getBuiltinToolIds,
} from "./playbooks.js";
import type { BlackbookConfig } from "./schema.js";
import { ConfigSchema } from "./schema.js";

afterEach(() => {
  clearPlaybookCache();
});

describe("loadPlaybook", () => {
  it("loads claude-code playbook", () => {
    const pb = loadPlaybook("claude-code");
    expect(pb).not.toBeNull();
    expect(pb!.id).toBe("claude-code");
    expect(pb!.name).toBe("Claude Code");
    expect(pb!.default_instances).toHaveLength(1);
    expect(pb!.default_instances[0].config_dir).toBe("~/.claude");
    expect(pb!.syncable).toBe(true);
  });

  it("loads blackbook playbook (non-syncable)", () => {
    const pb = loadPlaybook("blackbook");
    expect(pb).not.toBeNull();
    expect(pb!.syncable).toBe(false);
  });

  it("returns null for unknown tool", () => {
    expect(loadPlaybook("nonexistent-tool")).toBeNull();
  });
});

describe("getAllPlaybooks", () => {
  it("loads all 6 built-in playbooks", () => {
    const playbooks = getAllPlaybooks();
    expect(playbooks.size).toBe(6);
    for (const toolId of getBuiltinToolIds()) {
      expect(playbooks.has(toolId)).toBe(true);
    }
  });

  it("all playbooks validate against schema", () => {
    const playbooks = getAllPlaybooks();
    for (const [, pb] of playbooks) {
      expect(pb.id).toBeTruthy();
      expect(pb.name).toBeTruthy();
      expect(pb.default_instances.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("resolveToolInstances", () => {
  it("uses playbook defaults when config has no tool entries", () => {
    const config = ConfigSchema.parse({});
    const playbooks = getAllPlaybooks();
    const resolved = resolveToolInstances(config, playbooks);

    const claudeInstances = resolved.get("claude-code");
    expect(claudeInstances).toBeDefined();
    expect(claudeInstances!.length).toBe(1);
    expect(claudeInstances![0].name).toBe("Claude");
  });

  it("config instances override playbook defaults", () => {
    const config = ConfigSchema.parse({
      tools: {
        "claude-code": [
          { id: "custom", name: "My Claude", config_dir: "~/custom/.claude" },
          { id: "work", name: "Work Claude", config_dir: "~/work/.claude" },
        ],
      },
    });
    const playbooks = getAllPlaybooks();
    const resolved = resolveToolInstances(config, playbooks);

    const claudeInstances = resolved.get("claude-code");
    expect(claudeInstances).toBeDefined();
    expect(claudeInstances!.length).toBe(2);
    expect(claudeInstances![0].name).toBe("My Claude");
    expect(claudeInstances![1].name).toBe("Work Claude");
  });
});

describe("isSyncTarget", () => {
  it("returns true for syncable tools", () => {
    expect(isSyncTarget("claude-code")).toBe(true);
    expect(isSyncTarget("opencode")).toBe(true);
    expect(isSyncTarget("pi")).toBe(true);
  });

  it("returns false for config-only tools", () => {
    expect(isSyncTarget("blackbook")).toBe(false);
  });

  it("returns false for unknown tools", () => {
    expect(isSyncTarget("nonexistent")).toBe(false);
  });
});

describe("getPlaybookMetadata", () => {
  it("returns metadata for known config files", () => {
    const meta = getPlaybookMetadata("claude-code", "settings.json");
    expect(meta).not.toBeNull();
    expect(meta!.format).toBe("json");
  });

  it("returns metadata for CLAUDE.md", () => {
    const meta = getPlaybookMetadata("claude-code", "CLAUDE.md");
    expect(meta).not.toBeNull();
  });

  it("returns null for unknown paths", () => {
    const meta = getPlaybookMetadata("claude-code", "unknown.txt");
    expect(meta).toBeNull();
  });

  it("returns null for unknown tools", () => {
    const meta = getPlaybookMetadata("nonexistent", "settings.json");
    expect(meta).toBeNull();
  });
});
