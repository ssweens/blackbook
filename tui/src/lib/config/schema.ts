import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// File entry: unified model replacing separate assets + configs
// ─────────────────────────────────────────────────────────────────────────────

export const FileEntrySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  tools: z.array(z.string()).optional(),
  pullback: z.boolean().default(false),
  overrides: z.record(z.string(), z.string()).optional(),
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

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
  package_manager: z.enum(["npm", "pnpm", "bun"]).default("pnpm"),
  backup_retention: z.number().int().min(1).max(100).default(3),
  default_pullback: z.boolean().default(false),
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
// Top-level config schema
// ─────────────────────────────────────────────────────────────────────────────

// Use parsed defaults so inner .default() values are applied
// (zod v4 injects raw .default() values without re-parsing)
const SETTINGS_DEFAULT = SettingsSchema.parse({});

export const ConfigSchema = z.object({
  settings: SettingsSchema.default(SETTINGS_DEFAULT),
  marketplaces: z.record(z.string(), z.string()).default({}),
  tools: z.record(z.string(), z.array(ToolInstanceSchema)).default({}),
  files: z.array(FileEntrySchema).default([]),
  plugins: z.record(z.string(), z.record(z.string(), PluginComponentSchema)).default({}),
});

export type BlackbookConfig = z.infer<typeof ConfigSchema>;
