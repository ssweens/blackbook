/**
 * Generic Item Detail — Phase 3 of Architecture Refactor
 *
 * A single detail component that can render plugin, file, config, asset,
 * and Pi package detail views.  Shares the instance-status + action-list
 * pattern that all detail views use, with kind-specific metadata sections.
 *
 * This component exists alongside the bespoke detail components for now.
 * Once wired into App.tsx, the old components can be deleted.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ManagedItem, ItemInstanceStatus } from "../lib/managed-item.js";
import type { DiffInstanceSummary, DiffInstanceRef } from "../lib/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Unified Action Type
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemAction {
  id: string;
  label: string;
  type:
    | "diff"
    | "missing"
    | "status"
    | "sync"
    | "install"
    | "uninstall"
    | "update"
    | "install_tool"
    | "uninstall_tool"
    | "pullback"
    | "back";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  /** For install_tool / uninstall_tool actions — the target tool instance. */
  toolStatus?: { toolId: string; instanceId: string; name: string; installed?: boolean; enabled?: boolean; supported?: boolean };
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemDetailProps {
  item: ManagedItem;
  actions: ItemAction[];
  selectedAction: number;
  /** Optional extra metadata rendered between header and instance list. */
  metadata?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ItemDetail({ item, actions, selectedAction, metadata }: ItemDetailProps) {
  const hasDrift = item.instances.some(
    (i) => i.status === "changed",
  );
  const isIncomplete = item.installed && item.incomplete;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>{item.name}</Text>
        {item.marketplace !== "local" && (
          <Text color="gray"> @ {item.marketplace}</Text>
        )}
      </Box>

      {/* Description */}
      {item.description && item.kind !== "file" && item.kind !== "config" && item.kind !== "asset" && (
        <Box marginBottom={1}>
          <Text>{item.description}</Text>
        </Box>
      )}

      {/* Status line */}
      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={item.installed ? "green" : "yellow"}>
          {item.installed ? "Installed" : "Not Installed"}
        </Text>
        {isIncomplete && <Text color="yellow"> (incomplete)</Text>}
        {hasDrift && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {/* Kind-specific metadata */}
      {metadata}

      {/* Instance list + actions */}
      <Box flexDirection="column" marginTop={1}>
        {item.installed && <Text bold>Instances:</Text>}
        {actions.map((action, i) => (
          <ActionRow
            key={action.id}
            action={action}
            isSelected={i === selectedAction}
          />
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">
          {actions.some((a) => a.type === "pullback") ? "p pull to source · " : ""}
          Esc back
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Row — shared rendering for status and action items
// ─────────────────────────────────────────────────────────────────────────────

interface ActionRowProps {
  action: ItemAction;
  isSelected: boolean;
}

function ActionRow({ action, isSelected }: ActionRowProps) {
  // Status / diff / missing rows: show label: statusLabel +N/-N
  if (action.type === "diff" || action.type === "missing" || action.type === "status") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
          <Text color={isSelected ? "white" : "gray"}>{action.label}:</Text>
          <Text color={action.statusColor || "gray"}> {action.statusLabel}</Text>
          {action.type === "diff" && action.instance && "totalAdded" in action.instance && (
            <>
              <Text color="green"> +{(action.instance as DiffInstanceSummary).totalAdded}</Text>
              <Text color="red"> -{(action.instance as DiffInstanceSummary).totalRemoved}</Text>
            </>
          )}
          {action.type === "missing" && <Text color="yellow"> (click to view)</Text>}
        </Box>
      </Box>
    );
  }

  // Regular action rows
  const color = getActionColor(action.type);
  const hasTopMargin =
    action.type === "uninstall" || action.type === "sync";

  return (
    <Box marginTop={hasTopMargin ? 1 : 0}>
      <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
      <Text bold={isSelected} color={isSelected ? color : "gray"}>
        {action.label}
      </Text>
    </Box>
  );
}

function getActionColor(type: ItemAction["type"]): string {
  switch (type) {
    case "install":
    case "install_tool":
    case "sync":
      return "green";
    case "uninstall":
    case "uninstall_tool":
      return "red";
    case "update":
      return "cyan";
    case "pullback":
      return "cyan";
    default:
      return "white";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kind-specific Metadata Components
// ─────────────────────────────────────────────────────────────────────────────

/** Plugin metadata: scope, homepage, components. */
export function PluginMetadata({ item }: { item: ManagedItem }) {
  return (
    <>
      <Box marginBottom={1}>
        <Text color="gray">Scope: </Text>
        <Text>{item.scope}</Text>
      </Box>

      {item.homepage && (
        <Box marginBottom={1}>
          <Text color="gray">Homepage: </Text>
          <Text color="blue">{item.homepage}</Text>
        </Box>
      )}

      {/* Components */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Components:</Text>
        {item.skills && item.skills.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Skills: </Text>
            <Text color="cyan">{item.skills.join(", ")}</Text>
          </Box>
        )}
        {item.commands && item.commands.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Commands: </Text>
            <Text color="cyan">{item.commands.join(", ")}</Text>
          </Box>
        )}
        {item.agents && item.agents.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Agents: </Text>
            <Text color="cyan">{item.agents.join(", ")}</Text>
          </Box>
        )}
        {item.hooks && item.hooks.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Hooks: </Text>
            <Text color="cyan">{item.hooks.join(", ")}</Text>
          </Box>
        )}
        {item.hasMcp && (
          <Box marginLeft={1}>
            <Text color="gray">• MCP </Text>
            <Text color="green">✔</Text>
          </Box>
        )}
        {item.hasLsp && (
          <Box marginLeft={1}>
            <Text color="gray">• LSP </Text>
            <Text color="green">✔</Text>
          </Box>
        )}
      </Box>
    </>
  );
}

/** File/config/asset metadata: tools, source mapping. */
export function FileMetadata({ item }: { item: ManagedItem }) {
  const isScoped = item.tools && item.tools.length > 0;
  const toolScope = isScoped ? item.tools!.join(", ") : "All tools";

  return (
    <>
      <Box marginBottom={1}>
        <Text color="gray">Tools: </Text>
        <Text color={isScoped ? "magenta" : "blue"}>{toolScope}</Text>
      </Box>

      {item.fileSource && (
        <Box marginBottom={1}>
          <Text color="gray">Source: </Text>
          <Text>{item.fileSource} → {item.fileTarget || item.name}</Text>
        </Box>
      )}
    </>
  );
}

/** Pi package metadata: version, source type, contents. */
export function PiPackageMetadata({ item }: { item: ManagedItem }) {
  return (
    <>
      {item.version && (
        <Box marginBottom={1}>
          <Text color="gray">Version: </Text>
          <Text>{item.version}</Text>
          {item.installedVersion && item.installedVersion !== item.version && (
            <Text color="yellow"> (installed: {item.installedVersion})</Text>
          )}
        </Box>
      )}

      {item.sourceType && (
        <Box marginBottom={1}>
          <Text color="gray">Source: </Text>
          <Text>{item.sourceType === "npm" ? "npm" : item.sourceType}</Text>
        </Box>
      )}

      {item.author && (
        <Box marginBottom={1}>
          <Text color="gray">Author: </Text>
          <Text>{item.author}</Text>
        </Box>
      )}

      {/* Contents */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Contents:</Text>
        {item.extensions && item.extensions.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Extensions: </Text>
            <Text color="cyan">{item.extensions.join(", ")}</Text>
          </Box>
        )}
        {item.skills && item.skills.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Skills: </Text>
            <Text color="cyan">{item.skills.join(", ")}</Text>
          </Box>
        )}
        {item.prompts && item.prompts.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Prompts: </Text>
            <Text color="cyan">{item.prompts.join(", ")}</Text>
          </Box>
        )}
        {item.themes && item.themes.length > 0 && (
          <Box marginLeft={1}>
            <Text color="gray">• Themes: </Text>
            <Text color="cyan">{item.themes.join(", ")}</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
