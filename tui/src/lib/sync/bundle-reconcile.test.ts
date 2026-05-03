/**
 * Bundle reconciliation tests — verify the engine drives installBundle /
 * uninstallBundle correctly without shelling out (we use stub adapters).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistryForTests, registerAdapter } from "../adapters/index.js";
import type { ToolAdapter } from "../adapters/types.js";
import { piAdapter } from "../adapters/pi/index.js";
import {
  loadPlaybook,
  scaffoldSkeleton,
  writePackagesManifest,
  writePlaybookManifest,
  writeToolConfig,
  type BundleEntry,
  type Inventory,
  type ToolInstance,
} from "../playbook/index.js";
import { engineApply } from "./engine.js";

let tmp: string;

beforeEach(() => {
  __resetRegistryForTests();
  tmp = mkdtempSync(join(tmpdir(), "blackbook-bundle-test-"));
});
afterEach(() => {
  __resetRegistryForTests();
  rmSync(tmp, { recursive: true, force: true });
});

interface InstallTrack {
  installed: BundleEntry[];
  uninstalled: string[];
}

/** Build a Pi-like adapter that stubs install/uninstall and uses a controlled scan. */
function stubPiAdapter(track: InstallTrack, alreadyInstalled: string[]): ToolAdapter {
  return {
    ...piAdapter,
    async detect() {
      return {
        toolId: "pi",
        installed: true,
        version: "test",
        binaryPath: "/usr/bin/test",
        configDir: "/dummy",
      };
    },
    async scan(instance: ToolInstance): Promise<Inventory> {
      // Return one bundle-owned skill per "alreadyInstalled" name, so the
      // engine sees it as installed.
      const artifacts = alreadyInstalled.map((name) => ({
        name: `${name}-skill`,
        type: "skill" as const,
        diskPath: `/fake/${name}/skill`,
        provenance: { kind: "bundle" as const, bundleName: name },
      }));
      return {
        toolId: "pi",
        instanceId: instance.id,
        configDir: instance.config_dir,
        artifacts,
      };
    },
    async installBundle(ref) {
      track.installed.push(ref);
    },
    async uninstallBundle(name) {
      track.uninstalled.push(name);
    },
  };
}

function buildPiPlaybook(opts: { liveDir: string; packages: BundleEntry[] }) {
  const pbRoot = join(tmp, "pb");
  scaffoldSkeleton(pbRoot, ["pi"]);
  writePlaybookManifest(pbRoot, {
    playbook_schema_version: 1,
    name: "t",
    tools_enabled: ["pi"],
    marketplaces: {},
    required_env: [],
    defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
    settings: { package_manager: "pnpm", backup_retention: 3 },
  });
  writeToolConfig(pbRoot, "pi", {
    tool: "pi",
    instances: [{ id: "default", name: "Pi", config_dir: opts.liveDir, enabled: true }],
    include_shared: { agents_md: false, skills: [], commands: [], agents: [], mcp: [] },
    overrides: { agents_md: {} },
    config_files: [],
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
  });
  writePackagesManifest(pbRoot, "pi", { schema: 1, packages: opts.packages });
  return loadPlaybook(pbRoot);
}

const SAMPLE_BUNDLE: BundleEntry = {
  name: "pi-mcp-adapter",
  source: { type: "npm", package: "pi-mcp-adapter" },
  enabled: true,
  disabled_components: { skills: [], commands: [], agents: [] },
};

const SAMPLE_GIT: BundleEntry = {
  name: "tools",
  source: { type: "git", url: "github.com/me/tools", ref: "v1" },
  enabled: true,
  disabled_components: { skills: [], commands: [], agents: [] },
};

// ─────────────────────────────────────────────────────────────────────────────

describe("engine — bundle reconciliation (stubbed adapter)", () => {
  it("installs missing enabled bundles", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, []));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_BUNDLE] });

    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(track.installed).toHaveLength(1);
    expect(track.installed[0].name).toBe("pi-mcp-adapter");
    expect(result.perInstance[0].bundleOps[0]).toMatchObject({
      name: "pi-mcp-adapter",
      op: "install",
      ok: true,
    });
  });

  it("skips already-installed bundles", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, ["pi-mcp-adapter"]));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_BUNDLE] });

    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(track.installed).toEqual([]);
    expect(result.perInstance[0].bundleOps[0]).toMatchObject({
      name: "pi-mcp-adapter",
      op: "skip",
      reason: "already installed",
    });
  });

  it("dry-run does not install bundles", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, []));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_BUNDLE] });

    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: true });
    expect(track.installed).toEqual([]);
    expect(result.perInstance[0].bundleOps).toEqual([]);
  });

  it("skipBundles=true bypasses bundle ops entirely", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, []));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_BUNDLE] });

    const result = await engineApply(playbook, {
      confirmRemovals: false,
      dryRun: false,
      skipBundles: true,
    });
    expect(track.installed).toEqual([]);
    expect(result.perInstance[0].bundleOps).toEqual([]);
  });

  it("uninstalls bundles installed but absent from playbook (with confirmRemovals)", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    // Already on disk but not declared in playbook
    registerAdapter(stubPiAdapter(track, ["legacy-pkg"]));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [] });

    const result = await engineApply(playbook, { confirmRemovals: true, dryRun: false });
    expect(track.uninstalled).toEqual(["legacy-pkg"]);
    expect(result.perInstance[0].bundleOps[0]).toMatchObject({
      name: "legacy-pkg",
      op: "uninstall",
      ok: true,
    });
  });

  it("does NOT uninstall absent bundles without confirmRemovals", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, ["legacy-pkg"]));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [] });

    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(track.uninstalled).toEqual([]);
    expect(result.perInstance[0].bundleOps[0]).toMatchObject({
      op: "skip",
      reason: expect.stringContaining("absent from playbook"),
    });
  });

  it("uninstalls disabled bundles (confirmRemovals=true)", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, ["pi-mcp-adapter"]));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const disabled: BundleEntry = { ...SAMPLE_BUNDLE, enabled: false };
    const playbook = buildPiPlaybook({ liveDir, packages: [disabled] });

    const result = await engineApply(playbook, { confirmRemovals: true, dryRun: false });
    expect(track.uninstalled).toEqual(["pi-mcp-adapter"]);
    expect(result.perInstance[0].bundleOps[0].op).toBe("uninstall");
  });

  it("git source installs", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    registerAdapter(stubPiAdapter(track, []));

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_GIT] });

    await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(track.installed[0].source).toEqual({
      type: "git",
      url: "github.com/me/tools",
      ref: "v1",
    });
  });

  it("install errors surface as ops with ok=false and instance-level error", async () => {
    const track: InstallTrack = { installed: [], uninstalled: [] };
    const stub = stubPiAdapter(track, []);
    const failing: ToolAdapter = {
      ...stub,
      async installBundle() {
        throw new Error("simulated install failure");
      },
    };
    registerAdapter(failing);

    const liveDir = join(tmp, "live");
    mkdirSync(liveDir, { recursive: true });
    const playbook = buildPiPlaybook({ liveDir, packages: [SAMPLE_BUNDLE] });

    const result = await engineApply(playbook, { confirmRemovals: false, dryRun: false });
    expect(result.perInstance[0].bundleOps[0]).toMatchObject({
      op: "install",
      ok: false,
      reason: expect.stringContaining("simulated install failure"),
    });
    expect(result.perInstance[0].errors.some((e) => e.message.includes("simulated"))).toBe(true);
  });
});

describe("bundleSourceToPiRef", () => {
  it("emits npm:pkg form", async () => {
    const { bundleSourceToPiRef } = await import("../adapters/pi/bundle-ops.js");
    expect(bundleSourceToPiRef({ type: "npm", package: "ce-compound" })).toBe("npm:ce-compound");
    expect(
      bundleSourceToPiRef({ type: "npm", package: "ce-compound" }, "1.2.3"),
    ).toBe("npm:ce-compound@1.2.3");
  });

  it("emits git: form", async () => {
    const { bundleSourceToPiRef } = await import("../adapters/pi/bundle-ops.js");
    expect(
      bundleSourceToPiRef({ type: "git", url: "github.com/me/x", ref: "v1" }),
    ).toBe("git:github.com/me/x@v1");
    expect(
      bundleSourceToPiRef({ type: "git", url: "github.com/me/x" }, "main"),
    ).toBe("git:github.com/me/x@main");
  });

  it("returns undefined for marketplace and local", async () => {
    const { bundleSourceToPiRef } = await import("../adapters/pi/bundle-ops.js");
    expect(
      bundleSourceToPiRef({ type: "marketplace", marketplace: "x", plugin: "y" }),
    ).toBeUndefined();
    expect(bundleSourceToPiRef({ type: "local", path: "./x" })).toBeUndefined();
  });
});

// Suppress unused import warning
void writeFileSync;
