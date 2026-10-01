import React, { useEffect, useState, useCallback } from "react";
import { useInput } from "ink";
import { ItemDetail, type ItemAction } from "./ItemDetail.js";
import { DiffDetail } from "./DiffDetail.js";
import {
  lockGitStatus,
  buildLockDiffTarget,
  lockInstallFromRepo,
  lockUpdateSourceRepo,
  type LockGitStatus,
} from "../lib/lock-git.js";
import type { ManagedItem } from "../lib/managed-item.js";
import type { DiffTarget, DiffInstanceSummary } from "../lib/types.js";

export interface LockDetailProps {
  /** Absolute path to the lock file (`skills-lock.json` or a profile lock). */
  filePath: string;
  /** Short label, e.g. "Music profile" or "web project". */
  label: string;
  /** Display path shown under the title. */
  displayPath: string;
  onClose: () => void;
}

/**
 * Status label for the lock, in the skill detail's vocabulary — "In sync" /
 * "Drifted" — never git jargon. The direction a status implies maps to the
 * same two actions a skill offers: "Install from source repo" (repo→disk) and
 * "Update source repo from disk" (disk→repo).
 */
function statusLabel(s: LockGitStatus | null): { label: string; color: ItemAction["statusColor"] } {
  if (!s) return { label: "Checking…", color: "gray" };
  if (!s.isRepo) return { label: "No source repo", color: "gray" };
  if (s.fileState === "untracked") return { label: "Not in source repo", color: "yellow" };
  if (s.fileState === "modified") return { label: "Drifted", color: "yellow" };
  if (s.behind > 0 && s.ahead > 0) return { label: "Diverged from source repo", color: "red" };
  if (s.ahead > 0) return { label: "Not pushed to source repo", color: "yellow" };
  if (s.behind > 0) return { label: "Behind source repo", color: "magenta" };
  return { label: "In sync", color: "green" };
}

/**
 * Detail for a skill-lock file. Renders through the very same ItemDetail and
 * DiffDetail the skill views use (no bespoke rows), with the skill's action
 * vocabulary — "source repo", both directions — so it is verbatim the skill
 * interface, one level up.
 */
export function LockDetail({ filePath, label, displayPath, onClose }: LockDetailProps) {
  // status + diff are set together so no render shows one updated without the
  // other (Ink doesn't batch separate setState calls).
  const [data, setData] = useState<{ status: LockGitStatus; diff: DiffTarget | null } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [status, diff] = await Promise.all([
      lockGitStatus(filePath),
      buildLockDiffTarget(filePath, `${label} lock`),
    ]);
    setData({ status, diff });
  }, [filePath, label]);

  useEffect(() => { void reload(); }, [reload]);

  const status = data?.status ?? null;
  const diff = data?.diff ?? null;
  const added = diff?.files.reduce((n, f) => n + f.linesAdded, 0) ?? 0;
  const removed = diff?.files.reduce((n, f) => n + f.linesRemoved, 0) ?? 0;
  const hasDiff = (diff?.files.length ?? 0) > 0 && (added > 0 || removed > 0);
  const { label: stateLabel, color } = statusLabel(status);

  // The lock as a ManagedItem (kind "file", like a standalone skill) so it
  // renders through ItemDetail unchanged.
  const item: ManagedItem = {
    name: `${label} lock`,
    kind: "file",
    marketplace: "source repo",
    description: displayPath,
    installed: !!status?.isRepo,
    incomplete: false,
    scope: "user",
    instances: [],
  };

  // Skill-style action list: a diff/status row first, then the two sync
  // directions, then back. Same ids/types the skill uses.
  const sourceInstance: DiffInstanceSummary = {
    toolId: "source", instanceId: "local", instanceName: "local",
    configDir: status?.repoRoot ?? "", totalAdded: added, totalRemoved: removed,
  };
  const canInstall = !!status && (status.fileState === "modified" || status.behind > 0);
  const canUpdate = !!status && (status.fileState !== "clean" || status.ahead > 0);

  const actions: ItemAction[] = [];
  actions.push({
    id: "status",
    label: `${label} lock`,
    type: hasDiff ? "diff" : "status",
    statusColor: color,
    statusLabel: stateLabel,
    instance: hasDiff ? sourceInstance : undefined,
  });
  if (canInstall) actions.push({ id: "install", label: "Install from source repo", type: "install" });
  if (canUpdate) actions.push({ id: "pullback", label: "Update source repo from disk", type: "pullback" });
  actions.push({ id: "back", label: "Back to list", type: "back" });

  const sel = Math.min(index, actions.length - 1);
  const current = actions[sel];

  const run = async (verb: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(verb);
    await fn();
    setBusy(null);
    await reload();
  };

  useInput((_input, key) => {
    if (busy || showDiff) return; // DiffDetail owns input while open
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (key.return) {
      switch (current.type) {
        case "diff": if (hasDiff) setShowDiff(true); break;
        case "install": void run("install", () => lockInstallFromRepo(filePath)); break;
        case "pullback": void run("update", () => lockUpdateSourceRepo(filePath, `chore(skills): update ${label} skills-lock.json`)); break;
        case "back": onClose(); break;
      }
    }
  });

  // Diff renders through the shared DiffDetail — identical to the skill diff.
  if (showDiff && diff && diff.files[0]) {
    return (
      <DiffDetail
        file={diff.files[0]}
        title={`${label} lock`}
        instanceName="local"
        onBack={() => setShowDiff(false)}
      />
    );
  }

  return <ItemDetail item={item} actions={actions} selectedAction={sel} />;
}
