import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageManager, PiPackage } from "./types.js";

const { execFileMock, installInfoMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  installInfoMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("./marketplace.js", () => ({
  getGlobalPiPackageInstallInfo: installInfoMock,
}));

import { removePiPackage } from "./pi-install.js";

function pkg(overrides: Partial<PiPackage> = {}): PiPackage {
  return {
    name: "pi-powerline-footer",
    description: "Powerline footer",
    version: "1.0.0",
    source: "npm:pi-powerline-footer",
    sourceType: "npm",
    marketplace: "npm",
    installed: true,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    ...overrides,
  };
}

function detected(name: string, managers: PackageManager[]) {
  return new Map([
    [
      name,
      {
        version: "1.0.0",
        via: managers[0]!,
        viaManagers: managers,
        managerMismatch: managers[0] !== "npm",
      },
    ],
  ]);
}

function mockExecFile(handlers: Array<{ command: string; args: string[]; error?: string }>) {
  execFileMock.mockImplementation((command: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    const next = handlers.shift();
    expect({ command, args }).toEqual({ command: next?.command, args: next?.args });
    cb(next?.error ? new Error(next.error) : null, "", "");
  });
}

describe("removePiPackage", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    installInfoMock.mockReset();
    installInfoMock.mockReturnValue(new Map());
  });

  it("uninstalls a local-only npm Pi package from its detected global manager when pi settings has no matching package", async () => {
    mockExecFile([
      {
        command: "pi",
        args: ["remove", "npm:pi-powerline-footer"],
        error: "No matching package found for npm:pi-powerline-footer",
      },
      { command: "bun", args: ["remove", "-g", "pi-powerline-footer"] },
    ]);
    installInfoMock
      .mockReturnValueOnce(detected("pi-powerline-footer", ["bun"]))
      .mockReturnValueOnce(new Map());

    await expect(removePiPackage(pkg({ installedVia: "bun", installedViaManagers: ["bun"] }))).resolves.toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("cleans up mismatched globally installed managers after pi remove succeeds", async () => {
    mockExecFile([
      { command: "pi", args: ["remove", "npm:pi-powerline-footer"] },
      { command: "bun", args: ["remove", "-g", "pi-powerline-footer"] },
    ]);
    installInfoMock
      .mockReturnValueOnce(detected("pi-powerline-footer", ["bun"]))
      .mockReturnValueOnce(new Map());

    await expect(removePiPackage(pkg({ installedVia: "bun", installedViaManagers: ["bun"], managerMismatch: true }))).resolves.toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("reports failure when manager cleanup runs but the package is still detected", async () => {
    mockExecFile([
      {
        command: "pi",
        args: ["remove", "npm:pi-powerline-footer"],
        error: "No matching package found for npm:pi-powerline-footer",
      },
      { command: "bun", args: ["remove", "-g", "pi-powerline-footer"] },
    ]);
    installInfoMock.mockReturnValue(detected("pi-powerline-footer", ["bun"]));

    const result = await removePiPackage(pkg({ installedVia: "bun", installedViaManagers: ["bun"] }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("still appears installed via bun");
  });

  it("cleans up the pi-managed install with `pi remove` when only that is detected", async () => {
    mockExecFile([
      { command: "pi", args: ["remove", "npm:pi-powerline-footer"] },
      { command: "pi", args: ["remove", "pi-powerline-footer"] },
    ]);
    installInfoMock
      .mockReturnValueOnce(detected("pi-powerline-footer", ["pi"]))
      .mockReturnValueOnce(new Map());

    await expect(
      removePiPackage(pkg({ installedVia: "pi", installedViaManagers: ["pi"] })),
    ).resolves.toEqual({ success: true });
    // First call is the user-facing `pi remove <source>`, second is the
    // detected-managers sweep that targets the per-package install path.
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});
