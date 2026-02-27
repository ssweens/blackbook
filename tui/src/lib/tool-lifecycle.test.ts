import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

import {
  buildInstallCommand,
  buildUpdateCommand,
  buildUninstallCommand,
  installTool,
  updateTool,
  uninstallTool,
  reinstallTool,
} from "./tool-lifecycle.js";

function mockWhichAll() {
  execFileMock.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    if (cmd === "which") {
      cb(null, { stdout: `/usr/local/bin/${args[0]}\n`, stderr: "" });
      return;
    }
    cb(new Error("unexpected"));
  });
}

function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    proc.emit("close", 1);
  });
  return proc;
}

describe("tool-lifecycle command builders", () => {
  it("builds install commands", () => {
    expect(buildInstallCommand("npm", "pkg")).toEqual({ cmd: "npm", args: ["install", "-g", "pkg"] });
    expect(buildInstallCommand("pnpm", "pkg")).toEqual({ cmd: "pnpm", args: ["add", "-g", "pkg"] });
    expect(buildInstallCommand("bun", "pkg")).toEqual({ cmd: "bun", args: ["add", "-g", "pkg"] });
  });

  it("builds update and uninstall commands", () => {
    expect(buildUpdateCommand("bun", "pkg")).toEqual({ cmd: "bun", args: ["update", "-g", "pkg"] });
    expect(buildUninstallCommand("bun", "pkg")).toEqual({ cmd: "bun", args: ["remove", "-g", "pkg"] });
  });
});

describe("tool-lifecycle operations", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  it("returns false for unknown tool", async () => {
    const events: string[] = [];
    const ok = await installTool("unknown", "npm", (event) => {
      events.push(event.type);
    });
    expect(ok).toBe(false);
    expect(events).toContain("error");
  });

  it("streams progress and resolves success", async () => {
    mockWhichAll();
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const events: string[] = [];
    const promise = installTool("claude-code", "npm", (event) => {
      events.push(event.type);
    });

    await new Promise((resolve) => setImmediate(resolve));
    proc.stdout.emit("data", "installed\n");
    proc.emit("close", 0);

    const ok = await promise;
    expect(ok).toBe(true);
    expect(events).toContain("stdout");
    expect(events).toContain("done");
  });

  it("uses Claude install script for claude-code", async () => {
    mockWhichAll();
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = installTool("claude-code", "npm", () => {
      // no-op
    });

    await new Promise((resolve) => setImmediate(resolve));
    proc.emit("close", 0);
    const ok = await promise;

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("bash", ["-lc", "curl -fsSL https://claude.ai/install.sh | bash"], expect.any(Object));
  });

  it("uses tool-native update commands", async () => {
    mockWhichAll();

    const ampProc = createFakeProcess();
    spawnMock.mockReturnValueOnce(ampProc);
    const ampPromise = updateTool("amp-code", "npm", () => {
      // no-op
    });
    await new Promise((resolve) => setImmediate(resolve));
    ampProc.emit("close", 0);
    const ampOk = await ampPromise;

    const claudeProc = createFakeProcess();
    spawnMock.mockReturnValueOnce(claudeProc);
    const claudePromise = updateTool("claude-code", "npm", () => {
      // no-op
    });
    await new Promise((resolve) => setImmediate(resolve));
    claudeProc.emit("close", 0);
    const claudeOk = await claudePromise;

    expect(ampOk).toBe(true);
    expect(claudeOk).toBe(true);
    expect(spawnMock).toHaveBeenNthCalledWith(1, "amp", ["update"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(2, "claude", ["update"], expect.any(Object));
  });

  it("uses configured package-manager update command for codex", async () => {
    mockWhichAll();
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = updateTool("openai-codex", "pnpm", () => {
      // no-op
    });

    await new Promise((resolve) => setImmediate(resolve));
    proc.emit("close", 0);
    const ok = await promise;

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("pnpm", ["update", "-g", "@openai/codex"], expect.any(Object));
  });

  it("reinstall runs cleanup commands then uninstall/install", async () => {
    mockWhichAll();

    const cleanup1 = createFakeProcess();
    const cleanup2 = createFakeProcess();
    const cleanup3 = createFakeProcess();
    const cleanup4 = createFakeProcess();
    const uninstallProc = createFakeProcess();
    const installProc = createFakeProcess();

    spawnMock
      .mockReturnValueOnce(cleanup1)
      .mockReturnValueOnce(cleanup2)
      .mockReturnValueOnce(cleanup3)
      .mockReturnValueOnce(cleanup4)
      .mockReturnValueOnce(uninstallProc)
      .mockReturnValueOnce(installProc);

    const promise = reinstallTool("openai-codex", "pnpm", () => {
      // no-op
    });

    await new Promise((resolve) => setImmediate(resolve));
    cleanup1.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    cleanup2.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    cleanup3.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    cleanup4.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    uninstallProc.emit("close", 0);
    await new Promise((resolve) => setImmediate(resolve));
    installProc.emit("close", 0);

    const ok = await promise;

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenNthCalledWith(1, "brew", ["uninstall", "codex"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(2, "npm", ["uninstall", "-g", "@openai/codex"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(3, "pnpm", ["remove", "-g", "@openai/codex"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(4, "bun", ["remove", "-g", "@openai/codex"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(5, "pnpm", ["remove", "-g", "@openai/codex"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(6, "pnpm", ["add", "-g", "@openai/codex"], expect.any(Object));
  });

  it("supports cancellation", async () => {
    mockWhichAll();
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const controller = new AbortController();
    const events: string[] = [];
    const promise = updateTool("claude-code", "npm", (event) => {
      events.push(event.type);
    }, {
      signal: controller.signal,
    });

    controller.abort();
    const ok = await promise;

    expect(ok).toBe(false);
    expect(events).toContain("cancelled");
  });

  it("times out long-running commands", async () => {
    mockWhichAll();
    const proc = createFakeProcess();
    spawnMock.mockReturnValue(proc);

    const events: string[] = [];
    const ok = await uninstallTool("claude-code", "npm", (event) => {
      events.push(event.type);
    }, {
      timeoutMs: 10,
    });

    expect(ok).toBe(false);
    expect(events).toContain("timeout");
  });
});
