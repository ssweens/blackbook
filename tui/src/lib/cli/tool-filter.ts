import type { ToolInstance } from "../types.js";

export interface ToolFilter {
  /** Matches a SyncPreviewItem's per-instance targeting. `instanceId` omitted for single-target kinds (tool/piPackage). */
  predicate: (toolId: string, instanceId?: string) => boolean;
  matchedInstances: ToolInstance[];
}

export type ResolveToolFilterResult =
  | { ok: true; filter: ToolFilter | null }
  | { ok: false; error: string };

/**
 * Resolve a `--tool` CLI argument against the known tool instances. Matches
 * (case-insensitively) against toolId, display name, or `toolId:instanceId`
 * for disambiguating multiple instances of one tool. Returns `filter: null`
 * when `toolArg` is undefined (no scoping requested).
 */
export function resolveToolFilter(
  toolArg: string | undefined,
  instances: ToolInstance[],
): ResolveToolFilterResult {
  if (!toolArg) return { ok: true, filter: null };

  const needle = toolArg.toLowerCase();
  const matched = instances.filter((inst) => {
    const key = `${inst.toolId}:${inst.instanceId}`.toLowerCase();
    return (
      inst.toolId.toLowerCase() === needle ||
      inst.name.toLowerCase() === needle ||
      key === needle
    );
  });

  if (matched.length === 0) {
    const known = instances.map((i) => `${i.toolId}:${i.instanceId}`).join(", ") || "(none configured)";
    return {
      ok: false,
      error: `No tool instance matches "${toolArg}". Known tools: ${known}`,
    };
  }

  const matchedToolIds = new Set(matched.map((i) => i.toolId));
  const matchedKeys = new Set(matched.map((i) => `${i.toolId}:${i.instanceId}`));
  const predicate = (toolId: string, instanceId?: string): boolean => {
    if (instanceId === undefined) return matchedToolIds.has(toolId);
    return matchedKeys.has(`${toolId}:${instanceId}`);
  };

  return { ok: true, filter: { predicate, matchedInstances: matched } };
}
