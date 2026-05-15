/**
 * Generic Item List — Phase 2 of Architecture Refactor
 *
 * A single list component that replaces PluginList, FileList, ConfigList,
 * AssetList, and PiPackageList.  Takes `ManagedItem[]` and renders with
 * configurable columns, shared windowing, and unified status badges.
 *
 * The existing bespoke list components remain for now — they'll be swapped
 * out one-by-one once this is wired into App.tsx.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ManagedItem, ItemKind } from "../lib/managed-item.js";

// ─────────────────────────────────────────────────────────────────────────────
// Column Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnId = "name" | "type" | "marketplace" | "scope" | "status";

export interface ColumnDef {
  id: ColumnId;
  width?: number;        // fixed width; auto-computed if omitted
  color?: string;        // ink color name
  render?: (item: ManagedItem) => string;
}

/** Compute the display value for a column. */
function getColumnValue(item: ManagedItem, col: ColumnDef): string {
  if (col.render) return col.render(item);
  switch (col.id) {
    case "name":
      return item.name;
    case "type":
      return getTypeLabel(item);
    case "marketplace":
      return item.marketplace;
    case "scope":
      return getScopeLabel(item);
    case "status":
      return ""; // handled by status badges
    default:
      return "";
  }
}

function getTypeLabel(item: ManagedItem): string {
  switch (item.kind) {
    case "plugin":
      return item.hasMcp ? "MCP" : "Plugin";
    case "file":
      return "File";
    case "config":
      return "Config";
    case "asset":
      return "Asset";
    case "pi-package":
      return "PiPkg";
    default:
      return "";
  }
}

function getTypeColor(item: ManagedItem): string {
  switch (item.kind) {
    case "plugin":
      return "blue";
    case "file":
      return "blue";
    case "config":
      return "magenta";
    case "asset":
      return "blue";
    case "pi-package":
      return "magenta";
    default:
      return "gray";
  }
}

function getScopeLabel(item: ManagedItem): string {
  if (item.tools && item.tools.length > 0) {
    return item.tools.join(", ");
  }
  // Skills/files not installed on any tool yet — distinguish from "installed everywhere".
  if (!item.installed && item.instances.length === 0) {
    return "source only";
  }
  return "All tools";
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Flags
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemFlags {
  installed: boolean;
  incomplete: boolean;
  changed: boolean;
  sourceMissing: boolean;
  hasUpdate: boolean;
  /** "clean" / "modified" / "untracked" / "unknown" / undefined (no source tracking) */
  gitStatus?: "clean" | "modified" | "untracked" | "unknown";
}

export function computeItemFlags(item: ManagedItem): ItemFlags {
  const installed = item.installed;
  const incomplete = item.incomplete;
  const changed = item.instances.some(
    (i) => i.status === "changed",
  );
  const sourceMissing = item._file
    ? item._file.instances.some(
        (i) =>
          i.message.toLowerCase().startsWith("source not found") ||
          i.message.toLowerCase().startsWith("source pattern matched 0") ||
          i.message.toLowerCase().startsWith("source directory not found"),
      )
    : false;
  const hasUpdate = item.hasUpdate ?? false;
  const gitStatus = item._skill?.gitStatus ?? item._file?.gitStatus;

  return { installed, incomplete, changed, sourceMissing, hasUpdate, gitStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Windowing
// ─────────────────────────────────────────────────────────────────────────────

function computeWindow<T>(items: T[], selectedIndex: number, maxHeight: number): { visible: T[]; startIndex: number } {
  if (items.length <= maxHeight) {
    return { visible: items, startIndex: 0 };
  }
  const maxStart = Math.max(0, items.length - maxHeight);
  const start = Math.min(Math.max(0, selectedIndex - (maxHeight - 1)), maxStart);
  return { visible: items.slice(start, start + maxHeight), startIndex: start };
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Presets
// ─────────────────────────────────────────────────────────────────────────────

/** Default columns for plugin/pi-package lists (Discover, Installed). */
export const PLUGIN_COLUMNS: ColumnDef[] = [
  { id: "name" },
  { id: "type", width: 6 },
  { id: "marketplace" },
];

/** Default columns for file/config/asset lists. */
export const FILE_COLUMNS: ColumnDef[] = [
  { id: "name" },
  { id: "scope" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemListProps {
  items: ManagedItem[];
  selectedIndex: number;
  maxHeight?: number;
  columns?: ColumnDef[];
  emptyMessage?: string;
}

export function ItemList({
  items,
  selectedIndex,
  maxHeight = 12,
  columns,
  emptyMessage = "No items found",
}: ItemListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  // Auto-select columns based on item kinds present
  const effectiveColumns = useMemo(() => {
    if (columns) return columns;
    const hasPlugins = items.some((i) => i.kind === "plugin" || i.kind === "pi-package");
    return hasPlugins ? PLUGIN_COLUMNS : FILE_COLUMNS;
  }, [columns, items]);

  // Compute column widths
  const colWidths = useMemo(() => {
    return effectiveColumns.map((col) => {
      if (col.width) return col.width;
      const values = items.map((item) => getColumnValue(item, col));
      return Math.min(30, Math.max(...values.map((v) => v.length), 10));
    });
  }, [items, effectiveColumns]);

  const { visible, startIndex } = useMemo(
    () => computeWindow(items, effectiveIndex, maxHeight),
    [items, effectiveIndex, maxHeight],
  );

  if (items.length === 0) {
    return (
      <Box>
        <Text color="gray">{emptyMessage}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((item, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const flags = computeItemFlags(item);

        return (
          <ItemRow
            key={`${item.kind}:${item.marketplace}:${item.name}`}
            item={item}
            isSelected={isSelected}
            flags={flags}
            columns={effectiveColumns}
            colWidths={colWidths}
          />
        );
      })}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row Rendering
// ─────────────────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: ManagedItem;
  isSelected: boolean;
  flags: ItemFlags;
  columns: ColumnDef[];
  colWidths: number[];
}

function ItemRow({ item, isSelected, flags, columns, colWidths }: ItemRowProps) {
  const indicator = isSelected ? "❯" : " ";
  const statusIcon = flags.installed ? "✔" : " ";
  const statusColor = flags.installed ? "green" : "gray";
  const statusLabel = flags.installed ? "installed" : "";
  const statusWidth = 9;

  return (
    <Box>
      <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>

      {columns.map((col, idx) => {
        const value = getColumnValue(item, col);
        const width = colWidths[idx];
        const padded = value.padEnd(width);

        // Determine color
        let color: string;
        if (col.id === "name") {
          color = "white";
        } else if (col.color) {
          color = col.color;
        } else if (col.id === "type") {
          color = getTypeColor(item);
        } else if (col.id === "scope" && item.tools && item.tools.length > 0) {
          color = "magenta";
        } else {
          color = "gray";
        }

        return (
          <React.Fragment key={col.id}>
            {idx > 0 && (
              col.id === "marketplace" || col.id === "scope"
                ? <Text color="gray"> · </Text>
                : <Text color="gray"> </Text>
            )}
            <Text bold={col.id === "name" && isSelected} color={color}>
              {padded}
            </Text>
          </React.Fragment>
        );
      })}

      {/* Status area */}
      <Text color="gray"> </Text>
      <Text color={statusColor}>{statusIcon}</Text>
      <Text color={statusColor}>{" " + statusLabel.padEnd(statusWidth)}</Text>

      {/* Badges */}
      {flags.incomplete && (
        <>
          <Text color="gray"> · </Text>
          <Text color="yellow">incomplete</Text>
        </>
      )}
      {flags.changed && (
        <>
          <Text color="gray"> · </Text>
          <Text color="yellow">drifted</Text>
        </>
      )}
      {flags.sourceMissing && (
        <>
          <Text color="gray"> · </Text>
          <Text color="red">source missing</Text>
        </>
      )}
      {flags.hasUpdate && (
        <>
          <Text color="gray"> · </Text>
          <Text color="blue">update available</Text>
        </>
      )}
      {flags.gitStatus === "untracked" && (
        <>
          <Text color="gray"> · </Text>
          <Text color="red">not in git</Text>
        </>
      )}
      {flags.gitStatus === "modified" && (
        <>
          <Text color="gray"> · </Text>
          <Text color="yellow">uncommitted</Text>
        </>
      )}
    </Box>
  );
}
