/**
 * Amp adapter — conservative common-spine-only.
 *
 * Amp's plugin/extension model and MCP support need external verification
 * before we wire them in. Until then this adapter handles skills/commands/
 * agents/AGENTS.md only. Everything on disk is `standalone`.
 */

import type {
  ApplyOpts,
  ApplyResult,
  Diff,
  Inventory,
  LoadedPlaybook,
  PlaybookFragment,
  PullOpts,
  ToolInstance,
} from "../../playbook/index.js";
import { applyCommonSpine } from "../applier.js";
import { findBinary, getVersion } from "../base.js";
import { buildCommonSpineDiff, appendConfigFileOps } from "../diff-builder.js";
import { scanCommonSpine } from "../scanner.js";
import type { ToolAdapter } from "../types.js";
import { AMP_DEFAULTS } from "./defaults.js";

export const ampAdapter: ToolAdapter = {
  defaults: AMP_DEFAULTS,

  async detect() {
    const binary = await findBinary(AMP_DEFAULTS.binary);
    return {
      toolId: AMP_DEFAULTS.toolId,
      installed: !!binary,
      version: binary ? await getVersion(binary) : undefined,
      binaryPath: binary,
      configDir: AMP_DEFAULTS.defaultConfigDir,
    };
  },

  async scan(instance: ToolInstance): Promise<Inventory> {
    return scanCommonSpine(instance, AMP_DEFAULTS, new Map());
  },

  async preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff> {
    const toolConfig = playbook.tools.amp;
    if (!toolConfig) throw new Error("preview: amp tool not enabled in playbook");
    const inventory = await ampAdapter.scan(instance);
    const args = {
      playbook,
      toolConfig,
      instance,
      defaults: AMP_DEFAULTS,
      inventory,
      toolRootPath: playbook.tools.amp?.rootPath,
    };
    return appendConfigFileOps(buildCommonSpineDiff(args), args);
  },

  async apply(diff: Diff, _instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult> {
    return applyCommonSpine(diff, opts);
  },

  async pull(instance: ToolInstance, _opts: PullOpts): Promise<PlaybookFragment> {
    const inventory = await ampAdapter.scan(instance);
    return {
      toolId: "amp",
      instanceId: inventory.instanceId,
      standaloneArtifacts: inventory.artifacts.filter((a) => a.provenance.kind === "standalone"),
      bundles: [],
      unclassified: inventory.artifacts.filter((a) => a.provenance.kind === "unknown"),
      configFiles: [],
    };
  },
};
