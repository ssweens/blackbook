import type { DriftKind, FileStatus, PiPackage } from "./types.js";
import type { ManagedItem } from "./managed-item.js";
import { computePluginDrift, type PluginDrift } from "./plugin-drift.js";

export type FileInstanceDrift = "in-sync" | "missing" | "failed" | "changed";

export type ItemDrift =
  | { kind: "plugin"; plugin: PluginDrift }
  | { kind: "file" | "config" | "asset"; instances: Record<string, FileInstanceDrift>; driftKinds: Record<string, DriftKind | undefined> }
  | { kind: "pi-package"; status: "not-installed" | "in-sync" | "update-available" };

function fileStatusToDrift(status: FileStatus["instances"][number]["status"]): FileInstanceDrift {
  if (status === "ok") return "in-sync";
  if (status === "missing") return "missing";
  if (status === "failed") return "failed";
  return "changed";
}

/**
 * Unified drift computation entrypoint for all managed item kinds.
 */
export async function computeItemDrift(item: ManagedItem): Promise<ItemDrift> {
  if (item.kind === "plugin" && item._plugin) {
    return { kind: "plugin", plugin: await computePluginDrift(item._plugin) };
  }

  if ((item.kind === "file" || item.kind === "config" || item.kind === "asset") && item._file) {
    const instances: Record<string, FileInstanceDrift> = {};
    const driftKinds: Record<string, DriftKind | undefined> = {};

    for (const inst of item._file.instances) {
      const key = `${inst.toolId}:${inst.instanceId}`;
      instances[key] = fileStatusToDrift(inst.status);
      driftKinds[key] = inst.driftKind;
    }

    return { kind: item.kind, instances, driftKinds };
  }

  if (item.kind === "pi-package" && item._piPackage) {
    const pkg: PiPackage = item._piPackage;
    if (!pkg.installed) return { kind: "pi-package", status: "not-installed" };
    return { kind: "pi-package", status: pkg.hasUpdate ? "update-available" : "in-sync" };
  }

  // Fallback for partially-populated managed items.
  if (item.kind === "pi-package") return { kind: "pi-package", status: item.hasUpdate ? "update-available" : "in-sync" };
  return { kind: "file", instances: {}, driftKinds: {} };
}
