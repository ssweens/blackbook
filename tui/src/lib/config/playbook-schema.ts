import { z } from "zod";

const PlaybookInstanceSchema = z.object({
  id: z.string().default("default"),
  name: z.string().min(1),
  config_dir: z.string().min(1),
});

const ComponentSchema = z.object({
  install_dir: z.string().min(1),
  strategy: z.enum(["symlink", "copy"]).default("symlink"),
});

const ConfigFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  format: z.enum(["json", "toml", "yaml", "markdown", "text"]).default("text"),
  pullback: z.boolean().default(false),
});

const LifecycleCommandSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const LifecycleActionSchema = z.object({
  strategy: z.enum(["package-manager", "native"]).default("package-manager"),
  command: LifecycleCommandSchema.optional(),
});

const LifecycleSchema = z.object({
  install: LifecycleActionSchema.default({ strategy: "package-manager" }),
  update: LifecycleActionSchema.default({ strategy: "package-manager" }),
  uninstall: LifecycleActionSchema.default({ strategy: "package-manager" }),
  migration_cleanup: z.array(LifecycleCommandSchema).default([]),
  migration_note: z.string().optional(),
});

export const PlaybookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  default_instances: z.array(PlaybookInstanceSchema).min(1),
  structure: z.array(z.string()).default([]),
  components: z.record(z.string(), ComponentSchema).default({}),
  config_files: z.array(ConfigFileSchema).default([]),
  syncable: z.boolean().default(true),
  lifecycle: LifecycleSchema.optional(),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
export type PlaybookInstance = z.infer<typeof PlaybookInstanceSchema>;
export type PlaybookComponent = z.infer<typeof ComponentSchema>;
export type PlaybookConfigFile = z.infer<typeof ConfigFileSchema>;
export type PlaybookLifecycle = z.infer<typeof LifecycleSchema>;
export type PlaybookLifecycleAction = z.infer<typeof LifecycleActionSchema>;
