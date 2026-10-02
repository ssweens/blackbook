import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ToolInstance } from "./types.js";

// The Global (-g) path must go through the ASYNC runner, like the project path.
// The sync runner blocks the event loop, which froze the TUI (spinner and keys)
// for the whole apply — one CLI call per enabled tool per source, each fetching
// from GitHub.
vi.mock("./skills-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-cli.js")>();
  return { ...actual, runSkillsCli: vi.fn() };
});
vi.mock("./plugin-skills-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plugin-skills-cli.js")>();
  return { ...actual, runSkillsCliSync: vi.fn(() => { throw new Error("sync runner must not be used for Global applies"); }) };
});

import { runSkillsCli } from "./skills-cli.js";
import { installLockSkills } from "./skill-profiles.js";

const runSkillsCliMock = vi.mocked(runSkillsCli);

const claude: ToolInstance = { id: "claude-main", toolId: "claude-code", name: "Claude", enabled: true, configDir: "~/.claude" } as unknown as ToolInstance;
const lock = { docx: { source: "github.com/anthropics/skills", sourceType: "github", computedHash: "h", installedAt: "2026-01-01T00:00:00.000Z" } } as const;

describe("Global apply runs the skills CLI asynchronously", () => {
  let home: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "bb-global-"));
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    process.env.HOME = home;
    runSkillsCliMock.mockReset();
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("installs into Global through runSkillsCli with -g, the group's env, and HOME as cwd; verifies what landed", async () => {
    runSkillsCliMock.mockImplementation(async (args) => {
      if (args[0] === "add") mkdirSync(join(home, ".agents", "skills", "docx"), { recursive: true });
      return { code: 0, stdout: "✓ Installed docx", stderr: "" };
    });
    const result = await installLockSkills(home, lock as never, ["docx"], [claude]);
    expect(runSkillsCliMock).toHaveBeenCalledTimes(1);
    const [args, options] = runSkillsCliMock.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(["add", "github.com/anthropics/skills", "-y"]);
    expect(args).toContain("-g");
    expect(args).toContain("--skill");
    expect(args).toContain("claude-code");
    expect(options?.cwd).toBe(home);
    expect(options?.env?.CLAUDE_CONFIG_DIR).toBe(join(home, ".claude"));
    expect(result.added).toEqual(["docx"]);
    expect(result.errors).toEqual([]);
  });

  it("reports a failed Global call with the CLI's last error line, like the project path", async () => {
    runSkillsCliMock.mockResolvedValue({ code: 1, stdout: "", stderr: "│ ✗ Error: rate limited by GitHub" });
    const result = await installLockSkills(home, lock as never, ["docx"], [claude]);
    expect(result.added).toEqual([]);
    expect(result.errors).toEqual(["github.com/anthropics/skills: ✗ Error: rate limited by GitHub"]);
  });
});
