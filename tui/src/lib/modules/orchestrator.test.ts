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

  it("contains a thrown check() as a failed result and continues", async () => {
    const throwing: Module<unknown> = {
      name: "throwing",
      check: async () => {
        throw new Error("scan race ENOENT");
      },
      apply: async () => ({ changed: true, message: "applied" }),
    };

    const result = await runCheck([
      { label: "boom", module: throwing, params: {} },
      { label: "ok", module: mockModule({ status: "ok", message: "ok" }), params: {} },
    ]);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].check.status).toBe("failed");
    expect(result.steps[0].check.error).toContain("scan race ENOENT");
    expect(result.summary.ok).toBe(1);
    expect(result.summary.failed).toBe(1);
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

  it("contains a thrown apply() and still applies the remaining steps", async () => {
    const throwing: Module<unknown> = {
      name: "throwing",
      check: async () => ({ status: "drifted", message: "drifted" }),
      apply: async () => {
        throw new Error("cpSync EACCES");
      },
    };
    const succeeding = mockModule(
      { status: "missing", message: "missing" },
      { changed: true, message: "created" }
    );

    const result = await runApply([
      { label: "boom", module: throwing, params: {} },
      { label: "good", module: succeeding, params: {} },
    ]);

    // Batch completed without the exception escaping runApply.
    expect(result.steps).toHaveLength(2);

    // Throwing step surfaces as a non-changed apply carrying the error.
    const boom = result.steps.find((s) => s.label === "boom")!;
    expect(boom.apply).toBeDefined();
    expect(boom.apply!.changed).toBe(false);
    expect(boom.apply!.error).toContain("cpSync EACCES");

    // The later step still got its chance to apply.
    const good = result.steps.find((s) => s.label === "good")!;
    expect(good.apply).toBeDefined();
    expect(good.apply!.changed).toBe(true);
    expect(result.summary.changed).toBe(1);
  });

  it("contains a thrown check() as a failed result", async () => {
    const throwingCheck: Module<unknown> = {
      name: "throwing-check",
      check: async () => {
        throw new Error("readFileSync ENOENT");
      },
      apply: async () => ({ changed: true, message: "applied" }),
    };
    const succeeding = mockModule(
      { status: "missing", message: "missing" },
      { changed: true, message: "created" }
    );

    const result = await runApply([
      { label: "bad-check", module: throwingCheck, params: {} },
      { label: "good", module: succeeding, params: {} },
    ]);

    expect(result.steps).toHaveLength(2);
    const badCheck = result.steps.find((s) => s.label === "bad-check")!;
    expect(badCheck.check.status).toBe("failed");
    expect(badCheck.check.error).toContain("readFileSync ENOENT");
    expect(badCheck.apply).toBeUndefined(); // failed checks are not applied
    expect(result.summary.failed).toBe(1);
    expect(result.summary.changed).toBe(1);
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
