import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ItemDetail, type ItemAction } from "./ItemDetail.js";
import type { ManagedItem } from "../lib/managed-item.js";
import type { LockEntry } from "../lib/skill-profiles.js";
import { agentSkillsDir, compareLockToInstall, lockInstallGap } from "../lib/lock-install-sync.js";
import { lockGitStatus, lockUpdateSourceRepo, type LockGitStatus } from "../lib/lock-git.js";
import { useStore, withSpinner } from "../lib/store.js";

/** A workspace that has this profile assigned, with its up-to-date state. */
export interface ProfileUsedBy {
  workspace: string;
  upToDate: boolean;
  /** e.g. "up to date" or "3 to apply, 1 drifted". */
  summary: string;
}

export interface ProfileDetailProps {
  /** Profile name. */
  name: string;
  /** The profile's lock skills (name -> entry). */
  lockSkills: Record<string, LockEntry>;
  /** Absolute path of the profile's lock file in the source repo (for "Save lock to source repo"). */
  lockPath: string;
  /** Source-repo skill index (name -> dir), used to detect drift exactly like the list hint does. */
  sourceIndex: Map<string, string>;
  /** Workspaces whose lock names this profile, with their status. */
  usedBy: ProfileUsedBy[];
  /** Apply (assign + install) to Global — runs the same spinner-wrapped store action `P` uses. */
  onApplyGlobal: () => Promise<unknown> | void;
  /** Open the workspace picker to apply to a project. */
  onApplyToProject: () => void;
  /** Open a single skill's detail (same detail the Installed tab shows). */
  onOpenSkillDetail: (skillName: string) => void;
  onClose: () => void;
}

/**
 * Detail for a profile, built to match the skill/namespace detail: the same
 * ItemDetail, a status line, "Used by" metadata, explicit apply targets as
 * action rows, a navigable row per skill with its install state, and — only
 * when the lock file itself has unsaved changes — "Save lock to source repo".
 * Every sync judgment uses the exact functions the Profiles list hint uses
 * (lockInstallGap / compareLockToInstall), so detail and list agree. Nothing
 * here blocks: applies run through the app's spinner notification.
 */
export function ProfileDetail({ name, lockSkills, lockPath, sourceIndex, usedBy, onApplyGlobal, onApplyToProject, onOpenSkillDetail, onClose }: ProfileDetailProps) {
  const [index, setIndex] = useState(0);
  // Bumped after an apply/save resolves so disk-derived state recomputes.
  const [refresh, setRefresh] = useState(0);
  const [git, setGit] = useState<LockGitStatus | null>(null);

  useEffect(() => { if (lockPath) void lockGitStatus(lockPath).then(setGit); }, [lockPath, refresh]);

  // Display state is the global install (~/.agents/skills) — exactly what the
  // Profiles list hint reports — computed with the same functions.
  void refresh;
  const installedDir = agentSkillsDir();
  const gap = lockInstallGap(lockSkills, installedDir, sourceIndex);
  const hint = compareLockToInstall(lockSkills, installedDir, sourceIndex);
  const missing = new Set(gap.missing);
  const drifted = new Set(gap.drifted);
  const skillNames = [...gap.all].sort();

  const statusLabel = hint.state === "empty"
    ? "Empty"
    : hint.state === "in-sync"
      ? "In sync (Global)"
      : `Out of sync (Global) · ${[hint.missing ? `${hint.missing} missing` : "", hint.drifted ? `${hint.drifted} drifted` : ""].filter(Boolean).join(", ")}`;

  const item: ManagedItem = {
    name,
    kind: "namespace",
    marketplace: "profile",
    description: "",
    installed: hint.state === "in-sync",
    incomplete: false,
    scope: "user",
    instances: [],
  };

  // The lock file has edits not yet saved to the source repo (uncommitted or unpushed).
  const lockUnsaved = !!git && git.isRepo && (git.fileState !== "clean" || git.ahead > 0);

  const actions: ItemAction[] = [];
  actions.push({ id: "status", label: name, type: "status", statusColor: hint.color, statusLabel });
  if (skillNames.length > 0) {
    actions.push({ id: "apply_global", label: "Apply to Global (~/.agents)", type: "sync" });
    actions.push({ id: "apply_project", label: "Apply to a project…", type: "install" });
  }
  for (const s of skillNames) {
    const state = missing.has(s) ? "missing" : drifted.has(s) ? "drifted" : "installed";
    actions.push({ id: `skill:${s}`, label: `${s}  (${state})`, type: "open_skill" });
  }
  if (lockUnsaved) actions.push({ id: "savelock", label: "Save lock to source repo", type: "pullback" });
  actions.push({ id: "back", label: "Back to list", type: "back" });

  const sel = Math.min(index, actions.length - 1);
  const current = actions[sel];

  useInput((_input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (!key.return) return;
    switch (current.id) {
      case "apply_global":
        void Promise.resolve(onApplyGlobal()).then(() => setRefresh((n) => n + 1));
        break;
      case "apply_project":
        onApplyToProject();
        break;
      case "savelock": {
        const { notify, clearNotification } = useStore.getState();
        void withSpinner(`Saving ${name} lock to source repo...`, () =>
          lockUpdateSourceRepo(lockPath, `chore(skills): update ${name} profile skills-lock.json`), notify, clearNotification,
        ).then((r) => {
          notify(r.ok ? `Saved ${name} lock to the source repo` : `Couldn't save ${name} lock: ${r.error ?? "failed"}`, r.ok ? "success" : "error");
          setRefresh((n) => n + 1);
        });
        break;
      }
      case "back":
        onClose();
        break;
      default:
        if (current.type === "open_skill") onOpenSkillDetail(current.id.replace(/^skill:/, ""));
    }
  });

  const metadata = (
    <Box marginBottom={1} flexDirection="column">
      <Text color="gray">Used by:</Text>
      {usedBy.length === 0 ? (
        <Text color="gray">  no workspace yet — apply it to one below</Text>
      ) : (
        usedBy.map((u) => (
          <Text key={u.workspace} wrap="truncate-end">
            {"  "}<Text color="cyan">{u.workspace}</Text>
            <Text color={u.upToDate ? "green" : "yellow"}>{"  "}{u.summary}</Text>
          </Text>
        ))
      )}
    </Box>
  );

  return <ItemDetail item={item} actions={actions} selectedAction={sel} metadata={metadata} />;
}
