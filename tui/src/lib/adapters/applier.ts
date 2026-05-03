/**
 * Shared `apply` execution — every adapter delegates here for common-spine ops.
 *
 * Adapters wrap this with their own bundle install/uninstall and MCP emission.
 *
 * SAFETY INVARIANTS:
 *   - Removals require {@link ApplyOpts.confirmRemovals}; otherwise reported as skipped.
 *   - Dry-run never touches disk.
 *   - All writes are atomic (tmp + rename).
 */

import type {
  ApplyError,
  ApplyOpts,
  ApplyResult,
  Diff,
  DiffOp,
} from "../playbook/index.js";
import {
  atomicCopyDir,
  atomicCopyFile,
  ensureDir,
  removePath,
} from "./base.js";
import { dirname } from "node:path";
import { existsSync, statSync } from "node:fs";

/**
 * Execute the common-spine ops in a Diff. Returns lists of performed/skipped/errors.
 *
 * Ops with `artifactType === "bundle"` are NOT handled here — adapters must
 * route them through their own installBundle/uninstallBundle.
 */
export function applyCommonSpine(diff: Diff, opts: ApplyOpts): ApplyResult {
  const performed: DiffOp[] = [];
  const skipped: DiffOp[] = [];
  const errors: ApplyError[] = [];

  for (const op of diff.ops) {
    if (op.artifactType === "bundle") {
      // Bundles handled at adapter layer; pass through as skipped here.
      skipped.push(op);
      continue;
    }

    if (op.kind === "no-op") {
      // Don't surface no-ops in performed; tests can check via skipped if needed.
      continue;
    }

    if (op.kind === "remove" && !opts.confirmRemovals) {
      skipped.push(op);
      continue;
    }

    if (opts.dryRun) {
      performed.push(op);
      continue;
    }

    try {
      executeOp(op);
      performed.push(op);
    } catch (err) {
      errors.push({ op, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    toolId: diff.toolId,
    instanceId: diff.instanceId,
    performed,
    skipped,
    errors,
  };
}

function executeOp(op: DiffOp): void {
  switch (op.kind) {
    case "add":
    case "update": {
      if (!op.sourcePath || !op.targetPath) {
        throw new Error(`op missing source/target: ${op.name}`);
      }
      if (!existsSync(op.sourcePath)) {
        throw new Error(`source path does not exist: ${op.sourcePath}`);
      }
      const stat = statSync(op.sourcePath);
      ensureDir(dirname(op.targetPath));
      if (stat.isDirectory()) {
        atomicCopyDir(op.sourcePath, op.targetPath);
      } else {
        atomicCopyFile(op.sourcePath, op.targetPath);
      }
      return;
    }
    case "remove": {
      if (!op.targetPath) {
        throw new Error(`remove op missing targetPath: ${op.name}`);
      }
      removePath(op.targetPath);
      return;
    }
    case "no-op":
      return;
  }
}
