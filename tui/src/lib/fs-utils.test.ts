import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  utimesSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { atomicWriteFileSync, renameOrCopy, withFileLockSync, isSyncNoise } from "./fs-utils.js";

// ESM module namespaces are not configurable, so `fs.renameSync` cannot be spied
// directly. Mock the module with a pass-through by default (so every other test
// exercises the real filesystem) and override the rename behavior only inside the
// EXDEV/EACCES cases below.
const { renameSyncMock } = vi.hoisted(() => ({ renameSyncMock: vi.fn() }));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  renameSyncMock.mockImplementation(actual.renameSync);
  return { ...actual, renameSync: (...args: unknown[]) => renameSyncMock(...args) };
});

function exdevError(): NodeJS.ErrnoException {
  const err = new Error("EXDEV: cross-device link not permitted") as NodeJS.ErrnoException;
  err.code = "EXDEV";
  return err;
}

function eaccesError(): NodeJS.ErrnoException {
  const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
  err.code = "EACCES";
  return err;
}

let dir: string;
let target: string;
let lockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bb-fslock-"));
  target = join(dir, "data.json");
  lockPath = `${target}.lock`;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A PID that is guaranteed dead: spawnSync runs the child to completion, so by
// the time it returns the child has already exited.
function deadPid(): number {
  const result = spawnSync(process.execPath, ["-e", ""]);
  return result.pid ?? 999999;
}

describe("renameOrCopy", () => {
  it("uses the fast rename path for a same-directory move", () => {
    const src = join(dir, "src.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "hello");

    renameOrCopy(src, dest);

    expect(renameSyncMock).toHaveBeenCalledWith(src, dest);
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(dest, "utf-8")).toBe("hello");
  });

  it("falls back to copy+delete for a file when rename throws EXDEV", () => {
    const src = join(dir, "src.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "cross-device");

    renameSyncMock.mockImplementationOnce(() => {
      throw exdevError();
    });

    renameOrCopy(src, dest);

    // Source removed, destination holds the original content.
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(dest, "utf-8")).toBe("cross-device");
  });

  it("falls back to copy+delete for a directory when rename throws EXDEV", () => {
    const src = join(dir, "srcdir");
    const dest = join(dir, "destdir");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "file.txt"), "nested");

    renameSyncMock.mockImplementationOnce(() => {
      throw exdevError();
    });

    renameOrCopy(src, dest);

    expect(existsSync(src)).toBe(false);
    expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("nested");
  });

  it("propagates non-EXDEV errors without falling back to copy", () => {
    const src = join(dir, "src.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(src, "keep me");

    renameSyncMock.mockImplementationOnce(() => {
      throw eaccesError();
    });

    expect(() => renameOrCopy(src, dest)).toThrow(/EACCES/);
    // The source is untouched and no copy was made.
    expect(existsSync(src)).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });
});

describe("withFileLockSync", () => {
  it("runs the critical section and cleans up the lock file", () => {
    const result = withFileLockSync(target, () => {
      // The lock must be held while the critical section runs.
      expect(existsSync(lockPath)).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    // Lock is released afterwards.
    expect(existsSync(lockPath)).toBe(false);
  });

  it("serializes access: a lock held by a live process is not stolen", () => {
    // Simulate another live process holding the lock by writing our own
    // (alive) PID into the lock file. The recovery path must NOT steal it.
    writeFileSync(lockPath, String(process.pid));

    expect(() => withFileLockSync(target, () => "should not run")).toThrow(
      /Timed out waiting for lock/,
    );

    // The live holder's lock file is left intact — we never clobbered it.
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf-8")).toBe(String(process.pid));
  });

  it("recovers a stale lock left by a dead process", () => {
    writeFileSync(lockPath, String(deadPid()));

    const ran = withFileLockSync(target, () => {
      atomicWriteFileSync(target, "recovered");
      return true;
    });

    expect(ran).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("recovered");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("recovers a stale lock with no readable PID once it is old enough", () => {
    // No PID recorded — fall back to age-based staleness (> 30s).
    writeFileSync(lockPath, "");
    const old = Date.now() / 1000 - 120; // 2 minutes ago, in seconds
    utimesSync(lockPath, old, old);

    const ran = withFileLockSync(target, () => true);
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does not steal a recent lock with no readable PID", () => {
    // No PID and fresh mtime: not stale, must not be stolen.
    writeFileSync(lockPath, "");
    expect(() => withFileLockSync(target, () => "nope")).toThrow(
      /Timed out waiting for lock/,
    );
    expect(existsSync(lockPath)).toBe(true);
  });

  it("only one of two staggered acquisitions holds the lock at a time", () => {
    // Within a single thread the lock is fully synchronous, so a nested
    // acquisition attempt (a second 'process' arriving mid-critical-section)
    // must be denied rather than both proceeding.
    let innerAttempted = false;
    withFileLockSync(target, () => {
      innerAttempted = true;
      expect(() => withFileLockSync(target, () => "inner")).toThrow(
        /Timed out waiting for lock/,
      );
    });
    expect(innerAttempted).toBe(true);
    // Outer released cleanly.
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("isSyncNoise", () => {
  it("treats OS/tooling files as noise regardless of directory flag", () => {
    for (const name of [".DS_Store", "Thumbs.db", "desktop.ini"]) {
      expect(isSyncNoise(name, false)).toBe(true);
    }
  });

  it("treats compiled-python files as noise", () => {
    expect(isSyncNoise("module.pyc", false)).toBe(true);
    expect(isSyncNoise("module.pyo", false)).toBe(true);
  });

  it("treats .git and __pycache__ as noise only when they are directories", () => {
    expect(isSyncNoise(".git", true)).toBe(true);
    expect(isSyncNoise("__pycache__", true)).toBe(true);
    // A regular file named ".git" (e.g. a gitlink) is meaningful content.
    expect(isSyncNoise(".git", false)).toBe(false);
  });

  it("keeps meaningful content — including .gitignore and SKILL.md", () => {
    expect(isSyncNoise("SKILL.md", false)).toBe(false);
    expect(isSyncNoise(".gitignore", false)).toBe(false);
    expect(isSyncNoise("references", true)).toBe(false);
    expect(isSyncNoise("script.py", false)).toBe(false);
  });
});
