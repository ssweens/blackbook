/**
 * Diff builder — shared `preview` logic used by every adapter.
 *
 * Walks the playbook's intended targets for an instance, compares against
 * scanned disk state, and emits add/update/remove/no-op operations.
 *
 * Adapters typically wrap this with tool-specific extras (bundles, MCP).
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Diff,
  DiffOp,
  DiscoveredArtifact,
  Inventory,
  LoadedPlaybook,
  LoadedToolConfig,
  ToolId,
  ToolInstance,
} from "../playbook/index.js";
import type { AdapterDefaults } from "./types.js";
import { hashDir, hashDirAsync, hashFile, resolveConfigDir } from "./base.js";

export interface BuildDiffArgs {
  playbook: LoadedPlaybook;
  toolConfig: LoadedToolConfig;
  instance: ToolInstance;
  defaults: AdapterDefaults;
  inventory: Inventory;
  /** Absolute path to the tools/<tool>/ dir in the playbook (for config_files resolution). */
  toolRootPath?: string;
}

/**
 * Compute a diff for the common-spine artifacts (skills, commands, agents, AGENTS.md).
 *
 * Bundles, MCP, hooks, and config_files are tool-specific — adapters layer those on top.
 */
export async function buildCommonSpineDiff(args: BuildDiffArgs): Promise<Diff> {
  const { playbook, toolConfig, instance, defaults, inventory } = args;
  const ops: DiffOp[] = [];

  const configDir = resolveConfigDir(instance);
  const include = toolConfig.config.include_shared;

  // ─── Build expected target set from playbook ───────────────────────────────

  type Expected = {
    name: string;
    type: "skill" | "command" | "agent" | "agents_md";
    sourcePath: string;
    targetPath: string;
    /** Hash of source content (used for update detection). */
    sourceHash: string;
  };

  const expected: Expected[] = [];

  // AGENTS.md (special: single file with optional rename per instance)
  if (include.agents_md && playbook.shared.agentsMdPath) {
    const renameTo = toolConfig.config.overrides.agents_md[instance.id];
    const targetName = renameTo ?? defaults.paths.agentsMd;
    expected.push({
      name: targetName,
      type: "agents_md",
      sourcePath: playbook.shared.agentsMdPath,
      targetPath: join(configDir, targetName),
      sourceHash: hashFile(playbook.shared.agentsMdPath),
    });
  } else if (toolConfig.standalone.agentsMdPath) {
    // Tool-scoped AGENTS.md (replaces shared if include disabled or absent)
    const renameTo = toolConfig.config.overrides.agents_md[instance.id];
    const targetName = renameTo ?? defaults.paths.agentsMd;
    expected.push({
      name: targetName,
      type: "agents_md",
      sourcePath: toolConfig.standalone.agentsMdPath,
      targetPath: join(configDir, targetName),
      sourceHash: hashFile(toolConfig.standalone.agentsMdPath),
    });
  }

  // Skills, commands, agents — opt-in shared + tool-standalone (standalone replaces same-named shared)
  expected.push(...await collectArtifactExpectations(playbook, toolConfig, configDir, defaults));

  // ─── Index inventory by (type, name) for matching ──────────────────────────

  const invByKey = new Map<string, DiscoveredArtifact>();
  for (const a of inventory.artifacts) {
    invByKey.set(`${a.type}:${a.name}`, a);
  }
  // For agents_md special-case: there's only one. Index it under its disk filename.
  // (We'll match based on equality of resolved target path below.)

  // ─── Compare ───────────────────────────────────────────────────────────────

  const matchedKeys = new Set<string>();

  for (const exp of expected) {
    const key = `${exp.type}:${exp.name}`;
    matchedKeys.add(key);
    const inv = invByKey.get(key);

    if (!inv) {
      ops.push({
        kind: "add",
        artifactType: exp.type,
        name: exp.name,
        sourcePath: exp.sourcePath,
        targetPath: exp.targetPath,
        reason: "missing on disk",
      });
      continue;
    }

    // Compare content
    const diskHash = inv.contentHash ?? await hashTarget(exp.targetPath, exp.type);
    if (diskHash !== exp.sourceHash) {
      ops.push({
        kind: "update",
        artifactType: exp.type,
        name: exp.name,
        sourcePath: exp.sourcePath,
        targetPath: exp.targetPath,
        reason: "content differs",
      });
    } else {
      ops.push({
        kind: "no-op",
        artifactType: exp.type,
        name: exp.name,
        sourcePath: exp.sourcePath,
        targetPath: exp.targetPath,
        reason: "in sync",
      });
    }
  }

  // ─── Removals ──────────────────────────────────────────────────────────────
  // Anything in the inventory tagged as `standalone` but NOT in expected → remove.
  // Bundle-owned items are not removed via common spine; bundle uninstall handles them.

  for (const inv of inventory.artifacts) {
    // We only remove standalone artifacts here. Bundles, hooks, config_files,
    // and MCP are handled by their respective adapter layers.
    if (inv.provenance.kind !== "standalone") continue;
    if (!isCommonSpineType(inv.type)) continue;

    const key = `${inv.type}:${inv.name}`;
    if (matchedKeys.has(key)) continue;

    ops.push({
      kind: "remove",
      artifactType: inv.type,
      name: inv.name,
      targetPath: inv.diskPath,
      reason: "no longer in playbook",
    });
  }

  return { toolId: inventory.toolId, instanceId: inventory.instanceId, ops };
}

/**
 * Append config_file ops for syncable entries in tool.yaml onto an existing Diff.
 * Call this after buildCommonSpineDiff.
 */
export async function appendConfigFileOps(diff: Diff, args: BuildDiffArgs): Promise<Diff> {
  const { toolConfig, instance, toolRootPath } = args;
  if (!toolRootPath) return diff;

  const configDir = resolveConfigDir(instance);
  const ops: DiffOp[] = [...diff.ops];

  for (const cf of toolConfig.config.config_files) {
    if (!cf.syncable) continue;                    // read-only reference, skip

    const sourcePath = resolve(toolRootPath, cf.source);
    const targetPath = join(configDir, cf.target);

    if (!existsSync(sourcePath)) {
      // Source missing in playbook — warn but don't error.
      ops.push({
        kind: "no-op",
        artifactType: "config_file",
        name: cf.target,
        sourcePath,
        targetPath,
        reason: "source missing in playbook",
      });
      continue;
    }

    const sourceHash = await hashTarget(sourcePath, "config_file");

    if (!existsSync(targetPath)) {
      ops.push({
        kind: "add",
        artifactType: "config_file",
        name: cf.target,
        sourcePath,
        targetPath,
        reason: "missing on disk",
      });
    } else {
      const diskHash = await hashTarget(targetPath, "config_file");
      if (diskHash !== sourceHash) {
        ops.push({
          kind: "update",
          artifactType: "config_file",
          name: cf.target,
          sourcePath,
          targetPath,
          reason: "content differs",
        });
      } else {
        ops.push({
          kind: "no-op",
          artifactType: "config_file",
          name: cf.target,
          sourcePath,
          targetPath,
          reason: "in sync",
        });
      }
    }
  }

  return { ...diff, ops };
}

function isCommonSpineType(type: DiscoveredArtifact["type"]): boolean {
  return type === "skill" || type === "command" || type === "agent" || type === "agents_md";
}

async function collectArtifactExpectations(
  playbook: LoadedPlaybook,
  toolConfig: LoadedToolConfig,
  configDir: string,
  defaults: AdapterDefaults,
): Promise<{
  name: string;
  type: "skill" | "command" | "agent";
  sourcePath: string;
  targetPath: string;
  sourceHash: string;
}[]> {
  const out: Awaited<ReturnType<typeof collectArtifactExpectations>> = [];

  // Skills (dir-based)
  const skillSources = mergeSharedAndStandalone(
    playbook.shared.skills,
    toolConfig.standalone.skills,
    toolConfig.config.include_shared.skills,
  );
  for (const ref of skillSources) {
    out.push({
      name: ref.name,
      type: "skill",
      sourcePath: ref.sourcePath,
      targetPath: join(configDir, defaults.paths.skills, ref.name),
      sourceHash: await hashDirAsync(ref.sourcePath),
    });
  }

  // Commands (file-based; on disk: <name>.md)
  const commandSources = mergeSharedAndStandalone(
    playbook.shared.commands,
    toolConfig.standalone.commands,
    toolConfig.config.include_shared.commands,
  );
  for (const ref of commandSources) {
    out.push({
      name: ref.name,
      type: "command",
      sourcePath: ref.sourcePath,
      targetPath: join(configDir, defaults.paths.commands, `${ref.name}.md`),
      sourceHash: hashFile(ref.sourcePath),
    });
  }

  // Agents (file-based)
  const agentSources = mergeSharedAndStandalone(
    playbook.shared.agents,
    toolConfig.standalone.agents,
    toolConfig.config.include_shared.agents,
  );
  for (const ref of agentSources) {
    out.push({
      name: ref.name,
      type: "agent",
      sourcePath: ref.sourcePath,
      targetPath: join(configDir, defaults.paths.agents, `${ref.name}.md`),
      sourceHash: hashFile(ref.sourcePath),
    });
  }

  return out;
}

interface ArtifactRefLite {
  name: string;
  sourcePath: string;
}

/**
 * Merge shared (opt-in) artifacts with tool-standalone artifacts.
 * Standalone replaces same-named shared (locked: replace, not merge).
 */
function mergeSharedAndStandalone(
  shared: ArtifactRefLite[],
  standalone: ArtifactRefLite[],
  includeNames: string[],
): ArtifactRefLite[] {
  const includeSet = new Set(includeNames);
  const standaloneNames = new Set(standalone.map((s) => s.name));
  const result: ArtifactRefLite[] = [];

  // Shared opt-in entries (skip if standalone overrides)
  for (const s of shared) {
    if (!includeSet.has(s.name)) continue;
    if (standaloneNames.has(s.name)) continue;
    result.push(s);
  }
  // All standalone entries (always included)
  for (const s of standalone) {
    result.push(s);
  }
  return result;
}

async function hashTarget(targetPath: string, type: DiscoveredArtifact["type"]): Promise<string> {
  if (!existsSync(targetPath)) return "";
  if (type === "skill") return hashDirAsync(targetPath);
  if (statSync(targetPath).isFile()) return hashFile(targetPath);
  return hashDirAsync(targetPath);
}

/** Suppress unused import warnings from re-exports. */
export type { ToolId };
