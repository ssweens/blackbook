import type { PiPackage, SyncPreviewItem } from "./types.js";

export type SortBy = "default" | "name" | "installed" | "popularity";
export type SortDir = "asc" | "desc";

/**
 * Canonical filter+sort for the Discover Pi Packages list.
 *
 * This is the single source of truth shared by DiscoverTab's rendering and
 * App.tsx's keyboard-index math. Both MUST derive their list from this function
 * so the highlighted row and the row acted upon by Enter/Space are always the
 * same item.
 */
export function sortAndFilterPiPackages(
  packages: PiPackage[],
  sortBy: SortBy,
  sortDir: SortDir,
  search: string,
): PiPackage[] {
  const lowerSearch = search.toLowerCase();
  const filtered = search
    ? packages.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          p.description.toLowerCase().includes(lowerSearch) ||
          p.marketplace.toLowerCase().includes(lowerSearch),
      )
    : packages;

  return [...filtered].sort((a, b) => {
    if (sortBy === "default") {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (!a.installed && !b.installed) {
        const aIsNpm = a.sourceType === "npm";
        const bIsNpm = b.sourceType === "npm";
        if (aIsNpm !== bIsNpm) return aIsNpm ? 1 : -1;
        if (aIsNpm && bIsNpm) {
          const aDownloads = a.weeklyDownloads ?? 0;
          const bDownloads = b.weeklyDownloads ?? 0;
          if (aDownloads !== bDownloads) return bDownloads - aDownloads;
        }
      }
      return a.name.localeCompare(b.name);
    }
    if (sortBy === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortBy === "popularity") {
      const aDownloads = a.weeklyDownloads ?? 0;
      const bDownloads = b.weeklyDownloads ?? 0;
      const cmp = bDownloads - aDownloads;
      if (cmp !== 0) return sortDir === "desc" ? cmp : -cmp;
      return a.name.localeCompare(b.name);
    }
    // installed sort
    const aInstalled = a.installed ? 1 : 0;
    const bInstalled = b.installed ? 1 : 0;
    const cmp = bInstalled - aInstalled;
    if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Canonical selection key for a sync-preview item.
 *
 * Namespace-qualified for skills so that two skills sharing a bare name but
 * living in different namespaces never collide. This is the single source of
 * truth shared by App.tsx (Space-toggle + `y` confirm-sync) and
 * SyncTab/SyncList (checkbox rendering + selected-count footer).
 */
export function getSyncItemKey(item: SyncPreviewItem): string {
  if (item.kind === "plugin") return `plugin:${item.plugin.marketplace}:${item.plugin.name}`;
  if (item.kind === "tool") return `tool:${item.toolId}`;
  if (item.kind === "skill") {
    const ns = item.skill.namespace;
    return `skill:${ns ? `${ns}/` : ""}${item.skill.name}`;
  }
  if (item.kind === "piPackage") return `piPackage:${item.piPackage.source}`;
  return `file:${item.file.name}`;
}
