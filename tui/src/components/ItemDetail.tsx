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
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ManagedItem, ItemInstanceStatus } from "../lib/managed-item.js";
import type { DiffInstanceSummary, DiffInstanceRef } from "../lib/types.js";
import { formatSourcePath } from "../lib/source-presentation.js";

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
    | "delete_everywhere"
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
        {item.marketplace && item.marketplace !== "local" && (
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
            ((action.instance as DiffInstanceSummary).totalAdded > 0 || (action.instance as DiffInstanceSummary).totalRemoved > 0) ? (
              <>
                <Text color="green"> +{(action.instance as DiffInstanceSummary).totalAdded}</Text>
                <Text color="red"> -{(action.instance as DiffInstanceSummary).totalRemoved}</Text>
              </>
            ) : null
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
  const gitStatus = item._file?.gitStatus;

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

      {gitStatus && (
        <Box marginBottom={1}>
          <Text color="gray">Git: </Text>
          {gitStatus === "clean" && <Text color="green">✓ clean (committed)</Text>}
          {gitStatus === "modified" && <Text color="yellow">✎ modified (uncommitted changes)</Text>}
          {gitStatus === "untracked" && <Text color="red">⚠ untracked (not yet added to git)</Text>}
          {gitStatus === "unknown" && <Text color="gray" dimColor>unknown</Text>}
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

// ---------------------------------------------------------------------------
// Skill metadata
// ---------------------------------------------------------------------------

/** Parse the top-level frontmatter from a SKILL.md file. Returns name/description if present. */
function parseSkillFrontmatter(skillDir: string): { description?: string; version?: string; author?: string } {
  const path = join(skillDir, "SKILL.md");
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf-8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end < 0) return {};
    const block = content.slice(3, end).trim();
    const result: { description?: string; version?: string; author?: string } = {};
    for (const raw of block.split(/\r?\n/)) {
      const m = raw.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      let value = m[2].trim();
      // Strip surrounding quotes
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      // Unescape doubled single-quotes (YAML)
      value = value.replace(/''/g, "'");
      if (key === "description") result.description = value;
      else if (key === "version") result.version = value;
      else if (key === "author") result.author = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Build a compact top-level tree for a skill.
 * Only shows top-level entries (no nested children) so the metadata fits
 * in the terminal without scrolling the title off-screen.
 */
function buildSkillTree(root: string, maxEntries = 8): string[] {
  const lines: string[] = [];
  if (!existsSync(root)) return lines;
  try {
    const top = readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const entry of top.slice(0, maxEntries)) {
      lines.push(entry.isDirectory() ? `📁 ${entry.name}/` : `📄 ${entry.name}`);
    }
    if (top.length > maxEntries) lines.push(`… (+${top.length - maxEntries} more)`);
  } catch { /* skip */ }
  return lines;
}

/** Skill metadata: SKILL.md description + tools where installed + file tree.
 *  Compact-layout to ensure title and key info stay on-screen for big skills. */
export function SkillMetadata({ item }: { item: ManagedItem }) {
  // Prefer source-repo path (works even when skill isn't installed anywhere yet);
  // fall back to the first disk installation when source isn't tracked.
  const skillPath = item._skill?.sourcePath ?? item.instances[0]?.sourcePath ?? "";
  const fm = parseSkillFrontmatter(skillPath);
  const tree = buildSkillTree(skillPath);
  const isScoped = item.tools && item.tools.length > 0;
  const isInstalledAnywhere = item.instances.length > 0;
  const toolScope = !isInstalledAnywhere
    ? "(none yet)"
    : isScoped
      ? item.tools!.join(", ")
      : "All tools";
  const skill = item._skill;

  // Truncate long descriptions so the title/source/git rows stay visible.
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
  const description = fm.description ? truncate(fm.description, 240) : "";

  return (
    <>
      {description && (
        <Box marginBottom={1} flexDirection="column">
          <Text color="gray">Description:</Text>
          <Text>{description}</Text>
        </Box>
      )}

      {(fm.version || fm.author) && (
        <Box marginBottom={1}>
          {fm.version && (<><Text color="gray">Version: </Text><Text>{fm.version}</Text></>)}
          {fm.version && fm.author && <Text color="gray">  ·  </Text>}
          {fm.author && (<><Text color="gray">Author: </Text><Text>{fm.author}</Text></>)}
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Tools: </Text>
        <Text color={isScoped ? "magenta" : "blue"}>{toolScope}</Text>
      </Box>

      {skill?.sourcePath ? (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color="gray">Source: </Text>
            <Text color={skill.drifted ? "yellow" : "green"}>{formatSourcePath(skill.sourcePath)}</Text>
          </Box>
          <Box marginLeft={1}>
            <Text color="gray">Layout: </Text>
            {skill.sourceLayout === "canonical" && (
              <Text color="green">✓ canonical</Text>
            )}
            {skill.sourceLayout === "legacy-plugin" && (
              <Text color="yellow">⚠ legacy plugin-wrapped</Text>
            )}
          </Box>
          <Box marginLeft={1}>
            <Text color="gray">Git: </Text>
            {skill.gitStatus === "clean" && (
              <Text color="green">✓ clean (committed)</Text>
            )}
            {skill.gitStatus === "modified" && (
              <Text color="yellow">✎ modified (uncommitted changes)</Text>
            )}
            {skill.gitStatus === "untracked" && (
              <Text color="red">⚠ untracked (not yet added to git)</Text>
            )}
            {(!skill.gitStatus || skill.gitStatus === "unknown") && (
              <Text color="gray" dimColor>unknown (source repo isn't a git repo?)</Text>
            )}
          </Box>
          {skill.drifted && (
            <Box marginLeft={1}>
              <Text color="yellow">⚠  Drifted from source — use "Pull to source" to keep disk, or bulk Sync tab to overwrite disk</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="gray">Source: </Text>
          <Text color="gray" dimColor>(not tracked in source repo)</Text>
        </Box>
      )}

      {item.instances.length > 0 ? (
        <Box marginBottom={1} flexDirection="column">
          <Text color="gray">Installed at ({item.instances.length} tool{item.instances.length === 1 ? "" : "s"}):</Text>
          {item.instances.slice(0, 4).map((inst) => (
            <Box key={`${inst.toolId}:${inst.instanceId}`} marginLeft={1}>
              <Text color="cyan">{inst.toolId}</Text>
              <Text color="gray"> → {inst.sourcePath}</Text>
            </Box>
          ))}
          {item.instances.length > 4 && (
            <Box marginLeft={1}>
              <Text color="gray" dimColor>… (+{item.instances.length - 4} more)</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="gray">Installed: </Text>
          <Text color="yellow" dimColor>not installed on any tool yet — use "Sync to …" actions below</Text>
        </Box>
      )}

      {tree.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>Contents:</Text>
          {tree.map((line, idx) => (
            <Text key={idx} color="gray">  {line}</Text>
          ))}
        </Box>
      )}
    </>
  );
}
