import type { Module, CheckResult, ApplyResult } from "./types.js";

export interface OrchestratorStep {
  label: string;
  module: Module<unknown>;
  params: unknown;
}

export interface StepResult {
  label: string;
  check: CheckResult;
  apply?: ApplyResult;
}

export interface OrchestratorResult {
  steps: StepResult[];
  summary: {
    ok: number;
    missing: number;
    drifted: number;
    failed: number;
    changed: number;
  };
}

/**
 * Run check() on all steps. Never mutates the filesystem.
 */
export async function runCheck(steps: OrchestratorStep[]): Promise<OrchestratorResult> {
  const results: StepResult[] = [];

  for (const step of steps) {
    const check = await step.module.check(step.params);
    results.push({ label: step.label, check });
  }

  return buildResult(results);
}

/**
 * Run check() then apply() for non-ok items.
 * Optionally filter by label to selectively sync.
 */
export async function runApply(
  steps: OrchestratorStep[],
  filter?: Set<string>
): Promise<OrchestratorResult> {
  const results: StepResult[] = [];

  for (const step of steps) {
    const check = await step.module.check(step.params);

    if (check.status === "ok" || check.status === "failed") {
      results.push({ label: step.label, check });
      continue;
    }

    // Skip if not in filter (when filter is provided)
    if (filter && !filter.has(step.label)) {
      results.push({ label: step.label, check });
      continue;
    }

    const apply = await step.module.apply(step.params);
    results.push({ label: step.label, check, apply });
  }

  return buildResult(results);
}

function buildResult(steps: StepResult[]): OrchestratorResult {
  const summary = { ok: 0, missing: 0, drifted: 0, failed: 0, changed: 0 };

  for (const step of steps) {
    summary[step.check.status]++;
    if (step.apply?.changed) summary.changed++;
  }

  return { steps, summary };
}
