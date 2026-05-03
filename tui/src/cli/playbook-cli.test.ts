/**
 * CLI tests — invoke runPlaybookCli with controlled HOME so we don't touch the
 * developer's real ~/.config/blackbook/.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRegistryForTests, registerAdapter } from "../lib/adapters/index.js";
import { ampAdapter } from "../lib/adapters/amp/index.js";
import { claudeAdapter } from "../lib/adapters/claude/index.js";
import type { ToolAdapter } from "../lib/adapters/types.js";
import { runPlaybookCli } from "./playbook-cli.js";

let tmp: string;
let originalHome: string | undefined;

beforeEach(() => {
  __resetRegistryForTests();
  tmp = mkdtempSync(join(tmpdir(), "blackbook-cli-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmp; // every CLI run uses tmp/.config/blackbook
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tmp, { recursive: true, force: true });
  __resetRegistryForTests();
  vi.restoreAllMocks();
});

function alwaysInstalled(real: ToolAdapter, configDir: string): ToolAdapter {
  return {
    ...real,
    async detect() {
      return {
        toolId: real.defaults.toolId,
        installed: true,
        version: "test",
        binaryPath: "/usr/bin/test",
        configDir,
      };
    },
    defaults: { ...real.defaults, defaultConfigDir: configDir },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("runPlaybookCli — usage", () => {
  it("returns 2 + usage with no args", async () => {
    const r = await runPlaybookCli([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });

  it("prints help on --help", async () => {
    const r = await runPlaybookCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("returns 2 on unknown subcommand", async () => {
    const r = await runPlaybookCli(["nope"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Unknown subcommand");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runPlaybookCli — init", () => {
  it("scaffolds a playbook from current machine state", async () => {
    const claudeDir = join(tmp, "claude-config");
    mkdirSync(join(claudeDir, "skills", "demo"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "demo", "SKILL.md"), "# demo");

    // Pre-register the test adapter; runPlaybookCli will then call registerAllAdapters()
    // which is idempotent and won't clobber our test registration.
    registerAdapter(alwaysInstalled(claudeAdapter, claudeDir));

    const target = join(tmp, "playbook");
    const r = await runPlaybookCli(["init", "--target", target]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("✓ claude");
    expect(r.stdout).toContain(`Playbook ready: ${target}`);

    // Verify config written under tmp HOME
    const cfg = readFileSync(join(tmp, ".config", "blackbook", "config.yaml"), "utf-8");
    expect(cfg).toContain(`playbook_path: ${target}`);

    // Playbook on disk
    expect(readFileSync(join(target, "playbook.yaml"), "utf-8")).toContain("tools_enabled");
  });

  it("--from <path> wires existing playbook into config", async () => {
    // Create a minimal valid playbook in tmp
    const pbRoot = join(tmp, "pre-existing");
    mkdirSync(pbRoot, { recursive: true });
    writeFileSync(
      join(pbRoot, "playbook.yaml"),
      "playbook_schema_version: 1\nname: test\ntools_enabled: []\n",
    );
    const r = await runPlaybookCli(["init", "--from", pbRoot]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`Configured to use playbook at ${pbRoot}`);
    const cfg = readFileSync(join(tmp, ".config", "blackbook", "config.yaml"), "utf-8");
    expect(cfg).toContain(`playbook_path: ${pbRoot}`);
  });

  it("--from rejects nonexistent path", async () => {
    const r = await runPlaybookCli(["init", "--from", join(tmp, "nope")]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("path does not exist");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runPlaybookCli — preview / apply", () => {
  it("preview reports adds; apply makes them; status shows clean after", async () => {
    const claudeDir = join(tmp, "claude-config");
    mkdirSync(claudeDir, { recursive: true });
    registerAdapter(alwaysInstalled(claudeAdapter, claudeDir));

    // Build a hand-rolled playbook with one shared skill opted-in by claude
    const pbRoot = join(tmp, "playbook");
    mkdirSync(join(pbRoot, "shared", "skills", "foo"), { recursive: true });
    writeFileSync(join(pbRoot, "shared", "skills", "foo", "SKILL.md"), "# foo");
    writeFileSync(
      join(pbRoot, "playbook.yaml"),
      `playbook_schema_version: 1\nname: test\ntools_enabled: [claude]\n`,
    );
    mkdirSync(join(pbRoot, "tools", "claude"), { recursive: true });
    writeFileSync(
      join(pbRoot, "tools", "claude", "tool.yaml"),
      `tool: claude\ninstances:\n  - id: default\n    name: Claude\n    config_dir: ${claudeDir}\n    enabled: true\ninclude_shared:\n  agents_md: false\n  skills:\n    - foo\n  commands: []\n  agents: []\n  mcp: []\n`,
    );

    // preview
    const p1 = await runPlaybookCli(["preview", pbRoot]);
    expect(p1.exitCode).toBe(0);
    expect(p1.stdout).toContain("would: 1 add");
    expect(p1.stdout).toContain("+ skill/foo");

    // apply
    const a1 = await runPlaybookCli(["apply", pbRoot]);
    expect(a1.exitCode).toBe(0);
    expect(readFileSync(join(claudeDir, "skills", "foo", "SKILL.md"), "utf-8")).toBe("# foo");

    // preview again — clean
    const p2 = await runPlaybookCli(["preview", pbRoot]);
    expect(p2.exitCode).toBe(0);
    expect(p2.stdout).toContain("would: 0 add");
    expect(p2.stdout).toContain("0 update");
    expect(p2.stdout).toContain("0 remove");
  });

  it("apply refuses when required env unset", async () => {
    const claudeDir = join(tmp, "claude-config");
    mkdirSync(claudeDir, { recursive: true });
    registerAdapter(alwaysInstalled(claudeAdapter, claudeDir));

    const pbRoot = join(tmp, "playbook");
    mkdirSync(join(pbRoot, "shared", "mcp"), { recursive: true });
    writeFileSync(
      join(pbRoot, "shared", "mcp", "github.yaml"),
      `name: github\ntype: remote\nurl: https://gh.example/mcp\nbearerTokenEnv: TOTALLY_MADE_UP_VAR_NAME_X\nheaders: {}\nenabled: true\ncompat: {}\n`,
    );
    writeFileSync(
      join(pbRoot, "playbook.yaml"),
      `playbook_schema_version: 1\nname: t\ntools_enabled: [claude]\nrequired_env:\n  - name: TOTALLY_MADE_UP_VAR_NAME_X\n    used_by: [github]\n    optional: false\n`,
    );
    mkdirSync(join(pbRoot, "tools", "claude"), { recursive: true });
    writeFileSync(
      join(pbRoot, "tools", "claude", "tool.yaml"),
      `tool: claude\ninstances:\n  - id: default\n    name: Claude\n    config_dir: ${claudeDir}\n    enabled: true\ninclude_shared:\n  agents_md: false\n  skills: []\n  commands: []\n  agents: []\n  mcp: [github]\n`,
    );
    delete process.env.TOTALLY_MADE_UP_VAR_NAME_X;

    const a = await runPlaybookCli(["apply", pbRoot]);
    expect(a.exitCode).toBe(1);
    expect(a.stderr).toContain("TOTALLY_MADE_UP_VAR_NAME_X");
    expect(a.stderr).toContain("Refusing to apply");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runPlaybookCli — validate", () => {
  it("flags broken include_shared reference", async () => {
    const claudeDir = join(tmp, "claude-config");
    mkdirSync(claudeDir, { recursive: true });
    const pbRoot = join(tmp, "playbook");
    mkdirSync(pbRoot, { recursive: true });
    writeFileSync(
      join(pbRoot, "playbook.yaml"),
      "playbook_schema_version: 1\nname: t\ntools_enabled: [claude]\n",
    );
    mkdirSync(join(pbRoot, "tools", "claude"), { recursive: true });
    writeFileSync(
      join(pbRoot, "tools", "claude", "tool.yaml"),
      `tool: claude\ninstances:\n  - id: default\n    name: Claude\n    config_dir: ${claudeDir}\n    enabled: true\ninclude_shared:\n  agents_md: false\n  skills: [missing-skill]\n  commands: []\n  agents: []\n  mcp: []\n`,
    );

    const r = await runPlaybookCli(["validate", pbRoot]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('"missing-skill"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runPlaybookCli — status", () => {
  it("lists adapters and notes when no playbook configured", async () => {
    registerAdapter(alwaysInstalled(claudeAdapter, join(tmp, "c")));
    registerAdapter(alwaysInstalled(ampAdapter, join(tmp, "a")));

    const r = await runPlaybookCli(["status"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Detected tools:");
    expect(r.stdout).toContain("✓ claude");
    expect(r.stdout).toContain("No playbook configured");
  });
});
