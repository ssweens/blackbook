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
