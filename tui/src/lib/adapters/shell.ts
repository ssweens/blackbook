/**
 * Shared shell-out helpers for adapter bundle operations.
 *
 * Adapters that drive their tool's native install CLI (`pi install ...`,
 * `claude plugin install ...`) use these helpers for consistent error
 * handling, timeouts, and stdio capture.
 */

import { spawn, type SpawnOptions } from "node:child_process";

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Default 5 minutes — bundle installs can be slow. */
  timeoutMs?: number;
  /** Fail (resolve with ok=false) instead of rejecting. Default true. */
  captureFailure?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run a command, capture stdout/stderr, return a structured result.
 * Never throws on non-zero exit; surfaces it via `ok: false`.
 * Throws only on spawn failure (e.g., binary not found).
 */
export async function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  };

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(cmd, args, spawnOpts);
    if (!child.stdout || !child.stderr) {
      reject(new Error(`spawn ${cmd}: no stdio streams`));
      return;
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c) => stdoutChunks.push(c));
    child.stderr.on("data", (c) => stderrChunks.push(c));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Run; throw if not ok. Use when the caller wants exception-on-failure.
 */
export async function runOrThrow(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (!r.ok) {
    const detail = r.stderr.trim() || r.stdout.trim() || "no output";
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.exitCode}): ${detail}`);
  }
  return r;
}
