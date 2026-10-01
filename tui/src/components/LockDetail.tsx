import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { DiffDetail } from "./DiffDetail.js";
import {
  lockGitStatus,
  buildLockDiffTarget,
  lockGitPull,
  lockGitPush,
  lockGitCommit,
  type LockGitStatus,
} from "../lib/lock-git.js";
import type { DiffTarget } from "../lib/types.js";

export interface LockDetailProps {
  /** Absolute path to the lock file (`skills-lock.json` or a profile lock). */
  filePath: string;
  /** Short label, e.g. "Music profile" or "web project". */
  label: string;
  /** Display path shown under the title. */
  displayPath: string;
  onClose: () => void;
}

type Action = "diff" | "save" | "pull" | "back";

/** Plain-language sync state, mirroring the skill detail's status line (no git jargon). */
function stateLine(s: LockGitStatus | null): { text: string; color: string } {
  if (!s) return { text: "Checking…", color: "gray" };
  if (!s.isRepo) return { text: "Not in a git repo — can't diff, save, or pull", color: "yellow" };
  if (s.fileState === "untracked") return { text: "New — not yet saved to the repo", color: "yellow" };
  if (s.fileState === "modified") return { text: "Local changes not saved", color: "yellow" };
  if (s.behind > 0 && s.ahead > 0) return { text: "Diverged from the repo — pull, then save", color: "magenta" };
  if (s.ahead > 0) return { text: "Saved locally, not pushed", color: "cyan" };
  if (s.behind > 0) return { text: "Behind the repo — pull to update", color: "magenta" };
  return { text: "In sync with the repo", color: "green" };
}

/**
 * Detail for a skill-lock file, built to feel like the skill detail: a plain
 * status line and navigable action rows, with "View diff" opening the very same
 * DiffDetail (source repo vs working tree) the skill views use — not a raw git
 * readout.
 */
export function LockDetail({ filePath, label, displayPath, onClose }: LockDetailProps) {
  // status and diff are set together so no render shows one updated without the
  // other (Ink doesn't batch separate setState calls, which raced "View diff").
  const [data, setData] = useState<{ status: LockGitStatus; diff: DiffTarget | null } | null>(null);
  const status = data?.status ?? null;
  const diff = data?.diff ?? null;
  const [showDiff, setShowDiff] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, d] = await Promise.all([lockGitStatus(filePath), buildLockDiffTarget(filePath, `${label} lock`)]);
    setData({ status: s, diff: d });
  }, [filePath, label]);

  useEffect(() => { void reload(); }, [reload]);

  const hasDiff = (diff?.files.length ?? 0) > 0;
  const dirty = status?.fileState !== "clean";

  const actions: Action[] = ["diff"];
  if (dirty || (status?.ahead ?? 0) > 0) actions.push("save");
  if ((status?.behind ?? 0) > 0 || (status?.hasUpstream && !dirty)) actions.push("pull");
  actions.push("back");
  const sel = Math.min(index, actions.length - 1);
  const current = actions[sel];

  const run = async (verb: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(verb);
    const r = await fn();
    setBusy(null);
    setMessage(r.ok ? `✓ ${verb}` : `✗ ${verb}: ${r.error ?? "failed"}`);
    await reload();
  };

  const save = async () => {
    // Commit local changes, then push. Matches the skills "capture to the repo" move.
    if (dirty) {
      const c = await lockGitCommit(filePath, `chore(skills): update ${label} skills-lock.json`);
      if (!c.ok) return c;
    }
    return lockGitPush(filePath);
  };

  useInput((input, key) => {
    if (busy || showDiff) return; // DiffDetail owns input while open
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (key.return) {
      if (current === "diff") { if (hasDiff) setShowDiff(true); else setMessage("In sync — nothing to diff"); }
      else if (current === "save") void run("Saved to the repo", save);
      else if (current === "pull") void run("Pulled from the repo", () => lockGitPull(filePath));
      else if (current === "back") onClose();
    }
  });

  // The diff renders through the shared DiffDetail — identical to the skill diff.
  if (showDiff && diff && diff.files[0]) {
    return (
      <DiffDetail
        file={diff.files[0]}
        title={`${label} lock`}
        instanceName="working tree"
        onBack={() => setShowDiff(false)}
      />
    );
  }

  const line = stateLine(status);
  const label_ = (a: Action): string => {
    switch (a) {
      case "diff": return hasDiff ? "View diff" : "View diff (in sync)";
      case "save": return "Save to the repo (commit + push)";
      case "pull": return "Pull from the repo";
      case "back": return "Back";
    }
  };

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="cyan">{label} lock</Text>
        {message ? <Text color="gray">   {message}</Text> : null}
      </Text>
      <Text color="gray" wrap="truncate-end">{displayPath}</Text>

      <Box marginTop={1}>
        <Text>Status: </Text>
        <Text color={line.color}>{line.text}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {busy ? (
          <Text color="cyan">⠋ {busy}…</Text>
        ) : (
          actions.map((a, i) => (
            <Text key={a} wrap="truncate-end">
              <Text color={i === sel ? "cyan" : "gray"}>{i === sel ? "❯ " : "  "}</Text>
              <Text color={i === sel ? "white" : "gray"}>{label_(a)}</Text>
            </Text>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">↑/↓ to navigate · Enter to select · Esc to back</Text>
      </Box>
    </Box>
  );
}
