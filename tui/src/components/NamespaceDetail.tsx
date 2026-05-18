/**
 * NamespaceDetail — expandable tree view for skill namespaces
 *
 * Renders a two-level expandable tree inside a fixed-height scrollable
 * viewport so that:
 *   - Ink never leaves ghost lines on expand/collapse (fixed height clears)
 *   - Long namespaces don't push the footer off-screen (windowing)
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { NamespaceGroup, StandaloneSkill, SkillInstallation } from "../lib/install.js";
import type { ItemAction } from "./ItemDetail.js";
import type { ManagedItem } from "../lib/managed-item.js";
import { getToolInstances } from "../lib/config.js";
import type { ToolInstance } from "../lib/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillNode {
  skill: StandaloneSkill;
  displayName: string;
  installations: SkillInstallation[];
  missingTools: ToolInstance[];
  status: "all-synced" | "has-drift" | "has-missing" | "not-installed" | "mixed";
  summary: string;
}

export interface TreeNode {
  type: "action" | "skill-header" | "skill-tool" | "separator";
  action?: ItemAction;
  skill?: StandaloneSkill;
  toolInfo?: { toolId: string; instanceId: string; instanceName: string; configDir: string };
  toolStatusLabel?: string;
  toolStatusColor?: string;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  key: string;
}

/** Fixed viewport height for the tree region. Keeps the footer always visible. */
const TREE_VIEWPORT = 28;

// ─────────────────────────────────────────────────────────────────────────────
// Build flat renderable rows from expanded/collapsed state
// ─────────────────────────────────────────────────────────────────────────────

export function buildSkillNodes(ns: NamespaceGroup): SkillNode[] {
  const allTools = getToolInstances().filter((t) => t.kind === "tool" && t.enabled && !!t.skillsSubdir);

  return ns.skills.map((skill) => {
    const displayName = skill.namespace ? `${skill.namespace}/${skill.name}` : skill.name;
    const installations = skill.installations;
    const installedKeys = new Set(installations.map((i) => `${i.toolId}:${i.instanceId}`));
    const missingTools = allTools.filter((t) => !installedKeys.has(`${t.toolId}:${t.instanceId}`));
    const hasDrift = installations.some((i) => i.drifted);

    let status: SkillNode["status"];
    if (installations.length === 0) {
      status = "not-installed";
    } else if (missingTools.length > 0 && hasDrift) {
      status = "mixed";
    } else if (missingTools.length > 0) {
      status = "has-missing";
    } else if (hasDrift) {
      status = "has-drift";
    } else {
      status = "all-synced";
    }

    const parts: string[] = [];
    if (installations.length > 0) parts.push(`${installations.length} tool${installations.length === 1 ? "" : "s"}`);
    if (missingTools.length > 0) parts.push(`${missingTools.length} missing`);
    if (hasDrift) parts.push("drifted");
    const summary = parts.length > 0 ? parts.join(", ") : "not installed";

    return { skill, displayName, installations, missingTools, status, summary };
  });
}

export function buildTreeNodes(
  ns: NamespaceGroup,
  skillNodes: SkillNode[],
  expandedSkills: Set<string>,
): TreeNode[] {
  const nodes: TreeNode[] = [];

  // ── Top-level namespace actions ──

  if (ns.missingCount > 0) {
    nodes.push({
      type: "action",
      action: {
        id: "sync_missing",
        label: `Sync all ${ns.missingCount} missing skill${ns.missingCount === 1 ? "" : "s"}`,
        type: "sync",
      },
      depth: 0,
      key: "sync_missing",
    });
  }

  if (ns.driftedCount > 0) {
    nodes.push({
      type: "action",
      action: {
        id: "resync_drifted",
        label: `Re-sync all ${ns.driftedCount} drifted skill${ns.driftedCount === 1 ? "" : "s"} (overwrites disk)`,
        type: "sync",
      },
      depth: 0,
      key: "resync_drifted",
    });
  }

  nodes.push({ type: "separator", depth: 0, key: "sep_skills_header" });

  // ── Skill rows (expandable) ──

  for (const sn of skillNodes) {
    const expanded = expandedSkills.has(sn.skill.name);

    const statusColor = sn.status === "all-synced" ? "green"
      : sn.status === "has-drift" ? "yellow"
      : sn.status === "not-installed" ? "gray"
      : sn.status === "mixed" ? "yellow"
      : "gray";

    nodes.push({
      type: "skill-header",
      skill: sn.skill,
      depth: 0,
      expandable: true,
      expanded,
      key: `skill_${sn.skill.name}`,
      action: {
        id: sn.skill.name,
        label: sn.displayName,
        type: "open_skill",
        statusColor: statusColor as "green" | "yellow" | "gray" | "red" | "magenta",
        statusLabel: sn.summary,
      },
    });

    if (expanded) {
      // Per-tool status rows (installed)
      for (const inst of sn.installations) {
        const isDrifted = inst.drifted === true;
        nodes.push({
          type: "skill-tool",
          skill: sn.skill,
          toolInfo: { toolId: inst.toolId, instanceId: inst.instanceId, instanceName: inst.instanceName, configDir: inst.diskPath },
          depth: 1,
          key: `skill_${sn.skill.name}_tool_${inst.toolId}_${inst.instanceId}`,
          toolStatusLabel: isDrifted ? "Drifted" : "Synced",
          toolStatusColor: isDrifted ? "yellow" : "green",
          action: {
            id: `status_${inst.toolId}_${inst.instanceId}`,
            label: inst.instanceName,
            type: "status",
            statusColor: isDrifted ? "yellow" : "green",
            statusLabel: isDrifted ? "Drifted" : "Synced",
          },
        });
      }

      // Missing tools
      for (const tool of sn.missingTools) {
        nodes.push({
          type: "skill-tool",
          skill: sn.skill,
          toolInfo: { toolId: tool.toolId, instanceId: tool.instanceId, instanceName: tool.name, configDir: tool.configDir },
          depth: 1,
          key: `skill_${sn.skill.name}_missing_${tool.toolId}_${tool.instanceId}`,
          toolStatusLabel: "Missing",
          toolStatusColor: "yellow",
          action: {
            id: `install_tool_${tool.toolId}_${tool.instanceId}`,
            label: tool.name,
            type: "install_tool",
            statusColor: "yellow" as const,
            statusLabel: "Missing",
            toolStatus: { toolId: tool.toolId, instanceId: tool.instanceId, name: tool.name, installed: false, enabled: true, supported: true },
          },
        });
      }

      // Per-skill actions
      const hasDrifted = sn.installations.some((i) => i.drifted);
      const hasMissing = sn.missingTools.length > 0;

      if (hasMissing) {
        for (const tool of sn.missingTools) {
          nodes.push({
            type: "action",
            action: {
              id: `install_tool_${sn.skill.name}_${tool.toolId}_${tool.instanceId}`,
              label: `Sync to ${tool.name}`,
              type: "install_tool",
              toolStatus: { toolId: tool.toolId, instanceId: tool.instanceId, name: tool.name, installed: false, enabled: true, supported: true },
            },
            skill: sn.skill,
            depth: 1,
            key: `action_sync_${sn.skill.name}_${tool.toolId}_${tool.instanceId}`,
          });
        }
      }

      if (hasDrifted) {
        for (const inst of sn.installations.filter((i) => i.drifted)) {
          nodes.push({
            type: "action",
            action: {
              id: `install_tool_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
              label: `Re-sync to ${inst.instanceName} (overwrites disk)`,
              type: "install_tool",
              toolStatus: { toolId: inst.toolId, instanceId: inst.instanceId, name: inst.instanceName, installed: true, enabled: true, supported: true },
            },
            skill: sn.skill,
            depth: 1,
            key: `action_resync_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
          });
        }
      }

      if (sn.skill.sourcePath) {
        for (const inst of sn.installations) {
          nodes.push({
            type: "action",
            action: {
              id: `pullback_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
              label: `Pull to source from ${inst.instanceName}${inst.drifted ? " (drifted)" : ""}`,
              type: "pullback",
              instance: { toolId: inst.toolId, instanceId: inst.instanceId, instanceName: inst.instanceName, configDir: inst.diskPath },
            },
            skill: sn.skill,
            depth: 1,
            key: `action_pullback_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
          });
        }
      } else if (sn.installations.length > 0) {
        const first = sn.installations[0];
        nodes.push({
          type: "action",
          action: {
            id: `pullback_${sn.skill.name}_${first.toolId}_${first.instanceId}`,
            label: "Track in source repo",
            type: "pullback",
            instance: { toolId: first.toolId, instanceId: first.instanceId, instanceName: first.instanceName, configDir: first.diskPath },
          },
          skill: sn.skill,
          depth: 1,
          key: `action_track_${sn.skill.name}`,
        });
      }

      for (const inst of sn.installations) {
        nodes.push({
          type: "action",
          action: {
            id: `uninstall_tool_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
            label: `Uninstall from ${inst.instanceName}`,
            type: "uninstall_tool",
            toolStatus: { toolId: inst.toolId, instanceId: inst.instanceId, name: inst.instanceName, installed: true, enabled: true, supported: true },
          },
          skill: sn.skill,
          depth: 1,
          key: `action_uninstall_${sn.skill.name}_${inst.toolId}_${inst.instanceId}`,
        });
      }

      if (sn.installations.length > 0) {
        nodes.push({
          type: "action",
          action: { id: `uninstall_${sn.skill.name}`, label: "Uninstall from all tools", type: "uninstall" },
          skill: sn.skill,
          depth: 1,
          key: `action_uninstall_all_${sn.skill.name}`,
        });
      }

      const srcFragment = sn.skill.sourcePath ? " + source repo" : "";
      nodes.push({
        type: "action",
        action: {
          id: `delete_everywhere_${sn.skill.name}`,
          label: `🗑  Delete everywhere (all tools${srcFragment})`,
          type: "delete_everywhere",
          statusColor: "red",
        },
        skill: sn.skill,
        depth: 1,
        key: `action_delete_${sn.skill.name}`,
      });
    }
  }

  // ── Namespace-level bulk actions ──

  nodes.push({ type: "separator", depth: 0, key: "sep_namespace_actions" });

  // Per-tool sync: install missing + resync drifted for each tool instance
  const allTools = getToolInstances().filter((t) => t.kind === "tool" && t.enabled && !!t.skillsSubdir);
  for (const tool of allTools) {
    const missingInTool = ns.skills.filter((s) => !s.installations.some((i) => i.toolId === tool.toolId && i.instanceId === tool.instanceId));
    const driftedInTool = ns.skills.filter((s) => s.installations.some((i) => i.toolId === tool.toolId && i.instanceId === tool.instanceId && i.drifted));
    const total = missingInTool.length + driftedInTool.length;
    if (total > 0) {
      const parts: string[] = [];
      if (missingInTool.length > 0) parts.push(`${missingInTool.length} missing`);
      if (driftedInTool.length > 0) parts.push(`${driftedInTool.length} drifted`);
      nodes.push({
        type: "action",
        action: {
          id: `sync_ns_${tool.toolId}_${tool.instanceId}`,
          label: `Sync all to ${tool.name} (${parts.join(", ")})`,
          type: "install_tool",
          toolStatus: { toolId: tool.toolId, instanceId: tool.instanceId, name: tool.name, installed: true, enabled: true, supported: true },
        },
        depth: 0,
        key: `ns_sync_${tool.toolId}_${tool.instanceId}`,
      });
    }
  }

  // Per-tool pullback: pull all skills back to source from each tool instance
  for (const tool of allTools) {
    const installed = ns.skills.filter((s) => s.installations.some((i) => i.toolId === tool.toolId && i.instanceId === tool.instanceId));
    if (installed.length > 0) {
      nodes.push({
        type: "action",
        action: {
          id: `pullback_ns_${tool.toolId}_${tool.instanceId}`,
          label: `Pull all to source from ${tool.name}`,
          type: "pullback",
          instance: { toolId: tool.toolId, instanceId: tool.instanceId, instanceName: tool.name, configDir: tool.configDir },
        },
        depth: 0,
        key: `ns_pullback_${tool.toolId}_${tool.instanceId}`,
      });
    }
  }

  // Track all not-in-git skills
  if (ns.notInGitCount > 0) {
    nodes.push({
      type: "action",
      action: { id: "track_all", label: `Track ${ns.notInGitCount} not-in-git skills in source repo`, type: "track" },
      depth: 0,
      key: "ns_track_all",
    });
  }

  // Per-tool uninstall — one row per unique (toolId, instanceId) pair
  const installedInstanceKeys = new Set<string>();
  for (const skill of ns.skills) {
    for (const inst of skill.installations) {
      installedInstanceKeys.add(`${inst.toolId}:${inst.instanceId}`);
    }
  }
  for (const key of installedInstanceKeys) {
    const [toolId, instanceId] = key.split(":");
    const installedCount = ns.skills.filter((s) =>
      s.installations.some((i) => i.toolId === toolId && i.instanceId === instanceId),
    ).length;
    if (installedCount > 0) {
      const instanceName =
        ns.skills.flatMap((s) => s.installations).find((i) => i.toolId === toolId && i.instanceId === instanceId)?.instanceName ?? toolId;
      nodes.push({
        type: "action",
        action: {
          id: `uninstall_ns_${toolId}_${instanceId}`,
          label: `Uninstall all ${installedCount} skills from ${instanceName}`,
          type: "uninstall_tool",
          instance: { toolId, instanceId, instanceName, configDir: "" },
        },
        depth: 0,
        key: `ns_uninstall_${toolId}_${instanceId}`,
      });
    }
  }

  const anyInstalled = ns.skills.some((s) => s.installations.length > 0);
  if (anyInstalled) {
    nodes.push({
      type: "action",
      action: { id: "uninstall_all", label: "Uninstall all skills from all tools", type: "uninstall" },
      depth: 0,
      key: "ns_uninstall_all",
    });
  }

  nodes.push({
    type: "action",
    action: { id: "back", label: "Back to list", type: "back" },
    depth: 0,
    key: "back",
  });

  nodes.push({
    type: "action",
    action: {
      id: "delete_everywhere",
      label: `🗑  Delete all ${ns.skills.length} skills in ${ns.name}`,
      type: "delete_everywhere",
      statusColor: "red",
    },
    depth: 0,
    key: "ns_delete_everywhere",
  });

  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewport windowing — only render visible rows inside the fixed-height box
// ─────────────────────────────────────────────────────────────────────────────

function getVisibleRange(totalNodes: number, cursor: number, viewport: number): { start: number; end: number; contentViewport: number } {
  if (totalNodes <= viewport) return { start: 0, end: totalNodes, contentViewport: viewport };
  // Reserve 1 line for "↑ N more above" and 1 for "↓ N more below"
  const contentViewport = viewport - 2;
  const pad = 2;
  let start = Math.max(0, cursor - pad);
  let end = start + contentViewport;
  if (end > totalNodes) {
    end = totalNodes;
    start = Math.max(0, end - contentViewport);
  }
  return { start, end, contentViewport };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface NamespaceDetailProps {
  item: ManagedItem;
  selectedAction: number;
  expandedSkills: Set<string>;
}

export function NamespaceDetail({ item, selectedAction, expandedSkills }: NamespaceDetailProps) {
  const ns = item._namespace;
  if (!ns) return null;

  const skillNodes = useMemo(() => buildSkillNodes(ns), [ns]);
  const nodes = useMemo(() => buildTreeNodes(ns, skillNodes, expandedSkills), [ns, skillNodes, expandedSkills]);

  // Windowing: only render the visible slice
  const { start, end, contentViewport } = getVisibleRange(nodes.length, selectedAction, TREE_VIEWPORT);
  const visibleNodes = nodes.slice(start, end);

  const hasAbove = start > 0;
  const hasBelow = end < nodes.length;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold>{item.name}</Text>
        <Text color="gray"> ({ns.skills.length} skills)</Text>
      </Box>

      {/* Status */}
      <Box>
        <Text color="gray">Tools: </Text>
        <Text color="magenta">{ns.toolIds.join(", ")}</Text>
        {ns.missingCount > 0 && <Text color="yellow"> · {ns.missingCount} missing</Text>}
        {ns.driftedCount > 0 && <Text color="yellow"> · {ns.driftedCount} drifted</Text>}
        {ns.notInGitCount > 0 && <Text color="red"> · {ns.notInGitCount} not in git</Text>}
      </Box>

      {/* Tree with scrollable viewport */}
      <Box flexDirection="column" marginTop={1}>
        {hasAbove && <Text color="gray">{"  ↑ "}{start}{" more above"}</Text>}
        {visibleNodes.map((node, vi) => {
          const globalIdx = start + vi;
          return (
            <TreeRow
              key={node.key}
              node={node}
              isSelected={globalIdx === selectedAction}
            />
          );
        })}
        {hasBelow && <Text color="gray">{"  ↓ "}{nodes.length - end}{" more below"}</Text>}
      </Box>

      {/* Footer */}
      <Box>
        <Text color="gray">→/Enter expand · ← collapse · Esc back{nodes.length > TREE_VIEWPORT ? " · ↑↓ scroll" : ""}</Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree Row Renderer
// ─────────────────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: TreeNode;
  isSelected: boolean;
}

function TreeRow({ node, isSelected }: TreeRowProps) {
  const indent = "  ".repeat(node.depth);
  const cursor = isSelected ? "❯ " : "  ";
  const selColor = isSelected ? "cyan" : "gray";

  if (node.type === "separator") {
    return <Text color="gray">{indent}──</Text>;
  }

  if (node.type === "skill-header") {
    const arrow = node.expanded ? "▼" : "▶";
    const action = node.action!;
    return (
      <Box>
        <Text color={selColor}>{cursor}{indent}</Text>
        <Text color={isSelected ? "white" : "gray"}>{arrow} </Text>
        <Text bold={isSelected} color={isSelected ? "white" : "gray"}>{action.label}</Text>
        <Text color={action.statusColor || "gray"}> {action.statusLabel}</Text>
      </Box>
    );
  }

  if (node.type === "skill-tool") {
    const action = node.action!;
    return (
      <Box>
        <Text color={selColor}>{cursor}{indent}</Text>
        <Text color={selColor}>  └─ </Text>
        <Text color={isSelected ? "white" : "gray"}>{action.label}: </Text>
        <Text color={(node.toolStatusColor as "green" | "yellow" | "gray" | "red") || "gray"}>{node.toolStatusLabel}</Text>
      </Box>
    );
  }

  if (node.type === "action" && node.action) {
    const action = node.action;
    const color = getActionColor(action.type);
    return (
      <Box>
        <Text color={selColor}>{cursor}{indent}</Text>
        <Text bold={isSelected} color={isSelected ? color : "gray"}>{action.label}</Text>
      </Box>
    );
  }

  return null;
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
    case "pullback":
    case "track":
      return "cyan";
    case "delete_everywhere":
      return "red";
    default:
      return "white";
  }
}
