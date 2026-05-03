/**
 * Playbook schema (v1) — Zod definitions for every file the playbook stores.
 *
 * Hierarchy:
 *   playbook.yaml                         → PlaybookSchema (root)
 *   tools/<tool>/tool.yaml                → ToolConfigSchema
 *   tools/<tool>/plugins.yaml             → PluginsManifestSchema (artifact bundles)
 *   tools/<tool>/packages.yaml            → PackagesManifestSchema (code packages)
 *   shared/mcp/<server>.yaml              → McpServerSchema
 *
 * Source of truth: docs/architecture/playbook-schema.md
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Schema version
// ─────────────────────────────────────────────────────────────────────────────

export const PLAYBOOK_SCHEMA_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool ids (aligned with adapter directory names)
// ─────────────────────────────────────────────────────────────────────────────

export const ToolIdSchema = z.enum(["claude", "codex", "opencode", "amp", "pi"]);
export type ToolId = z.infer<typeof ToolIdSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Provenance — every artifact discovered or stored has one of these
// ─────────────────────────────────────────────────────────────────────────────

export const ProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("standalone") }),
  z.object({ kind: z.literal("bundle"), bundleName: z.string().min(1) }),
  z.object({ kind: z.literal("unknown") }),
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Required env vars (declared in playbook.yaml; checked before apply)
// ─────────────────────────────────────────────────────────────────────────────

export const RequiredEnvSchema = z.object({
  name: z.string().min(1),
  used_by: z.array(z.string().min(1)).default([]),
  docs: z.string().optional(),
  optional: z.boolean().default(false),
});
export type RequiredEnv = z.infer<typeof RequiredEnvSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace references (per-tool grouping in playbook.yaml)
// ─────────────────────────────────────────────────────────────────────────────

export const MarketplaceRefSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),       // for marketplace-json based tools
  publishers: z.array(z.string().min(1)).optional(), // for npm-based tools (Pi, OpenCode)
});
export type MarketplaceRef = z.infer<typeof MarketplaceRefSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Playbook-level defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DefaultsSchema = z.object({
  /** Hard-locked at runtime: engine ignores attempts to set this false. Schema allows the field for forward-compat. */
  confirm_removals: z.boolean().default(true),
  default_strategy: z.enum(["copy", "symlink"]).default("copy"),
  drift_action: z.enum(["warn", "fail", "auto-resolve"]).default("warn"),
});
export type Defaults = z.infer<typeof DefaultsSchema>;
const DEFAULTS_DEFAULT = DefaultsSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// Playbook-level settings
// ─────────────────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  package_manager: z.enum(["npm", "pnpm", "bun"]).default("pnpm"),
  backup_retention: z.number().int().min(1).max(100).default(3),
});
export type Settings = z.infer<typeof SettingsSchema>;
const SETTINGS_DEFAULT = SettingsSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// Top-level playbook.yaml
// ─────────────────────────────────────────────────────────────────────────────

export const PlaybookSchema = z.object({
  playbook_schema_version: z.literal(1),

  name: z.string().min(1),
  description: z.string().optional(),

  tools_enabled: z.array(ToolIdSchema).default([]),

  // Keyed by ToolId; permissive string-key for default ergonomics, validated at use time.
  marketplaces: z.record(z.string(), z.array(MarketplaceRefSchema)).default({}),

  required_env: z.array(RequiredEnvSchema).default([]),

  defaults: DefaultsSchema.default(DEFAULTS_DEFAULT),
  settings: SettingsSchema.default(SETTINGS_DEFAULT),
});
export type PlaybookManifest = z.infer<typeof PlaybookSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tool instance (per-tool tool.yaml)
// ─────────────────────────────────────────────────────────────────────────────

export const ToolInstanceSchema = z.object({
  id: z.string().min(1).default("default"),
  name: z.string().min(1),
  config_dir: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type ToolInstance = z.infer<typeof ToolInstanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool include_shared (opt-in lists per artifact type)
// ─────────────────────────────────────────────────────────────────────────────

export const IncludeSharedSchema = z.object({
  agents_md: z.boolean().default(false),
  skills: z.array(z.string().min(1)).default([]),
  commands: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
  mcp: z.array(z.string().min(1)).default([]),
});
export type IncludeShared = z.infer<typeof IncludeSharedSchema>;
const INCLUDE_SHARED_DEFAULT = IncludeSharedSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool overrides (target-path renames; AGENTS.md → CLAUDE.md being the main case)
// ─────────────────────────────────────────────────────────────────────────────

export const OverridesSchema = z.object({
  /** Per-instance target filename for AGENTS.md (e.g., {default: "CLAUDE.md"}). */
  agents_md: z.record(z.string().min(1), z.string().min(1)).default({}),
});
export type Overrides = z.infer<typeof OverridesSchema>;
const OVERRIDES_DEFAULT = OverridesSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool config files (settings.json, opencode.json, config.toml, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export const ConfigFileSchema = z.object({
  source: z.string().min(1),                  // path under tools/<tool>/
  target: z.string().min(1),                  // path under config_dir
  strategy: z.enum(["copy", "symlink"]).default("copy"),
  /** False (default) = read-only reference; never written to disk by apply. True = synced. */
  syncable: z.boolean().default(false),
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool lifecycle overrides
// ─────────────────────────────────────────────────────────────────────────────

export const ToolLifecycleSchema = z.object({
  install_strategy: z.enum(["native", "manual"]).default("native"),
  uninstall_strategy: z.enum(["native", "manual"]).default("native"),
  drift_action: z.enum(["warn", "fail", "auto-resolve"]).optional(),
});
export type ToolLifecycle = z.infer<typeof ToolLifecycleSchema>;
const TOOL_LIFECYCLE_DEFAULT = ToolLifecycleSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// tools/<tool>/tool.yaml
// ─────────────────────────────────────────────────────────────────────────────

export const ToolConfigSchema = z.object({
  tool: ToolIdSchema,
  config_dir: z.string().optional(),       // override default; otherwise adapter default

  instances: z.array(ToolInstanceSchema).default([]),

  include_shared: IncludeSharedSchema.default(INCLUDE_SHARED_DEFAULT),
  overrides: OverridesSchema.default(OVERRIDES_DEFAULT),

  config_files: z.array(ConfigFileSchema).default([]),

  /** File pointer; defaults are paradigm-specific. Engine resolves. */
  plugins_manifest: z.string().optional(),   // tools/<tool>/plugins.yaml (artifact paradigm)
  packages_manifest: z.string().optional(),  // tools/<tool>/packages.yaml (code paradigm)

  lifecycle: ToolLifecycleSchema.default(TOOL_LIFECYCLE_DEFAULT),
});
export type ToolConfig = z.infer<typeof ToolConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Bundle source — discriminated union for marketplace / npm / git / local
// ─────────────────────────────────────────────────────────────────────────────

export const BundleSourceSchema = z.discriminatedUnion("type", [
  /** Reference to a marketplace declared in playbook.yaml */
  z.object({
    type: z.literal("marketplace"),
    marketplace: z.string().min(1),
    plugin: z.string().min(1),
  }),
  /** npm package */
  z.object({
    type: z.literal("npm"),
    package: z.string().min(1),
  }),
  /** git repo */
  z.object({
    type: z.literal("git"),
    url: z.string().min(1),
    ref: z.string().optional(),    // branch / tag / sha
  }),
  /** local path (relative to playbook root) */
  z.object({
    type: z.literal("local"),
    path: z.string().min(1),
  }),
]);
export type BundleSource = z.infer<typeof BundleSourceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Per-bundle component disable lists (preserves selective-disable from old config)
// ─────────────────────────────────────────────────────────────────────────────

export const DisabledComponentsSchema = z.object({
  skills: z.array(z.string().min(1)).default([]),
  commands: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
});
export type DisabledComponents = z.infer<typeof DisabledComponentsSchema>;
const DISABLED_COMPONENTS_DEFAULT = DisabledComponentsSchema.parse({});

// ─────────────────────────────────────────────────────────────────────────────
// A single bundle entry (used in both plugins.yaml and packages.yaml)
// ─────────────────────────────────────────────────────────────────────────────

export const BundleEntrySchema = z.object({
  name: z.string().min(1),
  source: BundleSourceSchema,
  enabled: z.boolean().default(true),
  /** Floating by default; set to pin. */
  version: z.string().optional(),
  disabled_components: DisabledComponentsSchema.default(DISABLED_COMPONENTS_DEFAULT),
});
export type BundleEntry = z.infer<typeof BundleEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// tools/<tool>/plugins.yaml (artifact bundles — Claude, Codex)
// ─────────────────────────────────────────────────────────────────────────────

export const PluginsManifestSchema = z.object({
  schema: z.literal(1),
  plugins: z.array(BundleEntrySchema).default([]),
});
export type PluginsManifest = z.infer<typeof PluginsManifestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// tools/<tool>/packages.yaml (code packages — Pi, OpenCode)
// ─────────────────────────────────────────────────────────────────────────────

export const PackagesManifestSchema = z.object({
  schema: z.literal(1),
  packages: z.array(BundleEntrySchema).default([]),
});
export type PackagesManifest = z.infer<typeof PackagesManifestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// MCP server definition (shared/mcp/<server>.yaml)
// ─────────────────────────────────────────────────────────────────────────────

const McpEnvValueSchema = z.union([
  z.string(),  // literal value (shouldn't be a secret) or shell-style $env:NAME placeholder
  z.object({
    from_env: z.string().min(1),
    required: z.boolean().default(true),
  }),
]);

const McpCompatSchema = z.object({
  bearer_token_env_supported: z.boolean().optional(),
});
const MCP_COMPAT_DEFAULT = McpCompatSchema.parse({});

const McpLocalSchema = z.object({
  name: z.string().min(1),
  type: z.literal("local"),
  description: z.string().optional(),
  command: z.array(z.string().min(1)).min(1),
  env: z.record(z.string().min(1), McpEnvValueSchema).default({}),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().optional(),
  compat: McpCompatSchema.default(MCP_COMPAT_DEFAULT),
});

const McpRemoteSchema = z.object({
  name: z.string().min(1),
  type: z.literal("remote"),
  description: z.string().optional(),
  url: z.string().url(),
  /** Name of env var holding the bearer token. NEVER the token itself. */
  bearerTokenEnv: z.string().min(1).optional(),
  headers: z.record(z.string().min(1), z.string()).default({}),
  enabled: z.boolean().default(true),
  timeout_ms: z.number().int().positive().optional(),
  compat: McpCompatSchema.default(MCP_COMPAT_DEFAULT),
});

export const McpServerSchema = z.discriminatedUnion("type", [McpLocalSchema, McpRemoteSchema]);
export type McpServer = z.infer<typeof McpServerSchema>;
export type McpEnvValue = z.infer<typeof McpEnvValueSchema>;
