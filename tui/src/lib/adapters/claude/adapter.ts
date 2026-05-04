/**
 * Claude adapter — primary entry point.
 *
 * Implements ToolAdapter for Claude Code.
 * Highlights:
 *   - Artifact-bundle paradigm (Claude plugins via marketplace)
 *   - Native MCP via .mcp.json
 *   - AGENTS.md + CLAUDE.md (legacy alias)
 *   - Plugin registry at <config_dir>/plugins/installed_plugins.json
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
import { buildCommonSpineDiff, appendConfigFileOps } from "../diff-builder.js";
import { addAgentsMdVariants, scanCommonSpine } from "../scanner.js";
import type { EmitResult, ToolAdapter } from "../types.js";
import { buildClaudeOwnership } from "./bundle-ownership.js";
import {
  installClaudeBundle,
  updateClaudeBundle,
  uninstallClaudeBundle,
} from "./bundle-ops.js";
import { CLAUDE_AGENTS_MD_VARIANTS, CLAUDE_DEFAULTS } from "./defaults.js";
import { detectClaude } from "./detect.js";
import { emitClaudeMcp } from "./mcp.js";

export const claudeAdapter: ToolAdapter = {
  defaults: CLAUDE_DEFAULTS,

  async detect() {
    return detectClaude();
  },

  async scan(instance: ToolInstance): Promise<Inventory> {
    const configDir = resolveConfigDir(instance);
    const ownership = buildClaudeOwnership(configDir);
    const inv = scanCommonSpine(instance, CLAUDE_DEFAULTS, ownership);
    addAgentsMdVariants(inv, ownership, CLAUDE_AGENTS_MD_VARIANTS);
    return inv;
  },

  async preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff> {
    const toolConfig = playbook.tools.claude;
    if (!toolConfig) throw new Error("preview: claude tool not enabled in playbook");
    const inventory = await claudeAdapter.scan(instance);
    const args = {
      playbook,
      toolConfig,
      instance,
      defaults: CLAUDE_DEFAULTS,
      inventory,
      toolRootPath: playbook.tools.claude?.rootPath,
    };
    return appendConfigFileOps(await buildCommonSpineDiff(args), args);
  },

  async apply(diff: Diff, _instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult> {
    return applyCommonSpine(diff, opts);
  },

  async pull(instance: ToolInstance, _opts: PullOpts): Promise<PlaybookFragment> {
    const inventory = await claudeAdapter.scan(instance);
    return buildClaudeFragment(inventory);
  },

  async emitMcp(servers: McpServer[], instance: ToolInstance): Promise<EmitResult> {
    return emitClaudeMcp(servers, instance);
  },

  async installBundle(ref: BundleEntry, instance: ToolInstance): Promise<void> {
    return installClaudeBundle(ref, instance);
  },
  async updateBundle(name: string, instance: ToolInstance): Promise<void> {
    return updateClaudeBundle(name, instance);
  },
  async uninstallBundle(name: string, instance: ToolInstance): Promise<void> {
    return uninstallClaudeBundle(name, instance);
  },
};

function buildClaudeFragment(inventory: Inventory): PlaybookFragment {
  const standalone = inventory.artifacts.filter((a) => a.provenance.kind === "standalone");
  const unclassified = inventory.artifacts.filter((a) => a.provenance.kind === "unknown");
  const bundleNames = new Set<string>();
  for (const a of inventory.artifacts) {
    if (a.provenance.kind === "bundle") bundleNames.add(a.provenance.bundleName);
  }
  const bundles: BundleEntry[] = Array.from(bundleNames).map((name) => ({
    name,
    // Provenance alone doesn't tell us the upstream marketplace; pull leaves
    // this as a local-path placeholder. User edits before commit.
    source: { type: "local", path: `tools/claude/plugins/${name}` },
    enabled: true,
    disabled_components: { skills: [], commands: [], agents: [] },
  }));
  return {
    toolId: "claude",
    instanceId: inventory.instanceId,
    standaloneArtifacts: standalone,
    bundles,
    unclassified,
    configFiles: [],
  };
}
