import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type BlackbookConfig } from "./schema.js";
import { deepMerge } from "./merge.js";
import { getConfigDir } from "./path.js";
import { withFileLockSync } from "../fs-utils.js";

export interface LoadConfigResult {
  config: BlackbookConfig;
  configPath: string;
  errors: ConfigLoadError[];
}

export interface ConfigLoadError {
  source: string;
  message: string;
  line?: number;
  path?: string[];
}

/**
 * Determine config file path.
 */
export function getConfigPath(): string {
  const dir = getConfigDir();
  return join(dir, "config.yaml");
}

function parseYamlFile(filePath: string): { data: Record<string, unknown>; errors: ConfigLoadError[] } {
  const errors: ConfigLoadError[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const data = parseYaml(content);
    if (data === null || data === undefined) {
      return { data: {}, errors };
    }
    if (typeof data !== "object" || Array.isArray(data)) {
      errors.push({
        source: filePath,
        message: "Config must be a YAML mapping (object), not a scalar or sequence",
      });
      return { data: {}, errors };
    }
    return { data: data as Record<string, unknown>, errors };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push({ source: filePath, message: msg });
    return { data: {}, errors };
  }
}

/**
 * Load and validate config from YAML files.
 * 1. Parse config.yaml (or provided path)
 * 2. If config.local.yaml exists, deep-merge
 * 3. Validate with zod schema
 */
export function loadConfig(configPath?: string): LoadConfigResult {
  const path = configPath || getConfigPath();
  const allErrors: ConfigLoadError[] = [];

  if (!existsSync(path)) {
    const config = ConfigSchema.parse({});
    return { config, configPath: path, errors: [] };
  }

  // Parse base config
  const base = withFileLockSync(path, () => parseYamlFile(path));
  allErrors.push(...base.errors);

  let merged = base.data;

  // Deep-merge local overrides if present
  if (!configPath) {
    const dir = getConfigDir();
    const localPath = join(dir, "config.local.yaml");
    if (existsSync(localPath)) {
      const local = parseYamlFile(localPath);
      allErrors.push(...local.errors);
      if (Object.keys(local.data).length > 0) {
        merged = deepMerge(
          merged as Record<string, never>,
          local.data as Record<string, never>,
        );
      }
    }
  }

  // Validate with zod
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    for (const issue of result.error.issues) {
      allErrors.push({
        source: path,
        message: issue.message,
        path: issue.path.map(String),
      });
    }
    // Return defaults with errors for degraded mode
    const config = ConfigSchema.parse({});
    return { config, configPath: path, errors: allErrors };
  }

  return { config: result.data, configPath: path, errors: allErrors };
}

/**
 * Load config, returning just the typed config (for backward-compatible callers).
 * Throws on parse failure.
 */
export function loadConfigStrict(configPath?: string): BlackbookConfig {
  const { config, errors } = loadConfig(configPath);
  if (errors.length > 0) {
    const messages = errors.map((e) =>
      e.path ? `${e.source}: ${e.path.join(".")}: ${e.message}` : `${e.source}: ${e.message}`
    );
    throw new Error(`Config validation failed:\n${messages.join("\n")}`);
  }
  return config;
}
