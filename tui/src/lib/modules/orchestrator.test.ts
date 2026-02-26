import { describe, it, expect } from "vitest";
import { runCheck, runApply } from "./orchestrator.js";
import type { Module, CheckResult, ApplyResult } from "./types.js";

function mockModule(checkResult: CheckResult, applyResult?: ApplyResult): Module<unknown> {
  return {
    name: "mock",
    check: async () => checkResult,
    apply: async () => applyResult ?? { changed: true, message: "applied" },
  };
}

describe("runCheck", () => {
  it("collects check results from all steps", async () => {
    const result = await runCheck([
      { label: "file-a", module: mockModule({ status: "ok", message: "ok" }), params: {} },
      { label: "file-b", module: mockModule({ status: "missing", message: "missing" }), params: {} },
      { label: "file-c", module: mockModule({ status: "drifted", message: "drifted" }), params: {} },
    ]);

    expect(result.steps).toHaveLength(3);
    expect(result.summary.ok).toBe(1);
    expect(result.summary.missing).toBe(1);
    expect(result.summary.drifted).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.changed).toBe(0);
  });

  it("does not call apply", async () => {
    let applyCalled = false;
    const mod: Module<unknown> = {
      name: "test",
      check: async () => ({ status: "missing", message: "missing" }),
      apply: async () => {
        applyCalled = true;
        return { changed: true, message: "applied" };
      },
    };

    await runCheck([{ label: "test", module: mod, params: {} }]);
    expect(applyCalled).toBe(false);
  });
});

describe("runApply", () => {
  it("applies to non-ok items", async () => {
    const result = await runApply([
      { label: "ok-item", module: mockModule({ status: "ok", message: "ok" }), params: {} },
      {
        label: "missing-item",
        module: mockModule(
          { status: "missing", message: "missing" },
          { changed: true, message: "created" }
        ),
        params: {},
      },
    ]);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].apply).toBeUndefined();
    expect(result.steps[1].apply).toBeDefined();
    expect(result.steps[1].apply!.changed).toBe(true);
    expect(result.summary.changed).toBe(1);
  });

  it("skips failed items", async () => {
    let applyCalled = false;
    const mod: Module<unknown> = {
      name: "test",
      check: async () => ({ status: "failed", message: "error", error: "test error" }),
      apply: async () => {
        applyCalled = true;
        return { changed: true, message: "applied" };
      },
    };

    await runApply([{ label: "test", module: mod, params: {} }]);
    expect(applyCalled).toBe(false);
  });

  it("respects filter", async () => {
    const result = await runApply(
      [
        {
          label: "include-me",
          module: mockModule({ status: "drifted", message: "" }, { changed: true, message: "" }),
          params: {},
        },
        {
          label: "skip-me",
          module: mockModule({ status: "missing", message: "" }, { changed: true, message: "" }),
          params: {},
        },
      ],
      new Set(["include-me"])
    );

    expect(result.steps[0].apply).toBeDefined();
    expect(result.steps[1].apply).toBeUndefined();
    expect(result.summary.changed).toBe(1);
  });
});
