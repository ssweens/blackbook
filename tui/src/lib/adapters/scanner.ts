/**
 * Shared scan logic for common-spine artifacts on a tool's disk.
 *
 * Adapters call this to get a baseline inventory and then layer their own
 * tool-specific scanning (bundles, MCP, hooks, config_files) on top.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DiscoveredArtifact,
  Inventory,
  ToolInstance,
} from "../playbook/index.js";
import {
  discoverMarkdownDir,
  discoverSkillsDir,
  hashDir,
  hashFile,
  resolveConfigDir,
} from "./base.js";
import type { AdapterDefaults } from "./types.js";

/**
 * Bundle ownership map: artifact (type, name) → owning bundle name.
 *
 * Adapters that have a bundle registry produce this map; common-spine scan
 * uses it to tag provenance.
 */
export type BundleOwnershipMap = Map<string, string>;

/** Build a key matching what diff-builder uses: `${type}:${name}`. */
export function ownershipKey(type: DiscoveredArtifact["type"], name: string): string {
  return `${type}:${name}`;
}

/**
 * Scan a tool's config dir for common-spine artifacts.
 *
 * @param ownership pre-computed bundle ownership map; pass empty map for tools
 * with no bundle registry (everything is then `standalone`).
 */
export function scanCommonSpine(
  instance: ToolInstance,
  defaults: AdapterDefaults,
  ownership: BundleOwnershipMap,
): Inventory {
  const configDir = resolveConfigDir(instance);
  const artifacts: DiscoveredArtifact[] = [];

  if (!existsSync(configDir)) {
    return { toolId: defaults.toolId, instanceId: instance.id, configDir, artifacts };
  }

  // AGENTS.md (and rename-aware variants like CLAUDE.md). Adapters provide
  // the canonical filename via defaults.paths.agentsMd; rename targets must
  // be detected separately (each candidate filename should be checked when
  // adapter knows it).
  const agentsMdPath = join(configDir, defaults.paths.agentsMd);
  if (existsSync(agentsMdPath)) {
    artifacts.push({
      name: defaults.paths.agentsMd,
      type: "agents_md",
      diskPath: agentsMdPath,
      provenance: classify(ownership, "agents_md", defaults.paths.agentsMd),
      contentHash: hashFile(agentsMdPath),
    });
  }
  // Adapter that uses a renamed AGENTS.md (e.g., Claude → CLAUDE.md) also adds
  // its variant via `extraAgentsMdNames` in scanCommonSpineExtras (see below).

  // Skills (dir-based)
  for (const e of discoverSkillsDir(join(configDir, defaults.paths.skills))) {
    artifacts.push({
      name: e.name,
      type: "skill",
      diskPath: e.path,
      provenance: classify(ownership, "skill", e.name),
      contentHash: hashDir(e.path),
    });
  }

  // Commands (file-based)
  for (const e of discoverMarkdownDir(join(configDir, defaults.paths.commands))) {
    artifacts.push({
      name: e.name,
      type: "command",
      diskPath: e.path,
      provenance: classify(ownership, "command", e.name),
      contentHash: hashFile(e.path),
    });
  }

  // Agents (file-based)
  for (const e of discoverMarkdownDir(join(configDir, defaults.paths.agents))) {
    artifacts.push({
      name: e.name,
      type: "agent",
      diskPath: e.path,
      provenance: classify(ownership, "agent", e.name),
      contentHash: hashFile(e.path),
    });
  }

  return { toolId: defaults.toolId, instanceId: instance.id, configDir, artifacts };
}

/**
 * Add additional AGENTS.md variants for adapters that allow renames
 * (e.g., Claude detects both AGENTS.md and CLAUDE.md).
 *
 * Mutates inventory in place.
 */
export function addAgentsMdVariants(
  inventory: Inventory,
  ownership: BundleOwnershipMap,
  extraNames: string[],
): void {
  for (const name of extraNames) {
    const path = join(inventory.configDir, name);
    if (!existsSync(path)) continue;
    if (inventory.artifacts.some((a) => a.diskPath === path)) continue;
    inventory.artifacts.push({
      name,
      type: "agents_md",
      diskPath: path,
      provenance: classify(ownership, "agents_md", name),
      contentHash: hashFile(path),
    });
  }
}

function classify(
  ownership: BundleOwnershipMap,
  type: DiscoveredArtifact["type"],
  name: string,
): DiscoveredArtifact["provenance"] {
  const owner = ownership.get(ownershipKey(type, name));
  if (owner) return { kind: "bundle", bundleName: owner };
  return { kind: "standalone" };
}

/** Read JSON without throwing; returns undefined on parse failure. */
export function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}
