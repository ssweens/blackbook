import type { Plugin } from "./types.js";

/**
 * A row in the Installed tab's plugin section: either a marketplace header
 * (collapsible) or a plugin that belongs to the marketplace above it.
 */
export type PluginRow =
  | { kind: "marketplace"; marketplace: string; count: number; collapsed: boolean }
  | { kind: "plugin"; marketplace: string; plugin: Plugin };

const NO_MARKETPLACE = "(no marketplace)";

/**
 * Group plugins under one collapsible header per marketplace, headers sorted
 * case-insensitively, plugins kept in the order given (already sorted by the
 * caller). A marketplace in `collapsed` contributes only its header, unless
 * `expandAll` is set — used while a search is active so every match stays
 * visible regardless of the collapsed state.
 */
export function buildPluginRows(
  plugins: Plugin[],
  collapsed: ReadonlySet<string>,
  opts: { expandAll?: boolean } = {},
): PluginRow[] {
  const order: string[] = [];
  const byMarketplace = new Map<string, Plugin[]>();
  for (const plugin of plugins) {
    const marketplace = plugin.marketplace || NO_MARKETPLACE;
    let group = byMarketplace.get(marketplace);
    if (!group) {
      group = [];
      byMarketplace.set(marketplace, group);
      order.push(marketplace);
    }
    group.push(plugin);
  }
  order.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const rows: PluginRow[] = [];
  for (const marketplace of order) {
    const group = byMarketplace.get(marketplace)!;
    const isCollapsed = !opts.expandAll && collapsed.has(marketplace);
    rows.push({ kind: "marketplace", marketplace, count: group.length, collapsed: isCollapsed });
    if (!isCollapsed) {
      for (const plugin of group) rows.push({ kind: "plugin", marketplace, plugin });
    }
  }
  return rows;
}
