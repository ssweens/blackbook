import {
  closeSync,
  cpSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

const LOCK_RETRY_COUNT = 5;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_STALE_MS = 30_000;

// Machine-generated artifacts that must never count as managed content. If a
// directory walk includes these, a synced dir reads as permanently "changed"
// the first time a tool, Finder, or Python writes into it — phantom drift that
// shows up in the Sync tab but produces an empty diff. Every directory walker
// used for drift/diff/hashing routes through `isSyncNoise` so the walkers agree
// on what "content" means. Keep the list tight: only entries that are both
// machine-generated AND never meaningful skill/config content.
const SYNC_NOISE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const SYNC_NOISE_DIRS = new Set([".git", "__pycache__"]);

/** True if a directory entry is regenerated noise to exclude from sync content. */
export function isSyncNoise(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return SYNC_NOISE_DIRS.has(name);
  if (SYNC_NOISE_FILES.has(name)) return true;
  // A hard crash between openSync and renameSync in atomicWriteFileSync can
  // strand its temp file `.<ms>.<pid>.tmp` in a synced dir; ignore it here so no
  // scanner reads it as phantom drift. Anchored to the exact shape so it can't
  // swallow a legitimate *.tmp content file.
  if (/^\.\d+\.\d+\.tmp$/.test(name)) return true;
  return name.endsWith(".pyc") || name.endsWith(".pyo");
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs error checking without actually sending a signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but we lack permission to signal it (alive).
    // ESRCH: no such process (dead).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isLockStale(lockPath: string): boolean {
  // Process-liveness is the strongest staleness signal: a lock owned by a
  // live process is never stale (regardless of age), and one owned by a dead
  // process is always stale.
  const pid = readLockPid(lockPath);
  if (pid !== null) {
    return !isProcessAlive(pid);
  }
  // No readable PID — fall back to age. If the file vanished mid-check it is
  // not stale (a fresh acquire will simply recreate it).
  try {
    const stat = statSync(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Reclaim a lock believed to be stale without the classic unlink-then-recreate
 * TOCTOU race. Two processes can both observe the same stale lock; the original
 * implementation had each of them `rmSync` it, which meant the second remover
 * could delete a *fresh* lock the first had already recreated, leaving both
 * "holding" the lock.
 *
 * Instead we atomically steal the lock file via `renameSync` — only one process
 * can rename a given inode away; the loser gets ENOENT. After stealing we verify
 * the file still described the dead owner; if a live process had replaced it in
 * the gap between the staleness check and the steal, we put it back and back off.
 *
 * Returns true when the caller should immediately retry acquisition.
 */
function tryReclaimStaleLock(lockPath: string): boolean {
  if (!isLockStale(lockPath)) return false;

  const observedPid = readLockPid(lockPath);
  const claimPath = `${lockPath}.stale.${process.pid}.${Date.now()}`;

  try {
    renameSync(lockPath, claimPath);
  } catch {
    // The lock is gone or was already reclaimed by someone else. Retry the
    // atomic `openSync(wx)` acquisition rather than assuming we hold it.
    return true;
  }

  // We now hold whatever file was at lockPath. Guard against having stolen a
  // fresh lock that a live process created after our staleness check.
  if (observedPid !== null) {
    const stolenPid = readLockPid(claimPath);
    if (stolenPid !== null && stolenPid !== observedPid && isProcessAlive(stolenPid)) {
      try {
        renameSync(claimPath, lockPath);
      } catch {
        try {
          rmSync(claimPath, { force: true });
        } catch {
          // Nothing more we can do; fall through and back off.
        }
      }
      return false;
    }
  }

  try {
    rmSync(claimPath, { force: true });
  } catch {
    // Ignore cleanup failures for the stolen stale lock.
  }
  return true;
}

/**
 * Move `src` to `dest`, tolerating cross-filesystem boundaries.
 *
 * `renameSync` (POSIX `rename(2)`) fails with `EXDEV` when the source and
 * destination live on different mounts — common on Linux where `/tmp`, `~/.cache`,
 * and a tool's config dir can each be a separate filesystem. When that specific
 * error occurs we fall back to copy-then-delete, which works across devices and
 * handles both files and directories (and preserves symlinks verbatim).
 *
 * Any error other than `EXDEV` propagates unchanged — we never swallow
 * `ENOENT`, `EACCES`, etc. The source is removed only after the destination
 * copy succeeds, so a failed copy leaves the original intact.
 */
export function renameOrCopy(src: string, dest: string): void {
  try {
    renameSync(src, dest);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
  }
  // EXDEV fallback: copy first, and only unlink the source once the copy lands.
  // Use lstat (not existsSync) so a copied-but-dangling symlink still counts as
  // present — cpSync preserves symlinks verbatim.
  cpSync(src, dest, { recursive: true });
  try {
    lstatSync(dest);
  } catch {
    throw new Error(`renameOrCopy: copy to ${dest} did not produce a destination`);
  }
  rmSync(src, { recursive: true, force: true });
}

export function atomicWriteFileSync(path: string, content: string | Buffer): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${Date.now()}.${process.pid}.tmp`);
  const fd = openSync(tempPath, "w");
  try {
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, path);
  } catch (err) {
    // A failed write/rename must not leave the temp behind — scanners would read
    // it as phantom drift. Best-effort cleanup, then surface the real error.
    try {
      rmSync(tempPath, { force: true });
    } catch {
      /* ignore cleanup failure; the original error is what matters */
    }
    throw err;
  }
}

export function withFileLockSync<T>(path: string, fn: () => T): T {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const lockPath = `${path}.lock`;
  let fd: number | null = null;

  for (let attempt = 0; attempt <= LOCK_RETRY_COUNT; attempt += 1) {
    try {
      // `wx` is an atomic create-exclusive at the OS level: it fails with
      // EEXIST if the file already exists, so exactly one process wins the
      // acquisition even under concurrency.
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid));
      fsyncSync(fd);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      // Lock is held. If it is genuinely stale (dead owner, or too old when no
      // PID is recorded), atomically reclaim it and retry immediately.
      if (tryReclaimStaleLock(lockPath)) {
        continue;
      }

      if (attempt === LOCK_RETRY_COUNT) {
        throw new Error(`Timed out waiting for lock on ${path}`);
      }

      sleepSync(LOCK_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (fd === null) {
    // Every attempt was consumed reclaiming stale locks without acquiring one.
    // Never run the critical section unlocked.
    throw new Error(`Timed out waiting for lock on ${path}`);
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
