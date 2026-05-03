/**
 * Pi adapter — primary entry point.
 *
 * Implements ToolAdapter for Pi (pi-coding-agent).
 * Highlights:
 *   - Code-package paradigm (npm/git pi-packages, no marketplace)
 *   - MCP only via the pi-mcp-adapter package
 *   - Commands live under prompts/ on disk
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
import { buildPiOwnership } from "./bundle-ownership.js";
import { PI_DEFAULTS } from "./defaults.js";
import { detectPi } from "./detect.js";
import { emitPiMcp, piMcpEnabled } from "./mcp.js";

export const piAdapter: ToolAdapter = {
  defaults: PI_DEFAULTS,

  async detect() {
    return detectPi();
  },

  async scan(instance: ToolInstance): Promise<Inventory> {
    const configDir = resolveConfigDir(instance);
    const ownership = buildPiOwnership(configDir);
    return scanCommonSpine(instance, PI_DEFAULTS, ownership);
  },

  async preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff> {
    const toolConfig = playbook.tools.pi;
    if (!toolConfig) {
      throw new Error("preview: pi tool not enabled in playbook");
    }
    const inventory = await piAdapter.scan(instance);
    return buildCommonSpineDiff({
      playbook,
      toolConfig,
      instance,
      defaults: PI_DEFAULTS,
      inventory,
    });
  },

  async apply(diff: Diff, _instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult> {
    return applyCommonSpine(diff, opts);
  },

  async pull(instance: ToolInstance, _opts: PullOpts): Promise<PlaybookFragment> {
    const inventory = await piAdapter.scan(instance);
    return buildFragment(inventory);
  },

  async emitMcp(servers: McpServer[], instance: ToolInstance): Promise<EmitResult> {
    return emitPiMcp(servers, instance);
  },

  async installBundle(_ref: BundleEntry, _instance: ToolInstance): Promise<void> {
    // Pi packages are installed via the `pi install` CLI; the engine drives
    // this via the pi binary. Bundle install logic for Pi lives in the
    // sync engine, not the adapter, because it shells out to the user's pi.
    // Placeholder for now; engine will route here.
    throw new Error("piAdapter.installBundle: not yet wired (engine TODO)");
  },
  async updateBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("piAdapter.updateBundle: not yet wired (engine TODO)");
  },
  async uninstallBundle(_name: string, _instance: ToolInstance): Promise<void> {
    throw new Error("piAdapter.uninstallBundle: not yet wired (engine TODO)");
  },
};

/** Re-exported helper for testing / external callers. */
export { piMcpEnabled };

// ─────────────────────────────────────────────────────────────────────────────
// pull → playbook fragment
// ─────────────────────────────────────────────────────────────────────────────

function buildFragment(inventory: Inventory): PlaybookFragment {
  const standalone = inventory.artifacts.filter((a) => a.provenance.kind === "standalone");
  const unclassified = inventory.artifacts.filter((a) => a.provenance.kind === "unknown");
  // Bundle list reconstructed from ownership: every distinct bundleName found.
  const bundleNames = new Set<string>();
  for (const a of inventory.artifacts) {
    if (a.provenance.kind === "bundle") bundleNames.add(a.provenance.bundleName);
  }
  const bundles: BundleEntry[] = Array.from(bundleNames).map((name) => ({
    name,
    source: { type: "npm", package: name },
    enabled: true,
    disabled_components: { skills: [], commands: [], agents: [] },
  }));
  return {
    toolId: "pi",
    instanceId: inventory.instanceId,
    standaloneArtifacts: standalone,
    bundles,
    unclassified,
    configFiles: [],
  };
}
