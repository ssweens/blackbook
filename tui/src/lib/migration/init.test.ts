/**
 * Cold-start init tests.
 *
 * `blackbookInit` calls every registered adapter's detect() — to make these
 * tests deterministic we register only adapters whose detect() we control via
 * the configDirOverride mechanism, and we replace the binary detection by
 * pointing the config dir at controlled fixtures (the adapters used in tests
 * are pure-FS for scan; detect's binary check returns installed=false for
 * non-existent binaries, so we'd skip them — solution: stub detect via a
 * test-local adapter that wraps the real one).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistryForTests, listAdapters, registerAdapter } from "../adapters/index.js";
import { ampAdapter } from "../adapters/amp/index.js";
import { claudeAdapter } from "../adapters/claude/index.js";
import { piAdapter } from "../adapters/pi/index.js";
import type { ToolAdapter } from "../adapters/types.js";
import { loadPlaybook } from "../playbook/index.js";
import { blackbookInit } from "./init.js";

let tmp: string;
beforeEach(() => {
  __resetRegistryForTests();
  tmp = mkdtempSync(join(tmpdir(), "blackbook-init-test-"));
});
afterEach(() => {
  __resetRegistryForTests();
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Wrap a real adapter so that detect() reports installed=true regardless of
 * the local environment. All other methods pass through to the real adapter.
 */
function alwaysInstalled(real: ToolAdapter): ToolAdapter {
  return {
    ...real,
    async detect() {
      return {
        toolId: real.defaults.toolId,
        installed: true,
        version: "test",
        binaryPath: "/usr/bin/test",
        configDir: real.defaults.defaultConfigDir,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("blackbookInit — basic", () => {
  it("scaffolds a minimal playbook from one detected tool", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter));

    const claudeDir = join(tmp, "claude-config");
    mkdirSync(join(claudeDir, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "my-skill", "SKILL.md"), "# my-skill");

    const target = join(tmp, "playbook");
    const result = await blackbookInit({
      targetPath: target,
      configDirOverride: { claude: claudeDir },
    });

    expect(result.toolsScanned).toEqual(["claude"]);
    expect(result.toolsSkipped).toEqual([]);

    // Materialized files
    expect(readFileSync(join(target, "playbook.yaml"), "utf-8")).toContain("tools_enabled");
    expect(
      readFileSync(join(target, "tools/claude/skills/my-skill/SKILL.md"), "utf-8"),
    ).toBe("# my-skill");

    // Loadable
    const playbook = loadPlaybook(target);
    expect(playbook.manifest.tools_enabled).toEqual(["claude"]);
    expect(playbook.tools.claude?.standalone.skills.map((s) => s.name)).toEqual(["my-skill"]);
  });

  it("aborts when target dir is non-empty", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter));
    const target = join(tmp, "playbook");
    mkdirSync(target);
    writeFileSync(join(target, "stale"), "x");
    await expect(
      blackbookInit({
        targetPath: target,
        configDirOverride: { claude: join(tmp, "missing") },
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("skips tools whose binaries are not detected", async () => {
    // Stub detect to return installed=false; pass-through everything else.
    const notInstalled: ToolAdapter = {
      ...claudeAdapter,
      async detect() {
        return { toolId: "claude", installed: false };
      },
    };
    registerAdapter(notInstalled);

    const target = join(tmp, "playbook");
    const result = await blackbookInit({ targetPath: target });
    expect(result.toolsScanned).toEqual([]);
    expect(result.toolsSkipped.map((s) => s.toolId)).toEqual(["claude"]);
  });
});

describe("blackbookInit — cross-tool dedup", () => {
  it("auto-shares a byte-identical skill across two tools", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter));
    registerAdapter(alwaysInstalled(ampAdapter));

    const claudeDir = join(tmp, "claude-config");
    const ampDir = join(tmp, "amp-config");
    for (const dir of [claudeDir, ampDir]) {
      mkdirSync(join(dir, "skills", "shared-skill"), { recursive: true });
      writeFileSync(join(dir, "skills", "shared-skill", "SKILL.md"), "# shared content");
    }

    const target = join(tmp, "playbook");
    const result = await blackbookInit({
      targetPath: target,
      configDirOverride: { claude: claudeDir, amp: ampDir },
      autoShare: true,
    });

    expect(result.sharedArtifacts.skills).toContain("shared-skill");
    // Lives in shared/, not in tools/<tool>/skills/
    expect(
      readFileSync(join(target, "shared/skills/shared-skill/SKILL.md"), "utf-8"),
    ).toBe("# shared content");

    // Each tool.yaml opts-in
    const playbook = loadPlaybook(target);
    expect(playbook.tools.claude?.config.include_shared.skills).toContain("shared-skill");
    expect(playbook.tools.amp?.config.include_shared.skills).toContain("shared-skill");

    // Tool-specific dirs do NOT duplicate the shared item
    expect(playbook.tools.claude?.standalone.skills.length).toBe(0);
    expect(playbook.tools.amp?.standalone.skills.length).toBe(0);
  });

  it("does NOT auto-share when content differs", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter));
    registerAdapter(alwaysInstalled(ampAdapter));

    const claudeDir = join(tmp, "claude-config");
    const ampDir = join(tmp, "amp-config");
    mkdirSync(join(claudeDir, "skills", "thing"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "thing", "SKILL.md"), "# claude version");
    mkdirSync(join(ampDir, "skills", "thing"), { recursive: true });
    writeFileSync(join(ampDir, "skills", "thing", "SKILL.md"), "# amp version");

    const target = join(tmp, "playbook");
    const result = await blackbookInit({
      targetPath: target,
      configDirOverride: { claude: claudeDir, amp: ampDir },
      autoShare: true,
    });

    expect(result.sharedArtifacts.skills).not.toContain("thing");
    const playbook = loadPlaybook(target);
    expect(playbook.tools.claude?.standalone.skills.map((s) => s.name)).toContain("thing");
    expect(playbook.tools.amp?.standalone.skills.map((s) => s.name)).toContain("thing");
  });

  it("autoShare=false keeps everything tool-specific even when identical", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter));
    registerAdapter(alwaysInstalled(ampAdapter));

    const claudeDir = join(tmp, "claude-config");
    const ampDir = join(tmp, "amp-config");
    for (const dir of [claudeDir, ampDir]) {
      mkdirSync(join(dir, "skills", "x"), { recursive: true });
      writeFileSync(join(dir, "skills", "x", "SKILL.md"), "# same");
    }

    const result = await blackbookInit({
      targetPath: join(tmp, "playbook"),
      configDirOverride: { claude: claudeDir, amp: ampDir },
      autoShare: false,
    });
    expect(result.sharedArtifacts.skills).toEqual([]);
  });
});

describe("blackbookInit — bundles", () => {
  it("emits packages.yaml for Pi bundles", async () => {
    registerAdapter(alwaysInstalled(piAdapter));

    const piDir = join(tmp, "pi-config");
    // pretend pi-package
    const pkgRoot = join(piDir, "git", "owner", "tools");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "tools", pi: { skills: ["./skills"] } }),
    );
    mkdirSync(join(pkgRoot, "skills", "ce-compound"), { recursive: true });
    writeFileSync(join(pkgRoot, "skills", "ce-compound", "SKILL.md"), "# x");
    // materialized bundle skill
    mkdirSync(join(piDir, "skills", "ce-compound"), { recursive: true });
    writeFileSync(join(piDir, "skills", "ce-compound", "SKILL.md"), "# x");

    const result = await blackbookInit({
      targetPath: join(tmp, "playbook"),
      configDirOverride: { pi: piDir },
    });

    expect(result.fragments[0].bundles.map((b) => b.name)).toContain("tools");
    const playbook = loadPlaybook(result.playbookPath);
    expect(playbook.tools.pi?.packagesManifest?.packages.map((p) => p.name)).toContain("tools");
    // Bundle-owned skill NOT vendored as standalone
    expect(playbook.tools.pi?.standalone.skills.map((s) => s.name)).not.toContain("ce-compound");
  });
});

describe("blackbookInit — unknown provenance", () => {
  it("default policy 'skip' drops unknowns and warns", async () => {
    // Fabricate a custom adapter whose pull returns an unclassified item.
    const fakePull = {
      ...alwaysInstalled(claudeAdapter),
      async pull() {
        return {
          toolId: "claude" as const,
          instanceId: "default",
          standaloneArtifacts: [],
          bundles: [],
          unclassified: [
            {
              name: "mystery",
              type: "skill" as const,
              diskPath: "/unused",
              provenance: { kind: "unknown" as const },
            },
          ],
          configFiles: [],
        };
      },
    };
    registerAdapter(fakePull);

    const result = await blackbookInit({ targetPath: join(tmp, "playbook") });
    expect(result.warnings.some((w) => w.includes("unknown provenance"))).toBe(true);
  });
});
