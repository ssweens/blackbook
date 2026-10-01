import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { parseDiffLines } from "../lib/diff-lines.js";
import {
  lockGitStatus,
  lockGitDiff,
  lockGitPull,
  lockGitPush,
  lockGitCommit,
  type LockGitStatus,
} from "../lib/lock-git.js";

const DIFF_HEIGHT = 12;

export interface LockDetailProps {
  /** Absolute path to the lock file (`skills-lock.json` or a profile lock). */
  filePath: string;
  /** Short label, e.g. "Music profile" or "web project". */
  label: string;
  /** Display path shown under the title. */
  displayPath: string;
  onClose: () => void;
}

type Action = "diff" | "pull" | "push" | "commit" | "back";

/**
 * Git detail for a skill-lock file: the same diff / pull / push moves the skill
 * views offer, over the file's real git state. Self-contained input (navigable
 * action rows + a scrollable inline diff), rendered as a detail overlay.
 */
export function LockDetail({ filePath, label, displayPath, onClose }: LockDetailProps) {
  const [status, setStatus] = useState<LockGitStatus | null>(null);
  const [diff, setDiff] = useState<string[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffScroll, setDiffScroll] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, d] = await Promise.all([lockGitStatus(filePath), lockGitDiff(filePath)]);
    setStatus(s);
    setDiff(parseDiffLines(d, 100));
  }, [filePath]);

  useEffect(() => { void reload(); }, [reload]);

  // Available actions depend on the file's git state.
  const actions: Action[] = ["diff"];
  if (status?.fileState !== "clean") actions.push("commit");
  if ((status?.ahead ?? 0) > 0 || status?.fileState !== "clean") actions.push("push");
  if ((status?.behind ?? 0) > 0 || status?.hasUpstream) actions.push("pull");
  actions.push("back");
  const clampedIndex = Math.min(index, actions.length - 1);
  const current = actions[clampedIndex];

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    setMessage(r.ok ? `✔ ${label} done` : `✗ ${label}: ${r.error ?? "failed"}`);
    await reload();
  };

  useInput((input, key) => {
    if (busy) return;
    if (showDiff) {
      const lines = diff ?? [];
      const maxScroll = Math.max(0, lines.length - DIFF_HEIGHT);
      if (key.escape || key.return) { setShowDiff(false); setDiffScroll(0); return; }
      if (key.upArrow) { setDiffScroll((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setDiffScroll((s) => Math.min(maxScroll, s + 1)); return; }
      if (key.pageUp) { setDiffScroll((s) => Math.max(0, s - DIFF_HEIGHT)); return; }
      if (key.pageDown) { setDiffScroll((s) => Math.min(maxScroll, s + DIFF_HEIGHT)); return; }
      return;
    }
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(actions.length - 1, i + 1)); return; }
    if (key.return) {
      if (current === "diff") { if ((diff?.length ?? 0) > 0) { setShowDiff(true); setDiffScroll(0); } else setMessage("No changes to diff"); }
      else if (current === "pull") void run("pull", () => lockGitPull(filePath));
      else if (current === "push") void run("push", () => lockGitPush(filePath));
      else if (current === "commit") void run("commit", () => lockGitCommit(filePath, `chore(skills): update ${label} skills-lock.json`));
      else if (current === "back") onClose();
    }
  });

  const actionLabel = (a: Action): string => {
    switch (a) {
      case "diff": return (diff?.length ?? 0) > 0 ? "View diff" : "View diff (no changes)";
      case "commit": return "Commit changes";
      case "push": return "Push to remote";
      case "pull": return "Pull from remote";
      case "back": return "Back";
    }
  };

  const statusLine = (): React.ReactNode => {
    if (!status) return <Text color="gray">Loading git status…</Text>;
    if (!status.isRepo) return <Text color="yellow">Not in a git repo — nothing to diff, pull, or push.</Text>;
    const parts: React.ReactNode[] = [<Text key="b" color="gray">{status.branch ?? "?"}</Text>];
    if (status.fileState === "modified") parts.push(<Text key="m" color="yellow"> · uncommitted changes</Text>);
    else if (status.fileState === "untracked") parts.push(<Text key="u" color="yellow"> · not yet tracked</Text>);
    else parts.push(<Text key="c" color="green"> · committed</Text>);
    if (status.ahead > 0) parts.push(<Text key="a" color="cyan"> · ↑{status.ahead} to push</Text>);
    if (status.behind > 0) parts.push(<Text key="be" color="magenta"> · ↓{status.behind} to pull</Text>);
    if (!status.hasUpstream) parts.push(<Text key="nu" color="gray"> · no upstream</Text>);
    return <Text wrap="truncate-end">{parts}</Text>;
  };

  const diffVisible = (diff ?? []).slice(diffScroll, diffScroll + DIFF_HEIGHT);

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="cyan">Lock · {label}</Text>
        {message ? <Text color="gray">   {message}</Text> : null}
      </Text>
      <Text color="gray" wrap="truncate-end">{displayPath}</Text>
      <Box marginTop={1}>{statusLine()}</Box>

      {busy ? (
        <Box marginTop={1}><Text color="cyan">⠋ {busy}…</Text></Box>
      ) : showDiff ? (
        <Box flexDirection="column" marginTop={1}>
          {diffVisible.map((line, i) => (
            <Text key={i} wrap="truncate-end" color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : line.startsWith("@@") ? "cyan" : "gray"}>
              {line || " "}
            </Text>
          ))}
          <Text color="gray">↑/↓ scroll · PgUp/PgDn · Enter/Esc close diff</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {actions.map((a, i) => (
            <Text key={a} wrap="truncate-end">
              <Text color={i === clampedIndex ? "cyan" : "gray"}>{i === clampedIndex ? "❯ " : "  "}</Text>
              <Text color={i === clampedIndex ? "white" : "gray"}>{actionLabel(a)}</Text>
            </Text>
          ))}
          <Text color="gray" wrap="truncate-end">↑/↓ navigate · Enter select · Esc back</Text>
        </Box>
      )}
    </Box>
  );
}
