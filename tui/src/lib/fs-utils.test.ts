import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { atomicWriteFileSync, withFileLockSync } from "./fs-utils.js";

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
