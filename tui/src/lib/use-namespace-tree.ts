import React, { useCallback, useMemo, useState } from "react";
import { type Key } from "ink";
import { useStore, withSpinner } from "./store.js";
import { buildSkillDiffTarget } from "./diff.js";
import { buildTreeNodes, buildSkillNodes, type TreeNode } from "../components/NamespaceDetail.js";
import {
  installSkillToInstance,
  uninstallSkillAllInstances,
  uninstallSkillFromInstance,
  pullbackSkillToSource,
  deleteSkillEverywhere,
  removeSkillLocalInstalls,
  deleteSkillSourceOnly,
  groupSkillsByNamespace,
  syncNamespaceToAllMissing,
  resyncNamespaceDrifted,
  deleteNamespaceEverywhere,
  removeNamespaceLocalInstalls,
  deleteNamespaceSourceOnly,
  uninstallNamespaceAll,
  uninstallNamespaceFromInstance,
  pullbackNamespaceToSource,
  type StandaloneSkill,
  type NamespaceGroup,
} from "./install.js";
import type { DetailArtifact } from "./types.js";

interface UseNamespaceTreeArgs {
  detail: DetailArtifact | null;
  detailNamespace: NamespaceGroup | null;
  setDetail: (d: DetailArtifact | null) => void;
  actionIndex: number;
  setActionIndex: React.Dispatch<React.SetStateAction<number>>;
  openSkillDetail: (skill: StandaloneSkill) => void;
}

/**
 * Namespace-tree state + navigation + actions.
 *
 * Owns `expandedSkills`, builds the expandable tree nodes, handles the tree-specific
 * key navigation (left/right expand-collapse, cursor movement, Enter dispatch), and
 * executes per-skill and namespace-level operations via `handleNamespaceTreeAction`.
 *
 * Also owns `closeDetail` (reset cursor + collapse tree), which the rest of App uses
 * when tearing down any detail view — colocated here because it resets tree state.
 *
 * Pure relocation of code previously inline in App.tsx — behavior is unchanged.
 * NOTE: `handleNamespaceTreeAction` intentionally still duplicates the mutation logic
 * that the item-detail callbacks implement (rather than routing through handleItemAction);
 * it has different refresh semantics (a single loadInstalledPlugins + refreshDetailNamespace
 * at the end) so it is preserved verbatim to keep behavior identical.
 */
export function useNamespaceTree({
  detail,
  detailNamespace,
  setDetail,
  actionIndex,
  setActionIndex,
  openSkillDetail,
}: UseNamespaceTreeArgs) {
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());

  const closeDetail = () => { setActionIndex(0); setExpandedSkills(new Set()); };

  // Namespace tree nodes — used for expandable tree rendering and cursor bounds
  const namespaceTreeNodes = useMemo((): TreeNode[] => {
    if (detail?.kind !== "namespace" || !detailNamespace) return [];
    const skillNodes = buildSkillNodes(detailNamespace);
    return buildTreeNodes(detailNamespace, skillNodes, expandedSkills);
  }, [detail, detailNamespace, expandedSkills]);

  // Clamp actionIndex when namespace tree nodes change (expand/collapse changes node count)
  React.useEffect(() => {
    if (detail?.kind === "namespace" && namespaceTreeNodes.length > 0) {
      setActionIndex((i) => Math.min(i, namespaceTreeNodes.length - 1));
    }
  }, [namespaceTreeNodes.length, detail?.kind]);

  const refreshDetailNamespace = useCallback(() => {
    const state = useStore.getState();
    if (detail?.kind !== "namespace" || !detailNamespace) return;

    const freshSkills = state.standaloneSkills;
    const updated = groupSkillsByNamespace(freshSkills).find((n) => n.name === detailNamespace.name);
    if (updated) {
      setDetail({ kind: "namespace", data: updated });
    } else {
      // Namespace no longer exists (fully deleted)
      if (detail?.kind === "namespace") setDetail(null);
      closeDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, detailNamespace, setDetail]);

  // Handle actions from the namespace tree — routes per-skill and namespace-level ops
  const handleNamespaceTreeAction = async (node: TreeNode) => {
    const action = node.action;
    const skill = node.skill;
    if (!action) return;

    const store = useStore.getState();

    // Skill-level actions need the StandaloneSkill object
    if (skill && node.depth > 0) {
      switch (action.type) {
        case "install_tool": {
          const ts = action.toolStatus;
          if (ts) {
            await withSpinner(
              `Syncing ${skill.name} to ${ts.name}...`,
              async () => { installSkillToInstance(skill, ts.toolId, ts.instanceId); },
              store.notify, store.clearNotification,
            );
          }
          break;
        }
        case "uninstall_tool": {
          const ts = action.toolStatus;
          if (ts) {
            await withSpinner(
              `Uninstalling ${skill.name} from ${ts.name}...`,
              async () => { uninstallSkillFromInstance(skill, ts.toolId, ts.instanceId); },
              store.notify, store.clearNotification,
            );
          }
          break;
        }
        case "uninstall": {
          await withSpinner(
            `Uninstalling ${skill.name} from all tools...`,
            async () => { uninstallSkillAllInstances(skill); },
            store.notify, store.clearNotification,
          );
          break;
        }
        case "pullback": {
          const inst = action.instance;
          if (inst) {
            await withSpinner(
              `Pulling ${skill.name} to source...`,
              async () => {
                const ok = pullbackSkillToSource(skill, inst.toolId, inst.instanceId);
                if (!ok) {
                  store.notify(`Failed to pull ${skill.name} to source repo`, "error");
                }
              },
              store.notify, store.clearNotification,
            );
          }
          break;
        }
        case "delete_everywhere": {
          await withSpinner(
            `Deleting ${skill.name} everywhere...`,
            async () => { deleteSkillEverywhere(skill); },
            store.notify, store.clearNotification,
          );
          break;
        }
        case "delete_source": {
          await withSpinner(
            `Deleting ${skill.name} from source repo...`,
            async () => { deleteSkillSourceOnly(skill); },
            store.notify, store.clearNotification,
          );
          break;
        }
      }
      await useStore.getState().loadInstalledPlugins({ silent: true });
      refreshDetailNamespace();
      return;
    }

    // Namespace-level actions (depth 0)
    const ns = detailNamespace;
    if (!ns) return;
    switch (action.type) {
      case "sync": {
        if (action.id === "sync_missing") {
          await withSpinner(
            `Syncing missing skills in ${ns.name}...`,
            async () => { syncNamespaceToAllMissing(ns); },
            store.notify, store.clearNotification,
          );
        } else {
          await withSpinner(
            `Re-syncing drifted skills in ${ns.name}...`,
            async () => { resyncNamespaceDrifted(ns); },
            store.notify, store.clearNotification,
          );
        }
        break;
      }
      case "install_tool": {
        // Per-tool namespace sync — install missing + resync drifted for one tool
        const ts = action.toolStatus;
        if (ts) {
          await withSpinner(
            `Syncing ${ns.name} to ${ts.name}...`,
            async () => {
              // Use fresh skills from store (not the stale ns closure)
              const freshSkills = useStore.getState().standaloneSkills.filter(
                (s) => s.namespace === ns.name
              );
              for (const skill of freshSkills) {
                const isInstalled = skill.installations.some(
                  (i) => i.toolId === ts.toolId && i.instanceId === ts.instanceId
                );
                if (!isInstalled) {
                  installSkillToInstance(skill, ts.toolId, ts.instanceId);
                }
              }
              // Re-sync drifted
              for (const skill of freshSkills) {
                const inst = skill.installations.find(
                  (i) => i.toolId === ts.toolId && i.instanceId === ts.instanceId && i.drifted
                );
                if (inst) {
                  installSkillToInstance(skill, ts.toolId, ts.instanceId);
                }
              }
            },
            store.notify, store.clearNotification,
          );
        }
        break;
      }
      case "pullback": {
        // Per-tool namespace pullback — pull all skills from one tool to source
        const inst = action.instance;
        if (inst) {
          await withSpinner(
            `Pulling ${ns.name} to source from ${inst.instanceName}...`,
            async () => {
              const result = pullbackNamespaceToSource(ns, inst.toolId, inst.instanceId);
              const parts: string[] = [`${result.pulled} pulled back`];
              if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
              store.notify(`Pulled ${ns.name}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
            },
            store.notify, store.clearNotification,
          );
        }
        break;
      }
      case "track": {
        // Bulk track all not-in-git skills
        const notInGit = ns.skills.filter((s) => !s.sourcePath && s.installations.length > 0);
        if (notInGit.length > 0) {
          let tracked = 0;
          let failed = 0;
          await withSpinner(
            `Tracking ${notInGit.length} skills in source repo...`,
            async () => {
              for (const skill of notInGit) {
                const first = skill.installations[0];
                const ok = pullbackSkillToSource(skill, first.toolId, first.instanceId);
                if (ok) {
                  tracked += 1;
                } else {
                  failed += 1;
                }
              }
            },
            store.notify, store.clearNotification,
          );
          const msg = tracked > 0 ? `Tracked ${tracked} skill${tracked === 1 ? "" : "s"} in source repo` : "No skills tracked";
          store.notify(msg + (failed > 0 ? ` (${failed} failed)` : ""), failed > 0 ? "warning" : "info");
        }
        break;
      }
      case "uninstall_tool": {
        const inst = action.instance;
        if (inst) {
          await withSpinner(
            `Uninstalling ${ns.name} from ${inst.instanceName}...`,
            async () => { uninstallNamespaceFromInstance(ns, inst.toolId, inst.instanceId); },
            store.notify, store.clearNotification,
          );
        }
        break;
      }
      case "uninstall": {
        await withSpinner(
          `Uninstalling all skills in ${ns.name}...`,
          async () => {
            const result = uninstallNamespaceAll(ns);
            const parts: string[] = [`${result.uninstalled} uninstalled`];
            if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
            store.notify(`Uninstalled ${ns.name}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
          },
          store.notify, store.clearNotification,
        );
        break;
      }
      case "back": {
        if (detail?.kind === "namespace") setDetail(null);
        closeDetail();
        return;
      }
      case "delete_everywhere": {
        await withSpinner(
          `Deleting all skills in ${ns.name}...`,
          async () => {
            const result = deleteNamespaceEverywhere(ns);
            const parts: string[] = [`${result.deleted} skills deleted`];
            if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
            store.notify(`Deleted ${ns.name}: ${parts.join(", ")}`, result.errors.length > 0 ? "warning" : "info");
          },
          store.notify, store.clearNotification,
        );
        if (detail?.kind === "namespace") setDetail(null);
        closeDetail();
        return;
      }
      case "delete_source": {
        await withSpinner(
          `Deleting all ${ns.name} skills from source repo...`,
          async () => {
            const result = deleteNamespaceSourceOnly(ns);
            const parts: string[] = [`${result.deleted} deleted`];
            if (result.errors.length > 0) parts.push(`${result.errors.length} errors`);
            store.notify(`Deleted ${ns.name} from source: ${parts.join(", ")} (uncommitted — review & commit manually)`, result.errors.length > 0 ? "warning" : "info");
          },
          store.notify, store.clearNotification,
        );
        if (detail?.kind === "namespace") setDetail(null);
        closeDetail();
        return;
      }
    }
    await useStore.getState().loadInstalledPlugins({ silent: true });
    refreshDetailNamespace();
  };

  /**
   * Namespace tree key handling. Returns true when the tree owns this keypress (i.e.
   * a namespace detail is open with tree nodes) — including keys it deliberately
   * swallows so they don't fall through to the generic detail-input handler.
   */
  const handleNamespaceTreeInput = (input: string, key: Key): boolean => {
    if (!(detail?.kind === "namespace" && namespaceTreeNodes.length > 0)) return false;

    const node = namespaceTreeNodes[actionIndex];
    if (node) {
      // Enter on skill-header: open the skill detail (identical to standalone skill view)
      if (key.return && node.type === "skill-header") {
        if (node.skill) {
          openSkillDetail(node.skill);
        }
        return true;
      }
      // Right arrow on collapsed skill-header: expand
      if (key.rightArrow && node.type === "skill-header" && !node.expanded) {
        const skillName = node.skill!.name;
        setExpandedSkills((prev) => {
          const next = new Set(prev);
          next.add(skillName);
          return next;
        });
        return true;
      }
      // Right arrow on expanded skill-header: move cursor to first child
      if (key.rightArrow && node.type === "skill-header" && node.expanded) {
        const childIdx = actionIndex + 1;
        if (childIdx < namespaceTreeNodes.length) setActionIndex(childIdx);
        return true;
      }
      if (key.leftArrow && node.type === "skill-header" && node.expanded) {
        setExpandedSkills((prev) => { const next = new Set(prev); next.delete(node.skill!.name); return next; });
        return true;
      }
      if (key.leftArrow && node.type === "skill-tool") {
        // Jump to parent skill-header
        const parentIdx = namespaceTreeNodes.findIndex((n, i) => i < actionIndex && n.type === "skill-header" && n.skill?.name === node.skill?.name);
        if (parentIdx >= 0) setActionIndex(parentIdx);
        return true;
      }
      // Enter on action nodes: dispatch
      if (key.return && node.type === "action" && node.action) {
        void handleNamespaceTreeAction(node);
        return true;
      }
      // Enter on skill-tool status rows: open diff if drifted, else no-op
      if (key.return && node.type === "skill-tool" && node.skill && node.toolInfo) {
        if (node.toolStatusLabel === "Drifted") {
          const diffTarget = buildSkillDiffTarget(node.skill, node.toolInfo.toolId, node.toolInfo.instanceId);
          if (diffTarget) useStore.setState({ diffTarget });
          else useStore.getState().notify("Skill has no source repo path to diff against.", "warning");
        }
        return true;
      }
    }
    // Up/down for namespace tree
    if (key.upArrow) {
      setActionIndex((i) => Math.max(0, i - 1));
      return true;
    }
    if (key.downArrow) {
      setActionIndex((i) => Math.min(namespaceTreeNodes.length - 1, i + 1));
      return true;
    }
    // Don't fall through to handleDetailInput
    return true;
  };

  return {
    expandedSkills,
    setExpandedSkills,
    closeDetail,
    namespaceTreeNodes,
    refreshDetailNamespace,
    handleNamespaceTreeAction,
    handleNamespaceTreeInput,
  };
}
