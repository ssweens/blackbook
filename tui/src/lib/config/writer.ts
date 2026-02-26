import { existsSync, readFileSync } from "fs";
import { parseDocument, stringify } from "yaml";
import type { BlackbookConfig } from "./schema.js";
import { getConfigDir } from "./path.js";
import { getConfigPath } from "./loader.js";
import { atomicWriteFileSync, withFileLockSync } from "../fs-utils.js";
import { join } from "path";

/**
 * Save config to YAML, preserving comments when possible.
 * If the target file already exists, parses it as a Document to preserve comments,
 * then patches values. Otherwise writes fresh YAML.
 */
export function saveConfig(config: BlackbookConfig, configPath?: string): void {
  const path = configPath || getConfigPath();

  // Always write YAML, even if path ends in .toml
  const yamlPath = path.endsWith(".toml")
    ? join(getConfigDir(), "config.yaml")
    : path;

  let content: string;

  if (existsSync(yamlPath)) {
    // Round-trip: parse existing document to preserve comments
    const existing = readFileSync(yamlPath, "utf-8");
    const doc = parseDocument(existing);

    // Patch each top-level key
    doc.set("settings", config.settings);
    doc.set("marketplaces", config.marketplaces);
    doc.set("tools", config.tools);
    doc.set("files", config.files);
    doc.set("plugins", config.plugins);

    content = doc.toString();
  } else {
    content = serializeConfig(config);
  }

  withFileLockSync(yamlPath, () => {
    atomicWriteFileSync(yamlPath, content);
  });
}

function serializeConfig(config: BlackbookConfig): string {
  // Build a clean object for serialization, omitting empty defaults
  const obj: Record<string, unknown> = {};

  obj.settings = config.settings;

  if (Object.keys(config.marketplaces).length > 0) {
    obj.marketplaces = config.marketplaces;
  }

  if (Object.keys(config.tools).length > 0) {
    obj.tools = config.tools;
  }

  if (config.files.length > 0) {
    obj.files = config.files;
  }

  if (Object.keys(config.plugins).length > 0) {
    obj.plugins = config.plugins;
  }

  return stringify(obj, {
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
  });
}
