import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

import {
  detectToolBinary,
  fetchLatestVersion,
  detectTool,
  isNewerVersion,
} from "./tool-detect.js";
import type { ToolRegistryEntry } from "./tool-registry.js";

const CLAUDE_ENTRY: ToolRegistryEntry = {
  toolId: "claude-code",
  displayName: "Claude",
  defaultConfigDir: "/Users/test/.claude",
  binaryName: "claude",
  npmPackage: "@anthropic-ai/claude-code",
  versionArgs: ["--version"],
  homepage: "https://docs.anthropic.com/en/docs/claude-code",
};

function mockExecImpl(handler: (cmd: string, args: string[]) => { err?: Error; stdout?: string; stderr?: string }) {
  execFileMock.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const result = handler(cmd, args);
    if (result.err) {
      cb(result.err);
      return;
    }
    cb(null, { stdout: result.stdout || "", stderr: result.stderr || "" });
  });
}

describe("tool-detect", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("detects installed binary and parses version", async () => {
    mockExecImpl((cmd, args) => {
      if (cmd === "which" && args[0] === "claude") return { stdout: "/usr/local/bin/claude\n" };
      if (cmd === "claude") return { stdout: "claude-code 1.2.3\n" };
      return { err: new Error("unexpected") };
    });

    const result = await detectToolBinary(CLAUDE_ENTRY);
    expect(result.installed).toBe(true);
    expect(result.path).toBe("/usr/local/bin/claude");
    expect(result.version).toBe("1.2.3");
  });

  it("returns not installed when which fails", async () => {
    mockExecImpl((cmd, args) => {
      if (cmd === "which" && args[0] === "claude") return { err: new Error("not found") };
      return { err: new Error("unexpected") };
    });

    const result = await detectToolBinary(CLAUDE_ENTRY);
    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
    expect(result.version).toBeNull();
  });

  it("fetches latest version using npm view", async () => {
    mockExecImpl((cmd, args) => {
      if (cmd === "which" && args[0] === "npm") return { stdout: "/usr/local/bin/npm\n" };
      if (cmd === "npm" && args[0] === "view") return { stdout: "1.3.0\n" };
      return { err: new Error("unexpected") };
    });

    const result = await fetchLatestVersion("@anthropic-ai/claude-code", "npm");
    expect(result).toBe("1.3.0");
  });

  it("detects update availability", async () => {
    mockExecImpl((cmd, args) => {
      if (cmd === "which" && args[0] === "claude") return { stdout: "/usr/local/bin/claude\n" };
      if (cmd === "claude") return { stdout: "v1.2.0\n" };
      if (cmd === "which" && args[0] === "npm") return { stdout: "/usr/local/bin/npm\n" };
      if (cmd === "npm" && args[0] === "view") return { stdout: "1.2.5\n" };
      return { err: new Error(`unexpected ${cmd} ${args.join(" ")}`) };
    });

    const result = await detectTool(CLAUDE_ENTRY, "npm");
    expect(result.installedVersion).toBe("1.2.0");
    expect(result.latestVersion).toBe("1.2.5");
    expect(result.hasUpdate).toBe(true);
  });

  it("compares semver components numerically", () => {
    expect(isNewerVersion("1.2.9", "1.10.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(false);
  });
});
