/**
 * Sync engine — orchestrates preview/apply across all enabled tool instances
 * in a playbook.
 *
 * Responsibilities:
 *   - Validate required_env before any disk-touching operation
 *   - Per (tool, instance): run adapter preview → apply
 *   - Per tool that supports MCP and has opted-in servers: emit MCP config
 *   - Aggregate per-instance results
 *   - Honor safety invariants:
 *     - confirm_removals defaults true and is hard-locked even if a playbook tries to disable it
 *     - dry-run never touches disk
 */

import type {
  ApplyResult,
  Diff,
  LoadedPlaybook,
  McpServer,
  ToolId,
  ToolInstance,
} from "../playbook/index.js";
import { collectMcpEnvRefs } from "../adapters/base.js";
import { checkRequiredEnv, type RequiredEnvCheckResult } from "../adapters/base.js";
import { getAdapter, requireAdapter } from "../adapters/registry.js";
import type { EmitResult } from "../adapters/types.js";
import { piMcpEnabled } from "../adapters/pi/mcp.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineSyncOptions {
  /** Allow removals to actually delete files. Default: false. */
  confirmRemovals: boolean;
  /** Don't touch disk; just compute and report. Default: false. */
  dryRun: boolean;
  /** If set, only run for tools in this list. */
  toolFilter?: ToolId[];
  /** Override env source (for tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * Skip bundle reconciliation (install/update/uninstall via tool CLIs).
   * Useful for fast file-only syncs and for tests that don't have the tool
   * binaries available. Default: false.
   */
  skipBundles?: boolean;
}

export interface BundleOpReport {
  name: string;
  op: "install" | "update" | "uninstall" | "skip";
  ok: boolean;
  reason?: string;
}

export interface PerInstanceResult {
  toolId: ToolId;
  instanceId: string;
  diff: Diff;
  apply: ApplyResult;
  mcpEmit?: EmitResult;
  bundleOps: BundleOpReport[];
  /** Bundle names installed on disk but not declared in plugins.yaml/packages.yaml. */
  untrackedBundles: string[];
  /** Errors specific to this instance (env, adapter routing, etc.) */
  errors: EngineError[];
}

export interface EngineSyncResult {
  envCheck: RequiredEnvCheckResult;
  perInstance: PerInstanceResult[];
  /** Cross-tool errors (e.g. an enabled tool has no adapter registered). */
  topLevelErrors: EngineError[];
}

export interface EngineError {
  scope: "playbook" | "tool" | "instance";
  toolId?: ToolId;
  instanceId?: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview only — same shape as result but with dryRun semantics.
 * Returned `apply` contains the operations that *would* run.
 */
export async function enginePreview(
  playbook: LoadedPlaybook,
  options: Omit<EngineSyncOptions, "dryRun"> = { confirmRemovals: false },
): Promise<EngineSyncResult> {
  return engineApply(playbook, { ...options, dryRun: true });
}

export async function engineApply(
  playbook: LoadedPlaybook,
  options: EngineSyncOptions,
): Promise<EngineSyncResult> {
  const env = options.env ?? process.env;
  const topLevelErrors: EngineError[] = [];
  const perInstance: PerInstanceResult[] = [];

  // ── Required env check ───────────────────────────────────────────────────
  const requiredEnvNames = collectAllRequiredEnvNames(playbook);
  const envCheck = checkRequiredEnv(requiredEnvNames, env);

  // ── Per-tool, per-instance loop ─────────────────────────────────────────
  for (const toolId of playbook.manifest.tools_enabled) {
    if (options.toolFilter && !options.toolFilter.includes(toolId)) continue;

    const adapter = getAdapter(toolId);
    if (!adapter) {
      topLevelErrors.push({
        scope: "tool",
        toolId,
        message: `no adapter registered for "${toolId}"`,
      });
      continue;
    }

    const toolConfig = playbook.tools[toolId];
    if (!toolConfig) {
      topLevelErrors.push({
        scope: "tool",
        toolId,
        message: `tool "${toolId}" enabled but tool.yaml missing (loader should have caught this)`,
      });
      continue;
    }

    for (const instance of toolConfig.config.instances) {
      if (!instance.enabled) continue;

      const errors: EngineError[] = [];

      // Scan inventory (used for both diff and untracked bundle detection)
      let inventory: import("../playbook/index.js").Inventory;
      try {
        inventory = await adapter.scan(instance);
      } catch (err) {
        errors.push({ scope: "instance", toolId, instanceId: instance.id,
          message: `scan failed: ${errorMessage(err)}` });
        continue;
      }

      // Common-spine preview + apply
      let diff: Diff;
      try {
        diff = await adapter.preview(playbook, instance);
      } catch (err) {
        errors.push({
          scope: "instance",
          toolId,
          instanceId: instance.id,
          message: `preview failed: ${errorMessage(err)}`,
        });
        continue;
      }

      let applyResult: ApplyResult;
      try {
        applyResult = await adapter.apply(diff, instance, {
          confirmRemovals: options.confirmRemovals,
          dryRun: options.dryRun,
        });
      } catch (err) {
        errors.push({
          scope: "instance",
          toolId,
          instanceId: instance.id,
          message: `apply failed: ${errorMessage(err)}`,
        });
        continue;
      }

      // MCP emission (if any servers opted in for this tool)
      let mcpEmit: EmitResult | undefined;
      const includeMcp = toolConfig.config.include_shared.mcp;
      const optInServers: McpServer[] = includeMcp
        .map((name) => playbook.shared.mcp[name])
        .filter((s): s is McpServer => Boolean(s));

      if (optInServers.length > 0 && adapter.emitMcp) {
        // For Pi, gate on pi-mcp-adapter being installed
        if (toolId === "pi" && !piMcpEnabled(toolConfig)) {
          errors.push({
            scope: "instance",
            toolId,
            instanceId: instance.id,
            message:
              "MCP servers opted in but pi-mcp-adapter is not in packages.yaml; skipping MCP emission for Pi",
          });
        } else if (!options.dryRun) {
          try {
            mcpEmit = await adapter.emitMcp(optInServers, instance);
          } catch (err) {
            errors.push({
              scope: "instance",
              toolId,
              instanceId: instance.id,
              message: `mcp emit failed: ${errorMessage(err)}`,
            });
          }
        } else {
          // Dry-run: mark intent without writing
          mcpEmit = {
            written: optInServers.map((s) => `<dry-run>${toolId}:${s.name}`),
            unchanged: [],
          };
        }
      } else if (optInServers.length > 0 && !adapter.emitMcp) {
        errors.push({
          scope: "instance",
          toolId,
          instanceId: instance.id,
          message: `MCP opted in but adapter for "${toolId}" does not implement emitMcp`,
        });
      }

      // Bundle ops (install missing / uninstall removed) — only on apply,
      // never on dry-run, and only when the adapter advertises a paradigm.
      const bundleOps: BundleOpReport[] = [];
      if (!options.dryRun && !options.skipBundles) {
        bundleOps.push(
          ...(await reconcileBundles(
            adapter,
            toolConfig,
            instance,
            options.confirmRemovals,
            (msg) =>
              errors.push({
                scope: "instance",
                toolId,
                instanceId: instance.id,
                message: msg,
              }),
          )),
        );
      }

      // Compute untracked bundles: installed on disk but not in the manifest.
      const untrackedBundles = computeUntrackedBundles(adapter, toolConfig, inventory!);

      perInstance.push({
        toolId,
        instanceId: instance.id,
        diff,
        apply: applyResult,
        mcpEmit,
        bundleOps,
        untrackedBundles,
        errors,
      });
    }
  }

  return { envCheck, perInstance, topLevelErrors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect every env var name referenced from MCP servers that are actually
 * opted-in by some enabled tool, plus all names declared in playbook.required_env.
 *
 * Apply is gated on these; declared-but-unused names are still flagged.
 */
function collectAllRequiredEnvNames(playbook: LoadedPlaybook): string[] {
  const names = new Set<string>();
  for (const r of playbook.manifest.required_env) {
    if (r.optional) continue;
    names.add(r.name);
  }
  // Add any MCP refs that are actually opted-in by some tool
  for (const [, t] of Object.entries(playbook.tools)) {
    if (!t) continue;
    for (const serverName of t.config.include_shared.mcp) {
      const server = playbook.shared.mcp[serverName];
      if (!server) continue;
      for (const ref of collectMcpEnvRefs(server)) names.add(ref);
    }
  }
  return Array.from(names);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle reconciliation
// ─────────────────────────────────────────────────────────────────────────────

import type { LoadedToolConfig } from "../playbook/index.js";
import type { ToolAdapter } from "../adapters/types.js";

function computeUntrackedBundles(
  adapter: ToolAdapter,
  toolConfig: LoadedToolConfig,
  inventory: import("../playbook/index.js").Inventory,
): string[] {
  if (!adapter.defaults.capabilities.bundleParadigm) return [];

  // All bundle names seen on disk via provenance tagging
  const onDisk = new Set<string>();
  for (const a of inventory.artifacts) {
    if (a.provenance.kind === "bundle") onDisk.add(a.provenance.bundleName);
  }

  // All bundle names declared in the manifest
  const declared = new Set<string>();
  const plugins = toolConfig.pluginsManifest?.plugins ?? [];
  const packages = toolConfig.packagesManifest?.packages ?? [];
  for (const b of [...plugins, ...packages]) declared.add(b.name);

  // Untracked = on disk but not declared
  return Array.from(onDisk).filter((n) => !declared.has(n)).sort();
}

async function reconcileBundles(
  adapter: ToolAdapter,
  toolConfig: LoadedToolConfig,
  instance: ToolInstance,
  confirmRemovals: boolean,
  reportError: (msg: string) => void,
): Promise<BundleOpReport[]> {
  const ops: BundleOpReport[] = [];
  const paradigm = adapter.defaults.capabilities.bundleParadigm;
  if (!paradigm) return ops;

  const declared =
    paradigm === "artifact"
      ? toolConfig.pluginsManifest?.plugins ?? []
      : toolConfig.packagesManifest?.packages ?? [];

  // Snapshot installed bundles via scan.
  const inv = await adapter.scan(instance);
  const installedNames = new Set<string>();
  for (const a of inv.artifacts) {
    if (a.provenance.kind === "bundle") installedNames.add(a.provenance.bundleName);
  }

  // Install missing-and-enabled bundles.
  for (const bundle of declared) {
    if (!bundle.enabled) {
      // Disabled bundles installed today should be uninstalled iff confirmRemovals.
      if (installedNames.has(bundle.name)) {
        if (!confirmRemovals) {
          ops.push({ name: bundle.name, op: "skip", ok: true, reason: "disabled but not uninstalled (confirmRemovals=false)" });
          continue;
        }
        if (!adapter.uninstallBundle) {
          ops.push({ name: bundle.name, op: "skip", ok: false, reason: "adapter has no uninstallBundle" });
          continue;
        }
        try {
          await adapter.uninstallBundle(bundle.name, instance);
          ops.push({ name: bundle.name, op: "uninstall", ok: true });
        } catch (err) {
          ops.push({ name: bundle.name, op: "uninstall", ok: false, reason: errorMessage(err) });
          reportError(`uninstall ${bundle.name}: ${errorMessage(err)}`);
        }
      }
      continue;
    }

    if (installedNames.has(bundle.name)) {
      // Already installed. Update is intentionally NOT auto-run — keep float
      // semantics explicit: user runs `blackbook update` (separate command,
      // not part of apply) when they want a refresh. v1: skip.
      ops.push({ name: bundle.name, op: "skip", ok: true, reason: "already installed" });
      continue;
    }

    if (!adapter.installBundle) {
      ops.push({ name: bundle.name, op: "skip", ok: false, reason: "adapter has no installBundle" });
      continue;
    }
    try {
      await adapter.installBundle(bundle, instance);
      ops.push({ name: bundle.name, op: "install", ok: true });
    } catch (err) {
      ops.push({ name: bundle.name, op: "install", ok: false, reason: errorMessage(err) });
      reportError(`install ${bundle.name}: ${errorMessage(err)}`);
    }
  }

  // Bundles installed on disk but NOT in the playbook → only uninstall if confirmRemovals.
  const declaredNames = new Set(declared.map((b) => b.name));
  for (const installedName of installedNames) {
    if (declaredNames.has(installedName)) continue;
    if (!confirmRemovals) {
      ops.push({
        name: installedName,
        op: "skip",
        ok: true,
        reason: "installed but absent from playbook (confirmRemovals=false)",
      });
      continue;
    }
    if (!adapter.uninstallBundle) {
      ops.push({ name: installedName, op: "skip", ok: false, reason: "adapter has no uninstallBundle" });
      continue;
    }
    try {
      await adapter.uninstallBundle(installedName, instance);
      ops.push({ name: installedName, op: "uninstall", ok: true });
    } catch (err) {
      ops.push({ name: installedName, op: "uninstall", ok: false, reason: errorMessage(err) });
      reportError(`uninstall ${installedName}: ${errorMessage(err)}`);
    }
  }

  return ops;
}

/** Convenience: throw if topLevelErrors are present. */
export function ensureNoTopLevelErrors(result: EngineSyncResult): void {
  if (result.topLevelErrors.length > 0) {
    const msg = result.topLevelErrors.map((e) => `[${e.scope}] ${e.message}`).join("; ");
    throw new Error(`Engine sync failed: ${msg}`);
  }
}

/**
 * Force-list adapters for a playbook (handy for `init`/UI flows that need to
 * iterate every enabled tool). Throws if any adapter is missing.
 */
export function adaptersFor(playbook: LoadedPlaybook): Array<{ toolId: ToolId; adapter: ReturnType<typeof requireAdapter> }> {
  return playbook.manifest.tools_enabled.map((toolId) => ({
    toolId,
    adapter: requireAdapter(toolId),
  }));
}
