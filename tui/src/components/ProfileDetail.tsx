import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ItemDetail, type ItemAction } from "./ItemDetail.js";
import type { ManagedItem } from "../lib/managed-item.js";
import type { LockEntry } from "../lib/skill-profiles.js";

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
  /** Targets to offer when installing (Global first, then registered projects). */
  targets: InstallTargetOption[];
  /** Install the profile's skills into the chosen workspace (reconciles disk to the lock). */
  onInstall: (targetWorkspace: string) => Promise<boolean> | boolean;
  /** Open a single skill's detail (same detail the Installed tab shows). */
  onOpenSkillDetail: (skillName: string) => void;
  onClose: () => void;
}

const GLOBAL_SKILLS_DIR = join(homedir(), ".agents", "skills");

/**
 * Detail for a profile, built to match the skill/namespace detail: the same
 * ItemDetail, a status line and navigable rows for each skill with its install
 * state, plus "Install skills…" which asks where to install and actually
 * installs them (reconciling the agent skills directory to the profile) — not a
 * git view of the lock file.
 */
export function ProfileDetail({ name, lockSkills, targets, onInstall, onOpenSkillDetail, onClose }: ProfileDetailProps) {
  const [mode, setMode] = useState<"list" | "pick">("list");
  const [index, setIndex] = useState(0);
  const [pickIndex, setPickIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // Bumped after an install so the presence check (existsSync) re-runs.
  const [refresh, setRefresh] = useState(0);

  const skillNames = Object.keys(lockSkills).sort();
  // Display state is the global install (~/.agents/skills) — what "in sync" on
  // the Profiles list means. Install can still target any workspace.
  const installedGlobally = (skill: string): boolean => existsSync(join(GLOBAL_SKILLS_DIR, skill));
  const missing = skillNames.filter((s) => !installedGlobally(s));
  void refresh; // referenced so the memo of `missing` recomputes after install

  const item: ManagedItem = {
    name,
    kind: "namespace",
    marketplace: "profile",
    description: "",
    installed: missing.length === 0 && skillNames.length > 0,
    incomplete: false,
    scope: "user",
    instances: [],
  };

  const actions: ItemAction[] = [];
  actions.push({
    id: "status",
    label: name,
    type: "status",
    statusColor: skillNames.length === 0 ? "gray" : missing.length === 0 ? "green" : "red",
    statusLabel: skillNames.length === 0
      ? "Empty"
      : missing.length === 0
        ? "In sync (global)"
        : `Out of sync · ${missing.length} of ${skillNames.length} not installed (global)`,
  });
  if (skillNames.length > 0) {
    actions.push({ id: "install", label: "Install skills…", type: "sync" });
  }
  for (const s of skillNames) {
    actions.push({
      id: `skill:${s}`,
      label: `${s}  (${installedGlobally(s) ? "installed" : "missing"})`,
      type: "open_skill",
    });
  }
  actions.push({ id: "back", label: "Back to list", type: "back" });

  const sel = Math.min(index, actions.length - 1);
  const current = actions[sel];

  useInput((_input, key) => {
    if (busy) return;
    if (mode === "pick") {
      if (key.escape) { setMode("list"); return; }
      if (key.upArrow) { setPickIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setPickIndex((i) => Math.min(targets.length - 1, i + 1)); return; }
      if (key.return) {
        const target = targets[Math.min(pickIndex, targets.length - 1)];
        if (!target) { setMode("list"); return; }
        setBusy(true);
        void Promise.resolve(onInstall(target.path)).then(() => {
          setBusy(false);
          setMode("list");
          setRefresh((n) => n + 1);
        });
      }
      return;
    }
    // list mode
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (key.return) {
      if (current.type === "sync") { setPickIndex(0); setMode("pick"); }
      else if (current.type === "open_skill") onOpenSkillDetail(current.id.replace(/^skill:/, ""));
      else if (current.type === "back") onClose();
    }
  });

  if (busy) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">⠋ Installing…</Text>
      </Box>
    );
  }

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
