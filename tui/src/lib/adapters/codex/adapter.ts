/**
 * Codex adapter — primary entry point.
 *
 * Implements ToolAdapter for OpenAI Codex CLI.
 * Highlights:
 *   - Artifact-bundle paradigm (.codex-plugin/plugin.json + marketplace)
 *   - MCP via TOML merged into config.toml
 *   - System skills under skills/.system/ excluded from scan (dot-prefix skip)
 */

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
import { buildCodexOwnership } from "./bundle-ownership.js";
import { CODEX_DEFAULTS } from "./defaults.js";
import { detectCodex } from "./detect.js";
import { emitCodexMcp } from "./mcp.js";

export const codexAdapter: ToolAdapter = {
  defaults: CODEX_DEFAULTS,

  async detect() {
    return detectCodex();
  },

  async scan(instance: ToolInstance): Promise<Inventory> {
    const configDir = resolveConfigDir(instance);
    const ownership = buildCodexOwnership(configDir);
    return scanCommonSpine(instance, CODEX_DEFAULTS, ownership);
  },

  async preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff> {
    const toolConfig = playbook.tools.codex;
    if (!toolConfig) throw new Error("preview: codex tool not enabled in playbook");
    const inventory = await codexAdapter.scan(instance);
    return buildCommonSpineDiff({
      playbook,
      toolConfig,
      instance,
      defaults: CODEX_DEFAULTS,
      inventory,
    });
  },

  async apply(diff: Diff, _instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult> {
    return applyCommonSpine(diff, opts);
  },

  async pull(instance: ToolInstance, _opts: PullOpts): Promise<PlaybookFragment> {
    const inventory = await codexAdapter.scan(instance);
    const standalone = inventory.artifacts.filter((a) => a.provenance.kind === "standalone");
    const unclassified = inventory.artifacts.filter((a) => a.provenance.kind === "unknown");
    const bundleNames = new Set<string>();
    for (const a of inventory.artifacts) {
      if (a.provenance.kind === "bundle") bundleNames.add(a.provenance.bundleName);
    }
    const bundles: BundleEntry[] = Array.from(bundleNames).map((name) => ({
      name,
      source: { type: "local", path: `tools/codex/plugins/${name}` },
      enabled: true,
      disabled_components: { skills: [], commands: [], agents: [] },
    }));
    return {
      toolId: "codex",
      instanceId: inventory.instanceId,
      standaloneArtifacts: standalone,
      bundles,
      unclassified,
      configFiles: [],
    };
  },

  async emitMcp(servers: McpServer[], instance: ToolInstance): Promise<EmitResult> {
    return emitCodexMcp(servers, instance);
  },

  async installBundle(_ref: BundleEntry, _instance: ToolInstance): Promise<void> {
    throw new Error("codexAdapter.installBundle: not yet wired (engine TODO)");
  },
  async updateBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("codexAdapter.updateBundle: not yet wired (engine TODO)");
  },
  async uninstallBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("codexAdapter.uninstallBundle: not yet wired (engine TODO)");
  },
};
