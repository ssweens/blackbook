/**
 * Adapter contract — every per-tool adapter implements this shape.
 *
 * The engine treats adapters as opaque; only this contract matters.
 * Source of truth: docs/architecture/playbook-schema.md (Adapter contract section)
 */

import type {
  ApplyOpts,
  ApplyResult,
  DetectionResult,
  Diff,
  Inventory,
  LoadedPlaybook,
  PlaybookFragment,
  PullOpts,
  ToolId,
  ToolInstance,
  ValidationReport,
  McpServer,
  BundleEntry,
} from "../playbook/index.js";

export type BundleParadigm = "artifact" | "code-package" | null;

/**
 * Capabilities a tool advertises. Used by the engine to decide what work to
 * skip and to surface the right UI affordances.
 */
export interface ToolCapabilities {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  agentsMd: boolean;
  /** Native MCP support (excluding adapter-package mediated). */
  mcp: boolean;
  /** Pi-style: MCP available only via an installed extension (e.g. pi-mcp-adapter). */
  mcpViaPackage?: { packageName: string };
  hooks: boolean;
  bundleParadigm: BundleParadigm;
}

/**
 * Default tool layout knowledge — what the adapter knows about how the tool
 * lives on disk, regardless of any specific playbook.
 */
export interface AdapterDefaults {
  toolId: ToolId;
  displayName: string;
  /** Default config dir if user didn't override (e.g., "~/.claude"). */
  defaultConfigDir: string;
  /** Subdirectory names inside config_dir for each artifact type. */
  paths: {
    skills: string;        // e.g. "skills"
    commands: string;      // e.g. "commands" — Pi uses "prompts"
    agents: string;        // e.g. "agents"
    agentsMd: string;      // default filename, e.g. "AGENTS.md" — overrides may rename
    /** Path (relative to config_dir) where MCP servers are stored, or null if not native. */
    mcp: string | null;
    hooks: string | null;
  };
  /** Binary name for detection (e.g. "claude"). */
  binary: string;
  /** Capabilities matrix. */
  capabilities: ToolCapabilities;
}

/**
 * The adapter interface. Every method that touches the user's machine takes
 * the resolved {@link ToolInstance} (which carries config_dir).
 */
export interface ToolAdapter {
  /** Default knowledge that doesn't depend on a specific playbook. */
  readonly defaults: AdapterDefaults;

  /** Detect whether the tool is installed locally. */
  detect(): Promise<DetectionResult>;

  /**
   * Read the tool's disk state and tag every discovered artifact with provenance.
   *
   * Implementations should:
   * - Read the tool's bundle registry (installed_plugins.json, settings.json packages, etc.)
   * - For each on-disk artifact, decide: standalone | bundle:<name> | unknown
   * - Skip tool-managed paths (e.g. Codex's skills/.system/)
   */
  scan(instance: ToolInstance): Promise<Inventory>;

  /**
   * Compute the operations needed to bring `instance` into alignment with
   * `playbook`. Pure function — no side effects.
   */
  preview(playbook: LoadedPlaybook, instance: ToolInstance): Promise<Diff>;

  /** Execute a previously-computed Diff. Removals require {@link ApplyOpts.confirmRemovals}. */
  apply(diff: Diff, instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult>;

  /** Reverse-scaffolding for cold start / pull. */
  pull(instance: ToolInstance, opts: PullOpts): Promise<PlaybookFragment>;

  /** Tool-specific schema validation beyond the cross-file checks. Optional. */
  validate?(playbook: LoadedPlaybook): ValidationReport;

  /**
   * Emit MCP server config in the tool's native format. Optional.
   * Adapter is responsible for env-var indirection (no literal secrets).
   */
  emitMcp?(servers: McpServer[], instance: ToolInstance): Promise<EmitResult>;

  /**
   * Bundle operations. Optional — only adapters with non-null bundleParadigm
   * implement these. Engine routes bundle ops through these.
   */
  installBundle?(ref: BundleEntry, instance: ToolInstance): Promise<void>;
  updateBundle?(name: string, instance: ToolInstance): Promise<void>;
  uninstallBundle?(name: string, instance: ToolInstance): Promise<void>;
}

/**
 * Result of an MCP emission — typically writes to a config file or merges into one.
 */
export interface EmitResult {
  /** Files written or modified. */
  written: string[];
  /** Files skipped because the destination already had identical content. */
  unchanged: string[];
}
