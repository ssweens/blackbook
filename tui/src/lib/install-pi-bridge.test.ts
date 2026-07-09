import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

// isPiPluginBridgeReady used to be defined twice with divergent logic:
// plugin-status.ts checked only the Pi settings package list, while install.ts
// additionally required the @ssweens/pi-plugins package to be resolvable on
// disk. That meant the STATUS check could report "ready" while the INSTALL path
// would fail. The implementation is now unified (canonical in install.ts, the
// home of the Pi-bridge resolution helpers; plugin-status.ts imports it). These
// tests pin the stricter, on-disk-aware behavior so the two can never re-diverge.

const { loadPiSettingsMock } = vi.hoisted(() => ({
  loadPiSettingsMock: vi.fn(),
}));

vi.mock("./marketplace.js", async () => {
  const actual = await vi.importActual<typeof import("./marketplace.js")>(
    "./marketplace.js",
  );
  return { ...actual, loadPiSettings: loadPiSettingsMock };
});

import { isPiPluginBridgeReady } from "./install.js";

const SOFT_DEPS = ["npm:pi-subagents", "npm:pi-mcp-adapter"];

describe("isPiPluginBridgeReady (unified)", () => {
  let pkgDir: string;

  beforeEach(() => {
    loadPiSettingsMock.mockReset();
    pkgDir = join(
      tmpdir(),
      `blackbook-pi-plugins-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(() => {
    try { rmSync(pkgDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("is ready when the package list is complete AND the package resolves on disk", () => {
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@ssweens/pi-plugins", version: "1.0.0" }),
    );
    // A local (path) pi-plugins source that resolves on disk, plus the soft deps.
    loadPiSettingsMock.mockReturnValue({ packages: [pkgDir, ...SOFT_DEPS] });

    expect(isPiPluginBridgeReady()).toBe(true);
  });

  it("does NOT trust the settings list alone: readiness tracks on-disk resolution", () => {
    // Package list satisfies the name/soft-dep checks (all npm: sources), so the
    // OLD plugin-status.ts version returned true unconditionally. The unified
    // version additionally requires resolvePiPluginsPackageRoot() !== null. With
    // only npm: sources, that reduces to whether the real Pi node_modules copy
    // exists — so the answer must equal the actual on-disk state, never a blind
    // true. On CI (no ~/.pi install) this asserts false, catching any regression
    // back to the settings-only check.
    loadPiSettingsMock.mockReturnValue({
      packages: ["npm:@ssweens/pi-plugins", ...SOFT_DEPS],
    });

    const nodeModulesInstalled = existsSync(
      join(homedir(), ".pi", "agent", "npm", "node_modules", "@ssweens", "pi-plugins", "package.json"),
    );
    expect(isPiPluginBridgeReady()).toBe(nodeModulesInstalled);
  });

  it("is not ready when required soft deps are missing", () => {
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@ssweens/pi-plugins", version: "1.0.0" }),
    );
    // pi-plugins resolves on disk, but pi-mcp-adapter is absent from the list.
    loadPiSettingsMock.mockReturnValue({ packages: [pkgDir, "npm:pi-subagents"] });

    expect(isPiPluginBridgeReady()).toBe(false);
  });
});
