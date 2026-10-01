import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { ItemDetail, type ItemAction } from "./ItemDetail.js";
import type { ManagedItem } from "../lib/managed-item.js";
import type { LockEntry } from "../lib/skill-profiles.js";
import { agentSkillsDir, compareLockToInstall, lockInstallGap } from "../lib/lock-install-sync.js";
import { lockGitStatus, lockUpdateSourceRepo, type LockGitStatus } from "../lib/lock-git.js";

/** A place a profile's skills can be installed. */
export interface InstallTargetOption {
  /** Workspace path ($HOME for Global). */
  path: string;
  /** Display label. */
  label: string;
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
  /** Targets to offer when installing (Global first, then registered projects). */
  targets: InstallTargetOption[];
  /** Install the profile into the chosen workspace — the SAME action `P` apply runs. */
  onInstall: (targetWorkspace: string) => Promise<boolean> | boolean;
  /** Open a single skill's detail (same detail the Installed tab shows). */
  onOpenSkillDetail: (skillName: string) => void;
  onClose: () => void;
}

/**
 * Detail for a profile, built to match the skill/namespace detail: the same
 * ItemDetail, a status line and a navigable row per skill with its install
 * state, "Install skills…" which asks where and actually installs, and —
 * only when the lock file itself has unsaved changes — "Save lock to source
 * repo". Every sync judgment here uses the exact functions the Profiles list
 * hint uses (lockInstallGap / compareLockToInstall), so detail and list agree.
 */
export function ProfileDetail({ name, lockSkills, lockPath, sourceIndex, targets, onInstall, onOpenSkillDetail, onClose }: ProfileDetailProps) {
  const [mode, setMode] = useState<"list" | "pick">("list");
  const [index, setIndex] = useState(0);
  const [pickIndex, setPickIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped after install/save so disk-derived state recomputes.
  const [refresh, setRefresh] = useState(0);
  const [git, setGit] = useState<LockGitStatus | null>(null);

  useEffect(() => { void lockGitStatus(lockPath).then(setGit); }, [lockPath, refresh]);

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
      ? "In sync"
      : `Out of sync · ${[hint.missing ? `${hint.missing} missing` : "", hint.drifted ? `${hint.drifted} drifted` : ""].filter(Boolean).join(", ")}`;

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
  if (skillNames.length > 0) actions.push({ id: "install", label: "Install skills…", type: "sync" });
  for (const s of skillNames) {
    const state = missing.has(s) ? "missing" : drifted.has(s) ? "drifted" : "installed";
    actions.push({ id: `skill:${s}`, label: `${s}  (${state})`, type: "open_skill" });
  }
  if (lockUnsaved) actions.push({ id: "savelock", label: "Save lock to source repo", type: "pullback" });
  actions.push({ id: "back", label: "Back to list", type: "back" });

  const sel = Math.min(index, actions.length - 1);
  const current = actions[sel];

  const runBusy = (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    void fn().finally(() => { setBusy(null); setMode("list"); setRefresh((n) => n + 1); });
  };

  useInput((_input, key) => {
    if (busy) return;
    if (mode === "pick") {
      if (key.escape) { setMode("list"); return; }
      if (key.upArrow) { setPickIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setPickIndex((i) => Math.min(targets.length - 1, i + 1)); return; }
      if (key.return) {
        const target = targets[Math.min(pickIndex, targets.length - 1)];
        if (!target) { setMode("list"); return; }
        runBusy("Installing…", () => Promise.resolve(onInstall(target.path)));
      }
      return;
    }
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (key.return) {
      if (current.id === "install") { setPickIndex(0); setMode("pick"); }
      else if (current.id === "savelock") runBusy("Saving lock to source repo…", () => lockUpdateSourceRepo(lockPath, `chore(skills): update ${name} profile skills-lock.json`));
      else if (current.type === "open_skill") onOpenSkillDetail(current.id.replace(/^skill:/, ""));
      else if (current.type === "back") onClose();
    }
  });

  if (busy) return <Box flexDirection="column"><Text color="cyan">⠋ {busy}</Text></Box>;

  if (mode === "pick") {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{name}</Text>
        <Box marginTop={1}><Text>Install the profile's skills where?</Text></Box>
        <Box flexDirection="column" marginTop={1}>
          {targets.map((t, i) => (
            <Text key={t.path} wrap="truncate-end">
              <Text color={i === pickIndex ? "cyan" : "gray"}>{i === pickIndex ? "❯ " : "  "}</Text>
              <Text color={i === pickIndex ? "white" : "gray"}>{t.label}</Text>
            </Text>
          ))}
        </Box>
        <Box marginTop={1}><Text color="gray">↑/↓ to navigate · Enter to install · Esc to back</Text></Box>
      </Box>
    );
  }

  return <ItemDetail item={item} actions={actions} selectedAction={sel} />;
}
