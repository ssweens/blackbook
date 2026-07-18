import { join } from "path";
import type { Plugin, ToolInstance } from "./types.js";
import { resolveInstanceSubdirPath } from "./path-utils.js";

/**
 * Resolve where a plugin component actually lives on disk for a given
 * instance. `manifestDest` (when present) is authoritative — it may be a
 * relative path (joined onto `configDir`) or an absolute/`~`-prefixed
 * override (used as-is), matching `resolveInstanceSubdirPath`'s semantics.
 * Falls back to deriving the path from the instance's own subdir fields
 * when no manifest entry exists yet.
 */
export function resolveInstalledPluginComponentPath(
  instance: Pick<ToolInstance, "toolId" | "configDir" | "skillsSubdir" | "commandsSubdir" | "agentsSubdir">,
  plugin: Pick<Plugin, "name" | "marketplace" | "installedMarketplace">,
  kind: "skill" | "command" | "agent",
  name: string,
  manifestDest?: string,
): string | null {
  if (manifestDest) {
    return resolveInstanceSubdirPath(instance.configDir, manifestDest);
  }

  const subdir = kind === "skill"
    ? instance.skillsSubdir
    : kind === "command"
      ? instance.commandsSubdir
      : instance.agentsSubdir;
  if (!subdir) return null;

  return kind === "skill"
    ? resolveInstanceSubdirPath(instance.configDir, subdir, name)
    : resolveInstanceSubdirPath(instance.configDir, subdir, `${name}.md`);
}
