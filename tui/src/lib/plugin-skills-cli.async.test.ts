import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ToolInstance } from "./types.js";

// Every Global-scope skills CLI call from the TUI must be async. The plugin
// installer used spawnSync, which froze Ink (spinner and every key) for the
// whole call — one call per tool group, each a network fetch. These tests pin
// that the helpers go through runSkillsCli and leave the event loop free.
vi.mock("./skills-cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-cli.js")>();
  return { ...actual, runSkillsCli: vi.fn() };
});

import { runSkillsCli } from "./skills-cli.js";
import { installSkillFromSourceViaCli, removeSkillViaCli, runSkillsCliGlobal } from "./plugin-skills-cli.js";

const runSkillsCliMock = vi.mocked(runSkillsCli);
const claude = { toolId: "claude-code", instanceId: "default", enabled: true, configDir: "/tmp/claude-x" } as unknown as ToolInstance;
const codex = { toolId: "openai-codex", instanceId: "default", enabled: true, configDir: "/tmp/codex-x" } as unknown as ToolInstance;

/** A CLI call that takes `ms` to finish, so the test can watch the loop meanwhile. */
const slowOk = (ms: number) => () => new Promise<{ code: number; stdout: string; stderr: string }>((r) => setTimeout(() => r({ code: 0, stdout: "", stderr: "" }), ms));

describe("plugin installer CLI calls are async", () => {
  const savedEnv = process.env.BLACKBOOK_SKILLS_CLI;
  beforeEach(() => {
    delete process.env.BLACKBOOK_SKILLS_CLI;
    runSkillsCliMock.mockReset();
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BLACKBOOK_SKILLS_CLI;
    else process.env.BLACKBOOK_SKILLS_CLI = savedEnv;
  });

  it("installs one skill for a Claude instance through runSkillsCli (-g, its CLAUDE_CONFIG_DIR, $HOME cwd, a timeout) without blocking the loop", async () => {
    runSkillsCliMock.mockImplementation(slowOk(40));
    let ticked = false;
    setTimeout(() => { ticked = true; }, 5);
    const ok = await installSkillFromSourceViaCli("docx", "anthropics/skills", claude);
    expect(ticked).toBe(true); // a timer fired while the CLI ran: the UI could paint
    expect(ok).toBe(true);
    const [args, options] = runSkillsCliMock.mock.calls[0];
    expect(args).toEqual(["add", "anthropics/skills", "-g", "-y", "--skill", "docx", "-a", "claude-code"]);
    expect(options?.env).toEqual({ CLAUDE_CONFIG_DIR: "/tmp/claude-x" });
    expect(options?.cwd).toBe(process.env.HOME || process.cwd());
    expect(options?.timeoutMs).toBeGreaterThan(0);
  });

  it("removes a skill everywhere with one call per tool group, async", async () => {
    runSkillsCliMock.mockImplementation(slowOk(20));
    const ok = await removeSkillViaCli("docx", null, [codex, claude]);
    expect(ok).toBe(true);
    expect(runSkillsCliMock.mock.calls.map(([a]) => a)).toEqual([
      ["remove", "docx", "-g", "-y"],                     // universal group: every agent
      ["remove", "docx", "-g", "-y", "-a", "claude-code"], // the Claude instance
    ]);
  });

  it("reports a failed or timed-out call with the CLI's last error line", async () => {
    runSkillsCliMock.mockResolvedValue({ code: 1, stdout: "", stderr: "│ Error: skills CLI timed out after 300s" });
    expect(await runSkillsCliGlobal(["add", "x", "-g"])).toEqual({ ok: false, error: "Error: skills CLI timed out after 300s" });
  });
});
