import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { PlaybookSchema, type Playbook, type PlaybookConfigFile } from "./playbook-schema.js";
import type { BlackbookConfig, ToolInstanceConfig } from "./schema.js";
import { expandPath } from "./path.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYBOOKS_DIR = join(__dirname, "..", "lib", "playbooks");

// Cache playbooks after first load
let cachedPlaybooks: Map<string, Playbook> | null = null;

function getPlaybooksDir(): string {
  // Try relative to this file first (works in dev and dist)
  const candidates = [
    join(__dirname, "..", "playbooks"),      // src/lib/config/../playbooks
    join(__dirname, "..", "lib", "playbooks"), // dist layout
    PLAYBOOKS_DIR,
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]; // Fallback
}

const BUILTIN_TOOL_IDS = [
  "claude-code",
  "opencode",
  "amp-code",
  "openai-codex",
  "pi",
  "blackbook",
];

export function loadPlaybook(toolId: string): Playbook | null {
  const dir = getPlaybooksDir();
  const path = join(dir, `${toolId}.yaml`);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");
  const raw = parseYaml(content);
  return PlaybookSchema.parse(raw);
}

export function getAllPlaybooks(): Map<string, Playbook> {
  if (cachedPlaybooks) return cachedPlaybooks;

  const playbooks = new Map<string, Playbook>();
  for (const toolId of BUILTIN_TOOL_IDS) {
    const playbook = loadPlaybook(toolId);
    if (playbook) {
      playbooks.set(toolId, playbook);
    }
  }
  cachedPlaybooks = playbooks;
  return playbooks;
}

export function clearPlaybookCache(): void {
  cachedPlaybooks = null;
}

/**
 * Resolve tool instances by merging config overrides with playbook defaults.
 * Config instances override playbook default_instances by `id`.
 * If config doesn't mention a tool, playbook defaults are used (if tool detected on disk).
 */
export function resolveToolInstances(
  config: BlackbookConfig,
  playbooks: Map<string, Playbook>
): Map<string, ToolInstanceConfig[]> {
  const resolved = new Map<string, ToolInstanceConfig[]>();

  for (const [toolId, playbook] of playbooks) {
    const configInstances = config.tools[toolId];

    if (configInstances && configInstances.length > 0) {
      // Config overrides playbook defaults
      resolved.set(toolId, configInstances);
    } else {
      // Use playbook defaults (expand ~ in config_dir)
      const defaults = playbook.default_instances.map((inst) => ({
        id: inst.id,
        name: inst.name,
        enabled: true,
        config_dir: inst.config_dir,
      }));
      resolved.set(toolId, defaults);
    }
  }

  return resolved;
}

/**
 * Check if a tool is a valid file sync target.
 */
export function isSyncTarget(toolId: string, playbooks?: Map<string, Playbook>): boolean {
  const pbs = playbooks || getAllPlaybooks();
  const playbook = pbs.get(toolId);
  if (!playbook) return false;
  return playbook.syncable;
}

/**
 * Get playbook config_file metadata for a given target path.
 * Returns the matching config_file entry if the path matches, including pullback flag.
 */
export function getPlaybookMetadata(
  toolId: string,
  targetRelPath: string,
  playbooks?: Map<string, Playbook>
): PlaybookConfigFile | null {
  const pbs = playbooks || getAllPlaybooks();
  const playbook = pbs.get(toolId);
  if (!playbook) return null;

  return playbook.config_files.find((cf) => cf.path === targetRelPath) ?? null;
}

/**
 * Get all built-in tool IDs.
 */
export function getBuiltinToolIds(): string[] {
  return [...BUILTIN_TOOL_IDS];
}
