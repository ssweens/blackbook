import type {
  ApplyOpts,
  ApplyResult,
  BundleEntry,
  Diff,
  Inventory,
  LoadedPlaybook,
  McpServer,
  PlaybookFragment,
  PullOpts,
  ToolInstance,
} from "../../playbook/index.js";
import { applyCommonSpine } from "../applier.js";
import { resolveConfigDir } from "../base.js";
import { buildCommonSpineDiff } from "../diff-builder.js";
import { scanCommonSpine } from "../scanner.js";
import type { EmitResult, ToolAdapter } from "../types.js";
import { buildOpenCodeOwnership } from "./bundle-ownership.js";
import { OPENCODE_DEFAULTS } from "./defaults.js";
import { detectOpenCode } from "./detect.js";
import { emitOpenCodeMcp } from "./mcp.js";

export const opencodeAdapter: ToolAdapter = {
  defaults: OPENCODE_DEFAULTS,

  async detect() {
    return detectOpenCode();
  },

  async scan(instance: ToolInstance): Promise<Inventory> {
    const configDir = resolveConfigDir(instance);
    const ownership = buildOpenCodeOwnership(configDir);
    return scanCommonSpine(instance, OPENCODE_DEFAULTS, ownership);
  },

  async preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff> {
    const toolConfig = playbook.tools.opencode;
    if (!toolConfig) throw new Error("preview: opencode tool not enabled in playbook");
    const inventory = await opencodeAdapter.scan(instance);
    return buildCommonSpineDiff({
      playbook,
      toolConfig,
      instance,
      defaults: OPENCODE_DEFAULTS,
      inventory,
    });
  },

  async apply(diff: Diff, _instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult> {
    return applyCommonSpine(diff, opts);
  },

  async pull(instance: ToolInstance, _opts: PullOpts): Promise<PlaybookFragment> {
    const inventory = await opencodeAdapter.scan(instance);
    return {
      toolId: "opencode",
      instanceId: inventory.instanceId,
      standaloneArtifacts: inventory.artifacts.filter((a) => a.provenance.kind === "standalone"),
      bundles: [], // no filesystem-owning bundles in v1
      unclassified: inventory.artifacts.filter((a) => a.provenance.kind === "unknown"),
      configFiles: [],
    };
  },

  async emitMcp(servers: McpServer[], instance: ToolInstance): Promise<EmitResult> {
    return emitOpenCodeMcp(servers, instance);
  },

  async installBundle(_ref: BundleEntry, _instance: ToolInstance): Promise<void> {
    throw new Error("opencodeAdapter.installBundle: not yet wired (engine TODO)");
  },
  async updateBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("opencodeAdapter.updateBundle: not yet wired (engine TODO)");
  },
  async uninstallBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("opencodeAdapter.uninstallBundle: not yet wired (engine TODO)");
  },
};
