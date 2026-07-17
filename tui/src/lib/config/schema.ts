import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// File entry: general files (AGENTS.md, DEVELOPMENT.md, etc.)
// These are ALWAYS shown regardless of config_management setting.
// ─────────────────────────────────────────────────────────────────────────────

export const FileEntrySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  tools: z.array(z.string()).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Config entry: tool-specific config files (settings.json, opencode.json, etc.)
// These are only shown when config_management is enabled.
// ─────────────────────────────────────────────────────────────────────────────

export const ConfigEntrySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  tools: z.array(z.string()).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tool instance: per-tool configuration
// ─────────────────────────────────────────────────────────────────────────────

export const ToolInstanceSchema = z.object({
  id: z.string().default("default"),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  config_dir: z.string().min(1),
});

export type ToolInstanceConfig = z.infer<typeof ToolInstanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  source_repo: z.string().optional(),
  package_manager: z.enum(["npm", "pnpm", "bun"]).default("npm"),
  backup_retention: z.number().int().min(1).max(100).default(3),
  config_management: z.boolean().default(false),
  disabled_marketplaces: z.array(z.string()).default([]),
  disabled_pi_marketplaces: z.array(z.string()).default([]),
  // Opt-in: symlink skill/plugin-component dirs into a tool instead of copying
  // them. A symlinked install can't drift (the target IS the source), so it
  // needs no state tracking or resync — but only for skills/components, never
  // for config files (settings.json etc.), which tools rewrite in place; those
  // always stay copy + three-way state + pullback regardless of this setting.
  skill_sync_mode: z.enum(["copy", "symlink"]).default("copy"),
});

export type Settings = z.infer<typeof SettingsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin component config (per-component enable/disable)
// ─────────────────────────────────────────────────────────────────────────────

export const PluginComponentSchema = z.object({
  disabled_skills: z.array(z.string()).default([]),
  disabled_commands: z.array(z.string()).default([]),
  disabled_agents: z.array(z.string()).default([]),
});

export type PluginComponentConfig = z.infer<typeof PluginComponentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Desired Pi packages
// These are repo-prescribed package sources Blackbook should show even when not
// installed on the current machine.
// ─────────────────────────────────────────────────────────────────────────────

export const PiPackageEntrySchema = z.union([
  z.string().min(1).transform((source) => ({ source })),
  z.object({
    source: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    marketplace: z.string().optional(),
  }),
]);

export type PiPackageEntry = z.infer<typeof PiPackageEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Projects
// A registered project directory. Blackbook manages its shared, tool-agnostic
// `.agents/skills` folder as a sync target against the source repo. A project is
// just a directory — no git linkage, no per-tool matrix (see tasks/todo.md).
// ─────────────────────────────────────────────────────────────────────────────

export const ProjectEntrySchema = z.object({
  path: z.string().min(1),
  // Display name; defaults to the directory basename when omitted.
  name: z.string().optional(),
});

export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Profiles
// A named, reusable set of source-repo skills. Applying a profile to a workspace
// pushes all its skills into that workspace's `.agents/skills` in one action (a
// one-time provision, not a live sync).
// ─────────────────────────────────────────────────────────────────────────────

export const ProfilesSchema = z.record(z.string(), z.array(z.string())).default({});

// ─────────────────────────────────────────────────────────────────────────────
// Top-level config schema
// ─────────────────────────────────────────────────────────────────────────────

// Use parsed defaults so inner .default() values are applied
// (zod v4 injects raw .default() values without re-parsing)
const SETTINGS_DEFAULT = SettingsSchema.parse({});

export const ConfigSchema = z.object({
  settings: SettingsSchema.default(SETTINGS_DEFAULT),
  marketplaces: z.record(z.string(), z.string()).default({}),
  // Pi marketplaces: name -> source (local path or git URL)
  pi_marketplaces: z.record(z.string(), z.string()).default({}),

  tools: z.record(z.string(), z.array(ToolInstanceSchema)).default({}),
  files: z.array(FileEntrySchema).default([]),
  configs: z.array(ConfigEntrySchema).default([]),
  plugins: z.record(z.string(), z.record(z.string(), PluginComponentSchema)).default({}),
  pi_packages: z.array(PiPackageEntrySchema).default([]),
  projects: z.array(ProjectEntrySchema).default([]),
  profiles: ProfilesSchema,
});

export type BlackbookConfig = z.infer<typeof ConfigSchema>;
