/**
 * Cross-adapter conformance — every adapter passes the same baseline contract.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  scaffoldSkeleton,
  writePlaybookManifest,
  writeToolConfig,
  type ToolId,
  type ToolInstance,
} from "../playbook/index.js";
import { __resetRegistryForTests, listAdapters } from "./index.js";
import { registerAllAdapters } from "./all.js";

const ALL_TOOLS: ToolId[] = ["claude", "codex", "opencode", "amp", "pi"];

let tmp: string;

beforeEach(() => {
  __resetRegistryForTests();
  registerAllAdapters();
  tmp = mkdtempSync(join(tmpdir(), "blackbook-conformance-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  __resetRegistryForTests();
});

function makeInstance(configDir: string, name: string): ToolInstance {
  return { id: "default", name, config_dir: configDir, enabled: true };
}

describe("registerAllAdapters", () => {
  it("registers exactly the 5 bundled adapters", () => {
    expect(listAdapters().map((a) => a.defaults.toolId).sort()).toEqual(ALL_TOOLS.slice().sort());
  });

  it("each adapter has a non-empty defaultConfigDir and binary", () => {
    for (const a of listAdapters()) {
      expect(a.defaults.defaultConfigDir.length).toBeGreaterThan(0);
      expect(a.defaults.binary.length).toBeGreaterThan(0);
    }
  });
});

describe("conformance: detect on a fresh tmp HOME", () => {
  it("each adapter returns a sensible DetectionResult without throwing", async () => {
    for (const a of listAdapters()) {
      const result = await a.detect();
      expect(result.toolId).toBe(a.defaults.toolId);
      expect(typeof result.installed).toBe("boolean");
    }
  });
});

describe("conformance: scan empty config dir", () => {
  it("each adapter returns an empty inventory with no errors", async () => {
    for (const a of listAdapters()) {
      const dir = join(tmp, a.defaults.toolId);
      const inv = await a.scan(makeInstance(dir, a.defaults.displayName));
      expect(inv.toolId).toBe(a.defaults.toolId);
      expect(inv.artifacts).toEqual([]);
    }
  });
});

describe("conformance: empty-playbook preview is no-op", () => {
  it("each adapter reports zero non-no-op ops against an empty include_shared", async () => {
    for (const a of listAdapters()) {
      const pbRoot = join(tmp, `pb-${a.defaults.toolId}`);
      scaffoldSkeleton(pbRoot, [a.defaults.toolId]);
      writePlaybookManifest(pbRoot, {
        playbook_schema_version: 1,
        name: "test",
        tools_enabled: [a.defaults.toolId],
        marketplaces: {},
        required_env: [],
        defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
        settings: { package_manager: "pnpm", backup_retention: 3 },
      });
      const liveDir = join(tmp, `live-${a.defaults.toolId}`);
      writeToolConfig(pbRoot, a.defaults.toolId, {
        tool: a.defaults.toolId,
        instances: [{ id: "default", name: a.defaults.displayName, config_dir: liveDir, enabled: true }],
        include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
        overrides: { agents_md: {} },
        config_files: [],
        lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
      });

      const playbook = loadPlaybook(pbRoot);
      const instance = playbook.tools[a.defaults.toolId]!.config.instances[0];
      const diff = await a.preview(playbook, instance);
      const real = diff.ops.filter((o) => o.kind !== "no-op");
      expect(real, `${a.defaults.toolId}: should have no real ops`).toEqual([]);
    }
  });
});

describe("conformance: shared skill flows through to every tool that opts in", () => {
  it("end-to-end add for skills/commands/agents/AGENTS.md across adapters", async () => {
    for (const a of listAdapters()) {
      const pbRoot = join(tmp, `pb-${a.defaults.toolId}`);
      scaffoldSkeleton(pbRoot, [a.defaults.toolId]);
      writePlaybookManifest(pbRoot, {
        playbook_schema_version: 1,
        name: "test",
        tools_enabled: [a.defaults.toolId],
        marketplaces: {},
        required_env: [],
        defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
        settings: { package_manager: "pnpm", backup_retention: 3 },
      });
      const liveDir = join(tmp, `live-${a.defaults.toolId}`);

      // Shared content
      const skillDir = join(pbRoot, "shared", "skills", "foo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "# foo");
      writeFileSync(join(pbRoot, "shared", "commands", "cmd.md"), "# cmd");
      writeFileSync(join(pbRoot, "shared", "agents", "ag.md"), "# ag");
      writeFileSync(join(pbRoot, "shared", "AGENTS.md"), "# agents");

      writeToolConfig(pbRoot, a.defaults.toolId, {
        tool: a.defaults.toolId,
        instances: [
          { id: "default", name: a.defaults.displayName, config_dir: liveDir, enabled: true },
        ],
        include_shared: {
          agents_md: true,
          skills: ["foo"],
          commands: ["cmd"],
          agents: ["ag"],
          mcp: [],
        },
        overrides: { agents_md: {} },
        config_files: [],
        lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
      });

      const playbook = loadPlaybook(pbRoot);
      const instance = playbook.tools[a.defaults.toolId]!.config.instances[0];
      const diff = await a.preview(playbook, instance);

      // 4 expected adds: AGENTS.md, foo, cmd, ag
      const adds = diff.ops.filter((o) => o.kind === "add").map((o) => o.name).sort();
      expect(adds).toEqual(["AGENTS.md", "ag", "cmd", "foo"]);

      const result = await a.apply(diff, instance, { confirmRemovals: false, dryRun: false });
      expect(result.errors).toEqual([]);
      expect(result.performed.length).toBe(4);

      // Re-running yields all no-ops
      const diff2 = await a.preview(playbook, instance);
      expect(diff2.ops.filter((o) => o.kind !== "no-op")).toEqual([]);
    }
  });
});

describe("conformance: removal requires confirmRemovals", () => {
  it("never deletes a standalone item without confirmRemovals=true", async () => {
    const a = listAdapters().find((x) => x.defaults.toolId === "pi")!;
    const pbRoot = join(tmp, "pb");
    scaffoldSkeleton(pbRoot, ["pi"]);
    writePlaybookManifest(pbRoot, {
      playbook_schema_version: 1,
      name: "test",
      tools_enabled: ["pi"],
      marketplaces: {},
      required_env: [],
      defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
      settings: { package_manager: "pnpm", backup_retention: 3 },
    });
    const liveDir = join(tmp, "live");
    writeToolConfig(pbRoot, "pi", {
      tool: "pi",
      instances: [{ id: "default", name: "Pi", config_dir: liveDir, enabled: true }],
      // include nothing
      include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
      overrides: { agents_md: {} },
      config_files: [],
      lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
    });
    // A pre-existing standalone skill on disk that's NOT in the playbook
    mkdirSync(join(liveDir, "skills", "orphan"), { recursive: true });
    writeFileSync(join(liveDir, "skills", "orphan", "SKILL.md"), "# orphan");

    const playbook = loadPlaybook(pbRoot);
    const instance = playbook.tools.pi!.config.instances[0];
    const diff = await a.preview(playbook, instance);
    const removeOps = diff.ops.filter((o) => o.kind === "remove");
    expect(removeOps).toHaveLength(1);

    // Without confirmRemovals, removal is skipped
    const r1 = await a.apply(diff, instance, { confirmRemovals: false, dryRun: false });
    expect(r1.skipped).toEqual(removeOps);
    expect(r1.performed).toEqual([]);

    // With confirmRemovals, it deletes
    const r2 = await a.apply(diff, instance, { confirmRemovals: true, dryRun: false });
    expect(r2.performed).toEqual(removeOps);
  });
});
