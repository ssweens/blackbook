import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join } from "path";
import { z } from "zod";
import type { ConsultationRuntime } from "./config/schema.js";
import type { ToolInstance } from "./types.js";
import type { ConsultationResponse } from "./consultation-context.js";

export type { ConsultationProposal, ConsultationResponse } from "./consultation-context.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PROMPT_CHARS = 24_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_MODEL_CHARS = 200;
const TERMINATION_GRACE_MS = 1_000;
const MAX_EVENT_NODES = 2_000;
const OPENCODE_ADVISOR_AGENT = "blackbook-advisor";

export type ConsultationError =
  | { category: "unavailable"; message: string }
  | { category: "cancelled"; message: string }
  | { category: "timeout"; message: string }
  | { category: "process"; message: string; exitCode?: number | null; stderr?: string }
  | { category: "malformed-output"; message: string }
  | { category: "schema-validation"; message: string }
  | { category: "invalid-input"; message: string };

export type ConsultationResult =
  | { ok: true; response: ConsultationResponse }
  | { ok: false; error: ConsultationError };

export interface ConsultationInput {
  /** The configured advisory runtime. */
  runtime: ConsultationRuntime;
  /** Optional model identifier. An empty string preserves the runtime default. */
  model?: string;
  /** The enabled target selected in Blackbook's configured tool instances. */
  instance: Pick<ToolInstance, "toolId" | "enabled"> | null | undefined;
  /** The installed executable reported by tool detection. It must be absolute. */
  binaryPath: string | null | undefined;
  /** A bounded, data-only advisory prompt created by the consultation context builder. */
  prompt: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPromptChars?: number;
  maxOutputBytes?: number;
}

export type SpawnConsultationProcess = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; shell: false; stdio: ["ignore", "pipe", "pipe"]; windowsHide: true },
) => ChildProcess;

type TimerHandle = NodeJS.Timeout;
type ScheduleTimer = (callback: () => void, delay?: number) => TimerHandle;
type CancelTimer = (timer: TimerHandle) => void;

export interface ConsultationRunnerDependencies {
  spawnProcess?: SpawnConsultationProcess;
  setTimeout?: ScheduleTimer;
  clearTimeout?: CancelTimer;
}

function isPositiveFiniteInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function runtimeLabel(runtime: ConsultationRuntime): string {
  switch (runtime) {
    case "claude-code":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
  }
}

/** Returns the executable only for the selected enabled runtime and a safe absolute detection result. */
export function resolveConsultationExecutable(
  runtime: ConsultationRuntime,
  instance: ConsultationInput["instance"],
  binaryPath: ConsultationInput["binaryPath"],
): string | null {
  if (instance?.toolId !== runtime || !instance.enabled) return null;
  if (typeof binaryPath !== "string" || binaryPath.length === 0 || binaryPath.includes("\0") || !isAbsolute(binaryPath)) {
    return null;
  }
  return binaryPath;
}

/**
 * Each runtime keeps its configured authentication and default model unless a
 * non-empty model setting is supplied. Every invocation is non-interactive,
 * shell-free, and disables project inspection and mutation capabilities.
 */
export function buildConsultationArgs(
  runtime: ConsultationRuntime,
  prompt: string,
  model: string,
): string[] {
  const modelArgs = model ? ["--model", model] : [];

  switch (runtime) {
    case "claude-code":
      return [
        "--print", "--output-format", "text", "--safe-mode", "--no-session-persistence", "--tools", "",
        ...modelArgs, prompt,
      ];
    case "opencode":
      return [
        "--pure", "run", "--agent", OPENCODE_ADVISOR_AGENT, "--format", "json",
        ...modelArgs, prompt,
      ];
    case "pi":
      return [
        "--mode", "json", "--print", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-context-files", "--no-themes", ...modelArgs, prompt,
      ];
  }
}

const ConsultationResponseSchema = z.object({
  summary: z.string(),
  proposals: z.array(z.object({
    id: z.string(),
    operation: z.enum(["install", "remove", "enable", "disable", "resync", "keep", "select_action"]),
    target: z.string(),
    reason: z.string(),
  }).strict()),
}).strict();

/** Validates the shared advisory envelope before it reaches the UI or an action handler. */
export function validateConsultationResponse(value: unknown): ConsultationResult {
  const parsed = ConsultationResponseSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: { category: "schema-validation", message: parsed.error.issues[0]?.message ?? "Response does not match the consultation schema." },
    };
  }
  return { ok: true, response: parsed.data as ConsultationResponse };
}

function textFromAssistantMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("role" in value) || value.role !== "assistant") {
    return null;
  }
  if (!("content" in value)) return null;
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return null;

  const text = value.content
    .filter((part): part is { type: "text"; text: string } =>
      typeof part === "object" &&
      part !== null &&
      !Array.isArray(part) &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  return text || null;
}

function textFromTextPart(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("type" in value) ||
    value.type !== "text" ||
    !("text" in value) ||
    typeof value.text !== "string"
  ) {
    return null;
  }
  return value.text || null;
}

function assistantTextCandidates(value: unknown): string[] {
  const candidates: string[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [value];

  while (pending.length > 0 && seen.size < MAX_EVENT_NODES) {
    const current = pending.pop();
    const text = textFromAssistantMessage(current) ?? textFromTextPart(current);
    if (text !== null) candidates.push(text);

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) pending.push(current[index]);
    } else if (typeof current === "object" && current !== null && !seen.has(current)) {
      seen.add(current);
      const values = Object.values(current);
      for (let index = values.length - 1; index >= 0; index -= 1) pending.push(values[index]);
    }
  }

  return candidates;
}

/** Extracts the final assistant text from Pi or OpenCode's JSONL output stream. */
export function extractFinalStructuredAssistantText(stdout: string): string | null {
  const authoritative: string[] = [];
  const fallback: string[] = [];
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      return null;
    }

    const candidates = assistantTextCandidates(event);
    if (
      typeof event === "object" &&
      event !== null &&
      !Array.isArray(event) &&
      "type" in event &&
      event.type === "message_end"
    ) {
      authoritative.push(...candidates);
    } else {
      fallback.push(...candidates);
    }
  }

  return authoritative.at(-1) ?? fallback.at(-1) ?? null;
}

function parseResponseText(text: string): unknown | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createOpenCodeSandbox(): string {
  const directory = mkdtempSync(join(tmpdir(), "blackbook-consultation-"));
  const configPath = join(directory, "opencode.json");
  const config = {
    $schema: "https://opencode.ai/config.json",
    agent: {
      [OPENCODE_ADVISOR_AGENT]: {
        description: "Returns advisory JSON only.",
        mode: "primary",
        permission: "deny",
        steps: 1,
      },
    },
    autoupdate: false,
    instructions: [],
    lsp: false,
    mcp: {},
    plugin: [],
    share: "disabled",
    snapshot: false,
  };

  try {
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function removeOpenCodeSandbox(directory: string | undefined): void {
  if (directory) rmSync(directory, { recursive: true, force: true });
}


/** Creates a runner with a replaceable launcher for deterministic, process-free tests. */
export function createConsultationRunner(dependencies: ConsultationRunnerDependencies = {}) {
  const launch = dependencies.spawnProcess ?? (spawn as unknown as SpawnConsultationProcess);
  const schedule = dependencies.setTimeout ?? setTimeout;
  const cancelSchedule = dependencies.clearTimeout ?? clearTimeout;

  async function run(input: ConsultationInput): Promise<ConsultationResult> {
    if (input.runtime !== "pi" && input.runtime !== "claude-code" && input.runtime !== "opencode") {
      return { ok: false, error: { category: "invalid-input", message: "Consultation runtime is invalid." } };
    }
    const executable = resolveConsultationExecutable(input.runtime, input.instance, input.binaryPath);
    if (!executable) {
      return {
        ok: false,
        error: { category: "unavailable", message: `An enabled ${runtimeLabel(input.runtime)} instance with an installed absolute executable path is required.` },
      };
    }
    if (typeof input.prompt !== "string") {
      return { ok: false, error: { category: "invalid-input", message: "Consultation prompt must be a string." } };
    }
    if (
      input.model !== undefined &&
      (typeof input.model !== "string" || input.model.includes("\0") || input.model.trim().length > MAX_MODEL_CHARS)
    ) {
      return { ok: false, error: { category: "invalid-input", message: `Consultation model must be a ${MAX_MODEL_CHARS}-character string without NUL characters.` } };
    }

    const maxPromptChars = input.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!isPositiveFiniteInteger(maxPromptChars) || !isPositiveFiniteInteger(maxOutputBytes) || !isPositiveFiniteInteger(timeoutMs)) {
      return { ok: false, error: { category: "invalid-input", message: "Consultation limits must be positive integers." } };
    }
    if (input.prompt.length > maxPromptChars) {
      return { ok: false, error: { category: "invalid-input", message: `Consultation prompt exceeds the ${maxPromptChars}-character limit.` } };
    }
    if (input.signal?.aborted) return { ok: false, error: { category: "cancelled", message: "Consultation was cancelled before the advisor started." } };

    const model = input.model?.trim() ?? "";
    let openCodeSandbox: string | undefined;
    try {
      if (input.runtime === "opencode") openCodeSandbox = createOpenCodeSandbox();
    } catch (error) {
      return { ok: false, error: { category: "process", message: errorMessage(error) } };
    }

    return new Promise<ConsultationResult>((resolve) => {
      let child: ChildProcess;
      const spawnOptions: Parameters<SpawnConsultationProcess>[2] = {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      };
      if (openCodeSandbox) spawnOptions.cwd = openCodeSandbox;
      try {
        child = launch(executable, buildConsultationArgs(input.runtime, input.prompt, model), spawnOptions);
      } catch (error) {
        removeOpenCodeSandbox(openCodeSandbox);
        resolve({ ok: false, error: { category: "process", message: errorMessage(error) } });
        return;
      }

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      let terminalError: ConsultationError | null = null;
      let forceKillTimer: TimerHandle | undefined;
      let timeoutTimer: TimerHandle | undefined;

      const settle = (result: ConsultationResult) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) cancelSchedule(timeoutTimer);
        if (forceKillTimer) cancelSchedule(forceKillTimer);
        input.signal?.removeEventListener("abort", onAbort);
        removeOpenCodeSandbox(openCodeSandbox);
        resolve(result);
      };

      const requestTermination = (error: ConsultationError) => {
        if (terminalError) return;
        terminalError = error;
        forceKillTimer = schedule(() => {
          child.kill("SIGKILL");
          settle({ ok: false, error });
        }, TERMINATION_GRACE_MS);
        child.kill("SIGTERM");
      };

      const onAbort = () => requestTermination({ category: "cancelled", message: "Consultation was cancelled." });
      timeoutTimer = schedule(() => requestTermination({ category: "timeout", message: `Consultation exceeded the ${timeoutMs}ms limit.` }), timeoutMs);

      input.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout?.on("data", (chunk: string | Buffer) => {
        if (settled || terminalError) return;
        outputBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        if (outputBytes > maxOutputBytes) {
          requestTermination({ category: "malformed-output", message: `Advisor output exceeded the ${maxOutputBytes}-byte limit.` });
          return;
        }
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: string | Buffer) => {
        if (settled || terminalError) return;
        outputBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        if (outputBytes > maxOutputBytes) {
          requestTermination({ category: "malformed-output", message: `Advisor output exceeded the ${maxOutputBytes}-byte limit.` });
          return;
        }
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.once("error", (error) => {
        if (terminalError) {
          settle({ ok: false, error: terminalError });
          return;
        }
        settle({ ok: false, error: { category: "process", message: errorMessage(error), stderr: stderr || undefined } });
      });
      child.once("close", (exitCode) => {
        if (terminalError) {
          settle({ ok: false, error: terminalError });
          return;
        }
        if (exitCode !== 0) {
          settle({
            ok: false,
            error: { category: "process", message: `${runtimeLabel(input.runtime)} exited with code ${String(exitCode)}.`, exitCode, stderr: stderr || undefined },
          });
          return;
        }

        const text = input.runtime === "claude-code" ? stdout.trim() || null : extractFinalStructuredAssistantText(stdout);
        if (text === null) {
          settle({ ok: false, error: { category: "malformed-output", message: "The advisor did not emit a valid final JSON response." } });
          return;
        }
        const parsed = parseResponseText(text);
        if (parsed === null) {
          settle({ ok: false, error: { category: "malformed-output", message: "The advisor response was not JSON." } });
          return;
        }
        settle(validateConsultationResponse(parsed));
      });
    });
  }

  return { run };
}

export const consultationRunner = createConsultationRunner();

export function runConsultation(input: ConsultationInput): Promise<ConsultationResult> {
  return consultationRunner.run(input);
}
