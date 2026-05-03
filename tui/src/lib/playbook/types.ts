/**
 * Playbook domain types — higher-level structures composed from schema-validated parts.
 *
 * The Zod schemas in `./schema.ts` describe what's on disk.
 * The types here describe in-memory structures the engine and adapters work with.
 */

import type {
  BundleEntry,
  McpServer,
  PackagesManifest,
  PlaybookManifest,
  PluginsManifest,
  Provenance,
  ToolConfig,
  ToolId,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Loaded playbook — full in-memory representation
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadedPlaybook {
  /** Absolute path to the playbook root directory */
  rootPath: string;

  /** Parsed playbook.yaml */
  manifest: PlaybookManifest;

  /** Per-tool tool.yaml, keyed by tool id */
  tools: Partial<Record<ToolId, LoadedToolConfig>>;

  /** Shared artifacts discovered under shared/ */
  shared: SharedArtifacts;
}

export interface LoadedToolConfig {
  /** Absolute path to tools/<tool>/ */
  rootPath: string;

  /** Parsed tool.yaml */
  config: ToolConfig;

  /** Parsed plugins.yaml (if present) */
  pluginsManifest?: PluginsManifest;

  /** Parsed packages.yaml (if present) */
  packagesManifest?: PackagesManifest;

  /** Tool-specific standalone artifacts under tools/<tool>/<type>/ */
  standalone: SharedArtifacts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts (skills, commands, agents) discovered in the playbook
// ─────────────────────────────────────────────────────────────────────────────

export interface ArtifactRef {
  /** Artifact name (matches directory or file basename without extension) */
  name: string;
  /** Absolute path to the artifact source on disk in the playbook */
  sourcePath: string;
}

export interface SharedArtifacts {
  /** Whether shared/AGENTS.md exists; absolute path if so */
  agentsMdPath?: string;

  skills: ArtifactRef[];
  commands: ArtifactRef[];
  agents: ArtifactRef[];

  /** Parsed MCP server definitions, keyed by name */
  mcp: Record<string, McpServer>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory — what's currently on a tool's disk, classified by provenance
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredArtifact {
  /** Logical artifact name */
  name: string;
  /** Type of artifact */
  type: "skill" | "command" | "agent" | "agents_md" | "mcp" | "hook" | "config_file";
  /** Absolute path on the tool's disk */
  diskPath: string;
  /** Where it came from */
  provenance: Provenance;
  /** Sha256 of contents (for skills, this is sha of SKILL.md; for files, sha of file) */
  contentHash?: string;
}

export interface Inventory {
  toolId: ToolId;
  instanceId: string;
  configDir: string;
  artifacts: DiscoveredArtifact[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff — operations to perform during apply
// ─────────────────────────────────────────────────────────────────────────────

export type DiffOpKind = "add" | "update" | "remove" | "no-op";

export interface DiffOp {
  kind: DiffOpKind;
  artifactType: DiscoveredArtifact["type"] | "bundle";
  name: string;
  /** Source path in the playbook (where applicable) */
  sourcePath?: string;
  /** Target path on tool disk (where applicable) */
  targetPath?: string;
  /** Reason / context for this op (shown in UI) */
  reason: string;
}

export interface Diff {
  toolId: ToolId;
  instanceId: string;
  ops: DiffOp[];
}

export interface ApplyOpts {
  /** Without this, removals are skipped (and reported). Locked safety: never bypassable for removals. */
  confirmRemovals: boolean;
  /** Don't actually do anything; just report what would happen */
  dryRun: boolean;
}

export interface ApplyResult {
  toolId: ToolId;
  instanceId: string;
  performed: DiffOp[];
  skipped: DiffOp[];
  errors: ApplyError[];
}

export interface ApplyError {
  op: DiffOp;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull — reverse-scaffolding result (machine state → playbook fragment)
// ─────────────────────────────────────────────────────────────────────────────

export interface PullOpts {
  /** If true, classify unknown-provenance artifacts as standalone instead of leaving them unclassified */
  defaultUnknownToStandalone: boolean;
}

export interface PlaybookFragment {
  toolId: ToolId;
  instanceId: string;
  /** Tool-specific standalone artifacts found on disk */
  standaloneArtifacts: DiscoveredArtifact[];
  /** Bundles found via tool's registry */
  bundles: BundleEntry[];
  /** Artifacts whose provenance could not be determined */
  unclassified: DiscoveredArtifact[];
  /** Tool-specific config files on disk that should be referenced */
  configFiles: DiscoveredArtifact[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation reports
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Path within the playbook (e.g., "tools/claude/tool.yaml") */
  source: string;
  message: string;
  /** Optional pointer (e.g., field path or artifact name) */
  pointer?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  /** True iff no `error`-severity issues. */
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter detection result
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionResult {
  toolId: ToolId;
  installed: boolean;
  /** Tool version if installed and detectable */
  version?: string;
  /** Configured config dir; may differ from default */
  configDir?: string;
  /** Path to the tool binary if installed */
  binaryPath?: string;
}
