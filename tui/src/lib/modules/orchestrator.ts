import type { Module, CheckResult, ApplyResult } from "./types.js";

/**
 * Run a step's check(), converting any thrown exception into a `failed`
 * CheckResult. This keeps one misbehaving module (e.g. an ENOENT race when a
 * file is deleted mid-scan) from aborting the entire batch.
 */
async function safeCheck(module: Module<unknown>, params: unknown): Promise<CheckResult> {
  try {
    return await module.check(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message, error: message };
  }
}

/**
 * Run a step's apply(), converting any thrown exception into a non-changed
 * ApplyResult carrying the error. Matches the failure shape modules already
 * produce on recoverable errors so aggregation counts it correctly and the
 * remaining steps in the batch still run.
 */
async function safeApply(module: Module<unknown>, params: unknown): Promise<ApplyResult> {
  try {
    return await module.apply(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { changed: false, message, error: message };
  }
}

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
    const check = await safeCheck(step.module, step.params);
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
    const check = await safeCheck(step.module, step.params);

    if (check.status === "ok" || check.status === "failed") {
      results.push({ label: step.label, check });
      continue;
    }

    // Skip if not in filter (when filter is provided)
    if (filter && !filter.has(step.label)) {
      results.push({ label: step.label, check });
      continue;
    }

    const apply = await safeApply(step.module, step.params);
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
