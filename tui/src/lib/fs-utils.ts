import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

const LOCK_RETRY_COUNT = 5;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

export function atomicWriteFileSync(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${Date.now()}.${process.pid}.tmp`);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, path);
}

export function withFileLockSync<T>(path: string, fn: () => T): T {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const lockPath = `${path}.lock`;
  let fd: number | null = null;

  for (let attempt = 0; attempt <= LOCK_RETRY_COUNT; attempt += 1) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid));
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // Ignore stale lock cleanup failures.
      }

      if (attempt === LOCK_RETRY_COUNT) {
        throw new Error(`Timed out waiting for lock on ${path}`);
      }

      sleepSync(LOCK_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors.
      }
    }
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Ignore lock cleanup errors.
    }
  }
}
