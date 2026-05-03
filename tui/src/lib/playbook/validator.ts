/**
 * Cross-file consistency validator.
 *
 * Zod schemas (loader) handle individual file shape. This module checks invariants
 * that span multiple files in the playbook:
 *
 *   - tool.yaml include_shared.<type> entries reference items that exist in shared/
 *   - tool.yaml include_shared.mcp entries match shared/mcp/<name>.yaml
 *   - playbook.yaml required_env covers MCP server env-var refs
 *   - tool instance ids are unique within a tool
 *   - bundle names are unique within a manifest
 *   - tools_enabled has a registered adapter (deferred — adapter registry checked elsewhere)
 *
 * Returns a ValidationReport. Issues with severity "error" make the playbook invalid.
 */

import type { LoadedPlaybook, LoadedToolConfig, ValidationIssue, ValidationReport } from "./types.js";
import type { McpServer, ToolId } from "./schema.js";

export function validatePlaybook(playbook: LoadedPlaybook): ValidationReport {
  const issues: ValidationIssue[] = [];
  for (const check of CHECKS) check(playbook, issues);
  return {
    issues,
    ok: !issues.some((i) => i.severity === "error"),
  };
}

type Check = (playbook: LoadedPlaybook, issues: ValidationIssue[]) => void;

const CHECKS: Check[] = [
  checkSharedReferences,
  checkInstanceIdsUnique,
  checkBundleNamesUnique,
  checkRequiredEnvForMcp,
  checkAgentsMdOverridesValid,
  checkConfigFilesExist,
];

// ─────────────────────────────────────────────────────────────────────────────

function checkSharedReferences(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  const sharedSkillNames = new Set(playbook.shared.skills.map((s) => s.name));
  const sharedCommandNames = new Set(playbook.shared.commands.map((c) => c.name));
  const sharedAgentNames = new Set(playbook.shared.agents.map((a) => a.name));
  const sharedMcpNames = new Set(Object.keys(playbook.shared.mcp));

  for (const [toolId, t] of toolEntries(playbook)) {
    const inc = t.config.include_shared;

    if (inc.agents_md && !playbook.shared.agentsMdPath) {
      issues.push({
        severity: "error",
        source: `tools/${toolId}/tool.yaml`,
        pointer: "include_shared.agents_md",
        message: "agents_md: true but shared/AGENTS.md does not exist",
      });
    }

    for (const name of inc.skills) {
      if (!sharedSkillNames.has(name)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `include_shared.skills:${name}`,
          message: `references shared skill "${name}" which does not exist in shared/skills/`,
        });
      }
    }
    for (const name of inc.commands) {
      if (!sharedCommandNames.has(name)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `include_shared.commands:${name}`,
          message: `references shared command "${name}" which does not exist in shared/commands/`,
        });
      }
    }
    for (const name of inc.agents) {
      if (!sharedAgentNames.has(name)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `include_shared.agents:${name}`,
          message: `references shared agent "${name}" which does not exist in shared/agents/`,
        });
      }
    }
    for (const name of inc.mcp) {
      if (!sharedMcpNames.has(name)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `include_shared.mcp:${name}`,
          message: `references shared MCP server "${name}" which does not exist in shared/mcp/`,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function checkInstanceIdsUnique(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  for (const [toolId, t] of toolEntries(playbook)) {
    const seen = new Set<string>();
    for (const inst of t.config.instances) {
      if (seen.has(inst.id)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `instances:${inst.id}`,
          message: `duplicate instance id "${inst.id}"`,
        });
      }
      seen.add(inst.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function checkBundleNamesUnique(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  for (const [toolId, t] of toolEntries(playbook)) {
    if (t.pluginsManifest) {
      const seen = new Set<string>();
      for (const p of t.pluginsManifest.plugins) {
        if (seen.has(p.name)) {
          issues.push({
            severity: "error",
            source: `tools/${toolId}/plugins.yaml`,
            pointer: `plugins:${p.name}`,
            message: `duplicate plugin name "${p.name}"`,
          });
        }
        seen.add(p.name);
      }
    }
    if (t.packagesManifest) {
      const seen = new Set<string>();
      for (const p of t.packagesManifest.packages) {
        if (seen.has(p.name)) {
          issues.push({
            severity: "error",
            source: `tools/${toolId}/packages.yaml`,
            pointer: `packages:${p.name}`,
            message: `duplicate package name "${p.name}"`,
          });
        }
        seen.add(p.name);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function checkRequiredEnvForMcp(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  const declaredEnv = new Set(playbook.manifest.required_env.map((e) => e.name));

  for (const server of Object.values(playbook.shared.mcp)) {
    const refs = collectEnvRefs(server);
    for (const ref of refs) {
      if (!declaredEnv.has(ref.envVar)) {
        issues.push({
          severity: "warning",
          source: `shared/mcp/${server.name}.yaml`,
          pointer: ref.field,
          message: `MCP server "${server.name}" references env var "${ref.envVar}" but playbook.yaml required_env does not declare it`,
        });
      }
    }
  }
}

interface EnvRef {
  envVar: string;
  field: string;
}

function collectEnvRefs(server: McpServer): EnvRef[] {
  const refs: EnvRef[] = [];
  if (server.type === "remote" && server.bearerTokenEnv) {
    refs.push({ envVar: server.bearerTokenEnv, field: "bearerTokenEnv" });
  }
  if (server.type === "local") {
    for (const [k, v] of Object.entries(server.env ?? {})) {
      const envVar = extractEnvVar(v);
      if (envVar) refs.push({ envVar, field: `env.${k}` });
    }
  }
  return refs;
}

const PLACEHOLDER_RE = /^\$env:([A-Z_][A-Z0-9_]*)$/;

function extractEnvVar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const m = value.match(PLACEHOLDER_RE);
    return m?.[1];
  }
  if (typeof value === "object" && value !== null && "from_env" in value) {
    const v = (value as { from_env: unknown }).from_env;
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

function checkAgentsMdOverridesValid(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  for (const [toolId, t] of toolEntries(playbook)) {
    const validInstanceIds = new Set(t.config.instances.map((i) => i.id));
    for (const instId of Object.keys(t.config.overrides.agents_md)) {
      if (!validInstanceIds.has(instId)) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `overrides.agents_md:${instId}`,
          message: `references instance id "${instId}" which is not declared in instances[]`,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function checkConfigFilesExist(playbook: LoadedPlaybook, issues: ValidationIssue[]) {
  // Soft check; lifecycle tooling will hard-fail if a syncable source is missing.
  // Here we only flag duplicate targets within a single tool.
  for (const [toolId, t] of toolEntries(playbook)) {
    const seen = new Map<string, string>();
    for (const cf of t.config.config_files) {
      const existing = seen.get(cf.target);
      if (existing) {
        issues.push({
          severity: "error",
          source: `tools/${toolId}/tool.yaml`,
          pointer: `config_files`,
          message: `multiple config_files target "${cf.target}" (sources: ${existing}, ${cf.source})`,
        });
      } else {
        seen.set(cf.target, cf.source);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function* toolEntries(playbook: LoadedPlaybook): Iterable<[ToolId, LoadedToolConfig]> {
  for (const [toolId, cfg] of Object.entries(playbook.tools)) {
    if (cfg) yield [toolId as ToolId, cfg];
  }
}
