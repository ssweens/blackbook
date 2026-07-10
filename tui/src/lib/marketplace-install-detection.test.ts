import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// `getGlobalPiPackageInstallInfo` shells out to `npm/pnpm root -g` for the
// global package managers. The pi-managed install is read from a fixed path
// under $HOME, so we override HOME to a temp dir for the duration of the
// suite to keep tests hermetic. We don't mock `getGlobalPiPackageInstallInfo`
// here — these tests exercise the real scanning logic that previously
// missed pi's managed install under ~/.pi/agent/npm/.
const { execFileSyncMock, preferredManagerValue } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  preferredManagerValue: { current: "npm" as "npm" | "bun" | "pnpm" },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});

// `getPackageManager` reads package manager state — we override it so the
// scan order is deterministic regardless of the host's package manager.
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    getPackageManager: () => preferredManagerValue.current,
  };
});

import { getGlobalPiPackageInstallInfo } from "./marketplace.js";

function makePiPackageJson(dir: string, name: string, version: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version,
      pi: { extensions: ["./dist/index.js"] },
    }),
  );
}

function makeNonPiPackageJson(dir: string, name: string, version: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version,
    }),
  );
}

describe("getGlobalPiPackageInstallInfo (pi-managed install)", () => {
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), "blackbook-pi-home-"));
    process.env.HOME = fakeHome;
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not used in pi-only test");
    });
    preferredManagerValue.current = "npm";
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (existsSync(fakeHome)) rmSync(fakeHome, { recursive: true, force: true });
  });

  it("detects a pi package installed only in pi's managed location", () => {
    const piPath = join(fakeHome, ".pi", "agent", "npm", "node_modules", "pi-mcp-adapter");
    makePiPackageJson(piPath, "pi-mcp-adapter", "2.11.0");

    const info = getGlobalPiPackageInstallInfo();
    const entry = info.get("pi-mcp-adapter");

    expect(entry).toBeDefined();
    expect(entry?.version).toBe("2.11.0");
    expect(entry?.via).toBe("pi");
    expect(entry?.viaManagers).toEqual(["pi"]);
    // The default preferred manager is npm — a package only in pi's managed
    // install will always flag a manager mismatch under the default. That
    // surfaces to the UI as the install location being pi rather than npm.
    expect(entry?.managerMismatch).toBe(true);
  });

  it("prefers the pi-managed version when a stale global npm install also exists", () => {
    // This is the regression case: pi updated to 2.11.0 under ~/.pi/agent/npm,
    // but a zombie global npm install of 2.6.1 still lives in npm root -g.
    // Blackbook previously reported 2.6.1 and falsely flagged the update.
    const piPath = join(fakeHome, ".pi", "agent", "npm", "node_modules", "pi-mcp-adapter");
    makePiPackageJson(piPath, "pi-mcp-adapter", "2.11.0");

    // Pretend `npm root -g` returns a path under a sibling global install.
    // execFileSync is also called by other paths, so only intercept the
    // specific call we care about.
    const fakeGlobalRoot = join(fakeHome, "global-npm", "node_modules");
    mkdirSync(join(fakeGlobalRoot, "pi-mcp-adapter"), { recursive: true });
    makePiPackageJson(join(fakeGlobalRoot, "pi-mcp-adapter"), "pi-mcp-adapter", "2.6.1");
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "npm" && args[0] === "root" && args[1] === "-g") {
        return fakeGlobalRoot;
      }
      throw new Error(`unexpected call: ${cmd} ${args?.join(" ")}`);
    });

    const info = getGlobalPiPackageInstallInfo();
    const entry = info.get("pi-mcp-adapter");

    expect(entry?.version).toBe("2.11.0");
    expect(entry?.viaManagers).toContain("pi");
    expect(entry?.viaManagers).toContain("npm");
  });

  it("returns an empty map when ~/.pi/agent/npm/ does not exist", () => {
    const info = getGlobalPiPackageInstallInfo();
    expect(info.size).toBe(0);
  });

  it("ignores non-pi packages sitting in the pi-managed install", () => {
    const piPath = join(fakeHome, ".pi", "agent", "npm", "node_modules", "lodash");
    makeNonPiPackageJson(piPath, "lodash", "4.17.21");

    const info = getGlobalPiPackageInstallInfo();
    expect(info.has("lodash")).toBe(false);
  });
});
