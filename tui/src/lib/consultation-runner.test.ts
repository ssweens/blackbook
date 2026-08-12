import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildConsultationArgs,
  createConsultationRunner,
  extractFinalStructuredAssistantText,
  type ConsultationInput,
  type SpawnConsultationProcess,
} from "./consultation-runner.js";

class FakePiChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((signal?: NodeJS.Signals) => {
    queueMicrotask(() => this.emit("close", null, signal));
    return true;
  });

  complete(stdout: string, exitCode = 0, stderr = "") {
    if (stdout) this.stdout.emit("data", Buffer.from(stdout));
    if (stderr) this.stderr.emit("data", Buffer.from(stderr));
    this.emit("close", exitCode, null);
  }
}

function input(overrides: Partial<ConsultationInput> = {}): ConsultationInput {
  return {
    runtime: "pi",
    instance: { toolId: "pi", enabled: true },
    binaryPath: "/Users/example/.bun/bin/pi",
    prompt: "Return one advisory consultation response.",
    ...overrides,
  };
}

function messageEvent(text: string) {
  return `${JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  })}\n`;
}

function runnerWithChild(child = new FakePiChild()) {
  const spawnSpy = vi.fn<SpawnConsultationProcess>(() => child as unknown as ChildProcess);
  return {
    child,
    spawnSpy,
    runner: createConsultationRunner({ spawnProcess: spawnSpy }),
  };
}

describe("consultation runner", () => {
  it("launches only the detected absolute Pi executable with safe, capability-free argv", async () => {
    const { child, spawnSpy, runner } = runnerWithChild();
    const run = runner.run(input({ prompt: "untrusted; $(touch should-not-run)" }));
    child.complete(messageEvent('{"summary":"Keep it","analysis":{"recommendedProposalId":null,"whatChanged":"No changes are present.","recency":"No timestamps are available.","assessment":"Keep the current state."},"proposals":[]}'));

    await expect(run).resolves.toEqual({
      ok: true,
      response: {
        summary: "Keep it",
        analysis: {
          recommendedProposalId: null,
          whatChanged: "No changes are present.",
          recency: "No timestamps are available.",
          assessment: "Keep the current state.",
        },
        proposals: [],
      },
    });
    expect(spawnSpy).toHaveBeenCalledWith(
      "/Users/example/.bun/bin/pi",
      [
        "--mode", "json", "--print", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
        "--no-prompt-templates", "--no-context-files", "--no-themes", "untrusted; $(touch should-not-run)",
      ],
      { shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    expect(spawnSpy.mock.calls[0]?.[1]).not.toContain("--provider");
    expect(spawnSpy.mock.calls[0]?.[1]).not.toContain("--model");
    expect(spawnSpy.mock.calls[0]?.[1]).not.toContain("--api-key");
  });

  it("builds non-interactive argv for every configured runtime and forwards only an explicit model", () => {
    expect(buildConsultationArgs("pi", "review", "")).toEqual([
      "--mode", "json", "--print", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-themes", "review",
    ]);
    expect(buildConsultationArgs("claude-code", "review", "claude-sonnet")).toEqual([
      "--print", "--output-format", "text", "--safe-mode", "--no-session-persistence", "--tools", "",
      "--model", "claude-sonnet", "review",
    ]);
    expect(buildConsultationArgs("opencode", "review", "openai/gpt-5.6")).toEqual([
      "--pure", "run", "--agent", "blackbook-advisor", "--format", "json",
      "--model", "openai/gpt-5.6", "review",
    ]);
  });

  it("does not launch unless the configured Pi instance is enabled and its detected binary is absolute", async () => {
    const { spawnSpy, runner } = runnerWithChild();

    await expect(runner.run(input({ instance: { toolId: "pi", enabled: false } }))).resolves.toMatchObject({
      ok: false,
      error: { category: "unavailable" },
    });
    await expect(runner.run(input({ binaryPath: "pi" }))).resolves.toMatchObject({
      ok: false,
      error: { category: "unavailable" },
    });
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized prompts before launch and terminates oversized streamed output", async () => {
    const promptLimited = runnerWithChild();
    await expect(promptLimited.runner.run(input({ maxPromptChars: 3 }))).resolves.toMatchObject({
      ok: false,
      error: { category: "invalid-input" },
    });
    expect(promptLimited.spawnSpy).not.toHaveBeenCalled();

    const outputLimited = runnerWithChild();
    const run = outputLimited.runner.run(input({ maxOutputBytes: 4 }));
    outputLimited.child.stdout.emit("data", Buffer.from("12345"));
    await expect(run).resolves.toMatchObject({ ok: false, error: { category: "malformed-output" } });
    expect(outputLimited.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("recognizes the authoritative final assistant event through a non-fixed outer shape", () => {
    const stdout = `${JSON.stringify({
      type: "message_end",
      payload: { assistant: { role: "assistant", content: [{ type: "text", text: '{"summary":"Use local state","proposals":[]}' }] } },
    })}\n`;

    expect(extractFinalStructuredAssistantText(stdout)).toBe('{"summary":"Use local state","proposals":[]}');
  });

  it("distinguishes malformed JSON output from a well-formed but invalid consultation schema", async () => {
    const malformed = runnerWithChild();
    const malformedRun = malformed.runner.run(input());
    malformed.child.complete(messageEvent("not JSON"));
    await expect(malformedRun).resolves.toMatchObject({ ok: false, error: { category: "malformed-output" } });

    const invalidSchema = runnerWithChild();
    const schemaRun = invalidSchema.runner.run(input());
    invalidSchema.child.complete(messageEvent('{"summary":"Act","proposals":[{"id":"1","operation":"execute","target":"x","reason":"no"}]}'));
    await expect(schemaRun).resolves.toMatchObject({ ok: false, error: { category: "schema-validation" } });
  });

  it("reports Pi process failures without treating stderr as advisory output", async () => {
    const { child, runner } = runnerWithChild();
    const run = runner.run(input());
    child.complete("", 2, "provider unavailable");

    await expect(run).resolves.toMatchObject({
      ok: false,
      error: { category: "process", exitCode: 2, stderr: "provider unavailable" },
    });
  });

  it("kills the process and reports cancellation when its AbortSignal fires", async () => {
    const controller = new AbortController();
    const { child, runner } = runnerWithChild();
    const run = runner.run(input({ signal: controller.signal }));
    controller.abort();

    await expect(run).resolves.toMatchObject({ ok: false, error: { category: "cancelled" } });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kills a stalled process and reports timeout", async () => {
    const child = new FakePiChild();
    const spawnSpy = vi.fn<SpawnConsultationProcess>(() => child as unknown as ChildProcess);
    const timer = vi.fn((callback: () => void) => {
      queueMicrotask(callback);
      return 1 as unknown as NodeJS.Timeout;
    });
    const runner = createConsultationRunner({
      spawnProcess: spawnSpy,
      setTimeout: timer,
      clearTimeout: vi.fn(),
    });

    await expect(runner.run(input({ timeoutMs: 1 }))).resolves.toMatchObject({ ok: false, error: { category: "timeout" } });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
