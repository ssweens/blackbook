/**
 * ToolAdapter: one implementation per tool family for the plugin lifecycle.
 *
 * Before this abstraction, install/uninstall/update/status/list/enable/disable
 * each contained a repeated `if (isClaude) … else if (isPi) … else if (isCodex)
 * … else …` chain. Changing one tool's behavior meant editing ~7 functions. Now
 * each tool family owns its behavior in a single adapter, and the functions in
 * install.ts / plugin-status.ts dispatch through `getAdapterForTool(toolId)`.
 *
 * The interface deliberately exposes BOTH a "plugin lifecycle" surface
 * (install/uninstall/update) and a "component file-copy" surface
 * (installComponents/removeComponents). They are identical for every tool
 * EXCEPT Claude, which installs the whole plugin through its native CLI in the
 * lifecycle methods but materializes individual skill/command/agent files in the
 * component methods (the behavior enablePlugin/disablePlugin/syncPluginInstances
 * have always relied on). Modeling both is what lets those call sites drop their
 * inline tool conditionals without changing behavior.
 */

import type { Plugin, ToolInstance } from "../types.js";
import type { Manifest } from "../manifest.js";

/** Per-instance result of an install/uninstall/update/component operation. */
export interface PerInstanceResult {
  /** Number of items/plugins affected (1 for native CLI/bridge, N for file-copy). */
  count: number;
  /** Human-readable, already-formatted error messages (empty on success). */
  errors: string[];
}

/** Inputs the status check derives once per instance and hands to `supports`. */
export interface SupportInput {
  plugin: Plugin;
  instance: ToolInstance;
  canInstallSkills: boolean;
  canInstallCommands: boolean;
  canInstallAgents: boolean;
  hasHooks: boolean;
}

/**
 * Lazily-resolved, cache-generation-scoped state the status check shares across
 * every plugin in a render pass. Adapters read only what they need.
 */
export interface InstalledContext {
  getManifest(): Manifest;
}

export interface ToolAdapter {
  readonly toolId: string;
  /**
   * Whether install/update need a downloaded plugin source. False for native
   * tools (Claude CLI, Pi bridge); true for file-copy tools (Codex, managed).
   * Orchestrators use this to decide whether to run downloadPlugin().
   */
  readonly usesSource: boolean;

  /** Mirrors the per-tool `supported`/`supportReason` logic in the status check. */
  supports(input: SupportInput): { supported: boolean; reason?: string };
  /** Mirrors each tool's installed-check branch in the status check. */
  isInstalled(plugin: Plugin, instance: ToolInstance, ctx: InstalledContext): boolean;
  /** The installed plugins this instance reports (native scan or manifest scan). */
  listInstalled(instance: ToolInstance): Plugin[];

  // ── Plugin lifecycle (native CLI / bridge / file-copy) ──────────────────────
  // These internalize their own error handling and never throw; failures are
  // returned as pre-formatted messages in `errors`.
  install(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
    marketplaceUrl: string,
  ): Promise<PerInstanceResult>;
  uninstall(plugin: Plugin, instance: ToolInstance): Promise<PerInstanceResult>;
  update(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
    marketplaceUrl: string,
  ): Promise<PerInstanceResult>;

  // ── Component file-copy surface (enable / disable / sync) ────────────────────
  // Unlike the lifecycle methods, these MAY throw; their call sites wrap them in
  // try/catch to produce context-specific ("Enable failed" / "Sync failed")
  // messages, preserving the original behavior exactly.
  installComponents(
    plugin: Plugin,
    instance: ToolInstance,
    sourcePath: string | null,
    marketplaceUrl?: string,
  ): Promise<PerInstanceResult>;
  removeComponents(plugin: Plugin, instance: ToolInstance): Promise<number>;
}

import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { managedAdapter } from "./managed.js";
import { piAdapter } from "./pi.js";

const ADAPTERS: Record<string, ToolAdapter> = {
  "claude-code": claudeAdapter,
  "openai-codex": codexAdapter,
  opencode: managedAdapter,
  "amp-code": managedAdapter,
  pi: piAdapter,
};

/**
 * Resolve the adapter for a tool id. Unknown/other file-copy tools fall back to
 * the generic managed adapter, matching the pre-refactor `else` branch.
 */
export function getAdapterForTool(toolId: string): ToolAdapter {
  return ADAPTERS[toolId] ?? managedAdapter;
}
