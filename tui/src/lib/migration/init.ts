/**
 * `blackbook init` — cold-start reverse-scaffolding from machine state to a
 * fresh playbook directory.
 *
 * Strategy:
 *   1. Detect installed tools (adapters self-report).
 *   2. For each detected tool, pull a PlaybookFragment via its adapter.
 *   3. Cross-tool deduplicate same-named standalone artifacts whose content
 *      is byte-identical → candidates for shared/.
 *   4. Resolve unknown-provenance items per the configured classification policy.
 *   5. Materialize the playbook on disk:
 *      - playbook.yaml
 *      - shared/<type>/<name> (deduplicated content)
 *      - tools/<tool>/<type>/<name> (tool-specific standalone)
 *      - tools/<tool>/{plugins,packages}.yaml (bundle references)
 *      - tools/<tool>/tool.yaml (with include_shared opt-ins for the
 *        deduplicated names)
 *
 * UI prompts for cross-tool dedup conflicts and unknown-provenance items
 * live in the TUI layer; this module operates non-interactively given a
 * resolved policy.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  scaffoldSkeleton,
  writePackagesManifest,
  writePlaybookManifest,
  writePluginsManifest,
  writeToolConfig,
  type BundleEntry,
  type DiscoveredArtifact,
  type IncludeShared,
  type PackagesManifest,
  type PlaybookManifest,
  type PluginsManifest,
  type ToolConfig,
  type ToolId,
  type PlaybookFragment,
} from "../playbook/index.js";
import {
  atomicCopyDir,
  atomicCopyFile,
  ensureDir,
  hashDir,
  hashFile,
} from "../adapters/base.js";
import {
  getAdapter,
  listAdapters,
} from "../adapters/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UnknownClassificationPolicy = "standalone" | "skip" | "prompt";

export interface InitOptions {
  /** Where to materialize the playbook. */
  targetPath: string;
  /** Limit to specific tools (default: every adapter currently registered). */
  toolFilter?: ToolId[];
  /** When true, byte-identical artifacts in multiple tools are auto-shared. Default: true. */
  autoShare?: boolean;
  /** How to handle artifacts the adapter couldn't classify. Default: "skip". */
  classifyUnknown?: UnknownClassificationPolicy;
  /** Override config_dir per tool (e.g. for tests). */
  configDirOverride?: Partial<Record<ToolId, string>>;
}

export interface InitResult {
  playbookPath: string;
  toolsScanned: ToolId[];
  toolsSkipped: { toolId: ToolId; reason: string }[];
  /** Warnings to surface in the UI after init completes. */
  warnings: string[];
  /** Per-tool fragment used to build the playbook. Useful for tests/UI. */
  fragments: PlaybookFragment[];
  /** What ended up in shared/ (after dedup). */
  sharedArtifacts: { skills: string[]; commands: string[]; agents: string[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function blackbookInit(options: InitOptions): Promise<InitResult> {
  const targetPath = resolve(options.targetPath);
  if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
    const entries = readdirSync(targetPath);
    if (entries.length > 0) {
      throw new Error(`init target is non-empty: ${targetPath}`);
    }
  }

  const autoShare = options.autoShare ?? true;
  const unknownPolicy: UnknownClassificationPolicy = options.classifyUnknown ?? "skip";
  const adapters = listAdapters().filter((a) =>
    options.toolFilter ? options.toolFilter.includes(a.defaults.toolId) : true,
  );

  const detected: ToolId[] = [];
  const skipped: { toolId: ToolId; reason: string }[] = [];
  const warnings: string[] = [];
  const fragments: PlaybookFragment[] = [];

  for (const a of adapters) {
    const det = await a.detect();
    if (!det.installed) {
      skipped.push({ toolId: det.toolId, reason: "not detected (binary not on PATH)" });
      continue;
    }
    detected.push(det.toolId);

    const configDir =
      options.configDirOverride?.[det.toolId] ?? a.defaults.defaultConfigDir;
    const instance = {
      id: "default",
      name: a.defaults.displayName,
      config_dir: configDir,
      enabled: true,
    };
    const fragment = await a.pull(instance, {
      defaultUnknownToStandalone: unknownPolicy === "standalone",
    });

    // Apply unknown policy
    if (unknownPolicy === "skip") {
      if (fragment.unclassified.length > 0) {
        warnings.push(
          `${det.toolId}: ${fragment.unclassified.length} artifact(s) skipped (unknown provenance): ${fragment.unclassified
            .map((x) => `${x.type}:${x.name}`)
            .join(", ")}`,
        );
      }
      fragment.unclassified = [];
    } else if (unknownPolicy === "standalone") {
      fragment.standaloneArtifacts.push(...fragment.unclassified);
      fragment.unclassified = [];
    }
    // "prompt" → leave them for UI to handle; init writes nothing for them.

    fragments.push(fragment);
  }

  // ── Dedup standalone artifacts across tools ──────────────────────────────

  const sharedPlan = computeSharedPlan(fragments, autoShare);

  // ── Materialize ──────────────────────────────────────────────────────────

  scaffoldSkeleton(targetPath, detected);
  writePlaybookFiles(targetPath, detected, fragments, sharedPlan);

  return {
    playbookPath: targetPath,
    toolsScanned: detected,
    toolsSkipped: skipped,
    warnings,
    fragments,
    sharedArtifacts: {
      skills: sharedPlan.skills.map((p) => p.name),
      commands: sharedPlan.commands.map((p) => p.name),
      agents: sharedPlan.agents.map((p) => p.name),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tool dedup
// ─────────────────────────────────────────────────────────────────────────────

interface SharedItem {
  name: string;
  /** Disk path on the source tool we'll copy from. */
  sourcePath: string;
  /** Tools whose include_shared list should include this name. */
  includedBy: ToolId[];
}

interface SharedPlan {
  skills: SharedItem[];
  commands: SharedItem[];
  agents: SharedItem[];
  /** Names that ended up shared, by tool — used to subtract from tool-specific writeout. */
  sharedSkillsByTool: Map<ToolId, Set<string>>;
  sharedCommandsByTool: Map<ToolId, Set<string>>;
  sharedAgentsByTool: Map<ToolId, Set<string>>;
}

function computeSharedPlan(fragments: PlaybookFragment[], autoShare: boolean): SharedPlan {
  const plan: SharedPlan = {
    skills: [],
    commands: [],
    agents: [],
    sharedSkillsByTool: new Map(),
    sharedCommandsByTool: new Map(),
    sharedAgentsByTool: new Map(),
  };
  if (!autoShare) return plan;

  for (const type of ["skill", "command", "agent"] as const) {
    // Group by name across tools
    const byName = new Map<string, { toolId: ToolId; artifact: DiscoveredArtifact }[]>();
    for (const f of fragments) {
      for (const a of f.standaloneArtifacts) {
        if (a.type !== type) continue;
        const arr = byName.get(a.name) ?? [];
        arr.push({ toolId: f.toolId, artifact: a });
        byName.set(a.name, arr);
      }
    }
    for (const [name, occurrences] of byName) {
      if (occurrences.length < 2) continue;
      // Auto-share only if every occurrence has identical content
      const hashes = occurrences.map((o) => hashOf(type, o.artifact.diskPath));
      if (hashes.some((h) => h !== hashes[0])) continue;
      const tools = occurrences.map((o) => o.toolId);
      const item: SharedItem = {
        name,
        sourcePath: occurrences[0].artifact.diskPath,
        includedBy: tools,
      };
      switch (type) {
        case "skill":
          plan.skills.push(item);
          for (const t of tools) addToBucket(plan.sharedSkillsByTool, t, name);
          break;
        case "command":
          plan.commands.push(item);
          for (const t of tools) addToBucket(plan.sharedCommandsByTool, t, name);
          break;
        case "agent":
          plan.agents.push(item);
          for (const t of tools) addToBucket(plan.sharedAgentsByTool, t, name);
          break;
      }
    }
  }
  return plan;
}

function addToBucket(map: Map<ToolId, Set<string>>, tool: ToolId, name: string) {
  let s = map.get(tool);
  if (!s) {
    s = new Set();
    map.set(tool, s);
  }
  s.add(name);
}

function hashOf(type: "skill" | "command" | "agent", path: string): string {
  if (type === "skill") return hashDir(path);
  return hashFile(path);
}

// ─────────────────────────────────────────────────────────────────────────────
// File materialization
// ─────────────────────────────────────────────────────────────────────────────

function writePlaybookFiles(
  targetPath: string,
  tools: ToolId[],
  fragments: PlaybookFragment[],
  plan: SharedPlan,
): void {
  // Top-level manifest
  const manifest: PlaybookManifest = {
    playbook_schema_version: 1,
    name: "playbook",
    description: "Generated by blackbook init",
    tools_enabled: tools,
    marketplaces: {},
    required_env: [],
    defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
    settings: { package_manager: "pnpm", backup_retention: 3 },
  };
  writePlaybookManifest(targetPath, manifest);

  // Shared content (deduped)
  const sharedSkillsDir = join(targetPath, "shared", "skills");
  for (const item of plan.skills) {
    const dest = join(sharedSkillsDir, item.name);
    atomicCopyDir(item.sourcePath, dest);
  }
  const sharedCommandsDir = join(targetPath, "shared", "commands");
  ensureDir(sharedCommandsDir);
  for (const item of plan.commands) {
    atomicCopyFile(item.sourcePath, join(sharedCommandsDir, `${item.name}.md`));
  }
  const sharedAgentsDir = join(targetPath, "shared", "agents");
  ensureDir(sharedAgentsDir);
  for (const item of plan.agents) {
    atomicCopyFile(item.sourcePath, join(sharedAgentsDir, `${item.name}.md`));
  }

  // Per-tool: standalone (minus shared), tool.yaml, plugins.yaml/packages.yaml
  for (const fragment of fragments) {
    materializeToolFragment(targetPath, fragment, plan);
  }
}

function materializeToolFragment(
  targetPath: string,
  fragment: PlaybookFragment,
  plan: SharedPlan,
): void {
  const toolId = fragment.toolId;
  const adapter = getAdapter(toolId);
  if (!adapter) return; // already filtered earlier; defensive

  const toolDir = join(targetPath, "tools", toolId);
  ensureDir(toolDir);

  const sharedSkills = plan.sharedSkillsByTool.get(toolId) ?? new Set();
  const sharedCommands = plan.sharedCommandsByTool.get(toolId) ?? new Set();
  const sharedAgents = plan.sharedAgentsByTool.get(toolId) ?? new Set();

  // Tool-specific standalone (artifacts NOT in the shared plan)
  const toolStandaloneSkills = fragment.standaloneArtifacts.filter(
    (a) => a.type === "skill" && !sharedSkills.has(a.name),
  );
  const toolStandaloneCommands = fragment.standaloneArtifacts.filter(
    (a) => a.type === "command" && !sharedCommands.has(a.name),
  );
  const toolStandaloneAgents = fragment.standaloneArtifacts.filter(
    (a) => a.type === "agent" && !sharedAgents.has(a.name),
  );
  const toolStandaloneAgentsMd = fragment.standaloneArtifacts.find(
    (a) => a.type === "agents_md",
  );

  // Skills (dirs)
  for (const a of toolStandaloneSkills) {
    atomicCopyDir(a.diskPath, join(toolDir, "skills", a.name));
  }
  // Commands & agents
  if (toolStandaloneCommands.length) ensureDir(join(toolDir, "commands"));
  for (const a of toolStandaloneCommands) {
    atomicCopyFile(a.diskPath, join(toolDir, "commands", `${a.name}.md`));
  }
  if (toolStandaloneAgents.length) ensureDir(join(toolDir, "agents"));
  for (const a of toolStandaloneAgents) {
    atomicCopyFile(a.diskPath, join(toolDir, "agents", `${a.name}.md`));
  }
  // AGENTS.md → tool-specific (only if no shared yet; init doesn't promote
  // AGENTS.md to shared automatically — too easy to lose tool-specific edits).
  if (toolStandaloneAgentsMd && existsSync(toolStandaloneAgentsMd.diskPath)) {
    atomicCopyFile(toolStandaloneAgentsMd.diskPath, join(toolDir, "AGENTS.md"));
  }

  // tool.yaml — opt-in shared lists computed from the dedup plan
  const include: IncludeShared = {
    agents_md: false, // init doesn't auto-promote AGENTS.md to shared
    skills: Array.from(sharedSkills).sort(),
    commands: Array.from(sharedCommands).sort(),
    agents: Array.from(sharedAgents).sort(),
    mcp: [],
  };
  const toolConfig: ToolConfig = {
    tool: toolId,
    instances: [
      {
        id: "default",
        name: adapter.defaults.displayName,
        config_dir: adapter.defaults.defaultConfigDir,
        enabled: true,
      },
    ],
    include_shared: include,
    overrides: { agents_md: {} },
    config_files: [],
    plugins_manifest: undefined,
    packages_manifest: undefined,
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
  };

  writeToolConfig(targetPath, toolId, toolConfig);

  // Bundle manifests
  if (fragment.bundles.length > 0) {
    if (adapter.defaults.capabilities.bundleParadigm === "artifact") {
      const m: PluginsManifest = { schema: 1, plugins: fragment.bundles };
      writePluginsManifest(targetPath, toolId, m);
    } else if (adapter.defaults.capabilities.bundleParadigm === "code-package") {
      const m: PackagesManifest = { schema: 1, packages: fragment.bundles };
      writePackagesManifest(targetPath, toolId, m);
    }
  }
}

/** Re-export for callers that want to drive parts manually. */
export type { BundleEntry, PlaybookFragment };
