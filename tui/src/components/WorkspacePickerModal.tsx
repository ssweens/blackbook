import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface WorkspaceTarget {
  /** Workspace path ($HOME for Global). */
  path: string;
  /** Display label. */
  label: string;
  /** The profile is already assigned to this workspace (named in its lock's `profiles` meta). */
  assigned: boolean;
}

interface WorkspacePickerModalProps {
  profileName: string;
  targets: WorkspaceTarget[];
  onApply: (workspacePath: string) => void;
  onUnassign: (workspacePath: string) => void;
  onCancel: () => void;
}

/**
 * Pick a workspace to apply a profile to — the mirror of ProfilePickerModal
 * (pick a profile for a workspace), styled identically. Applying assigns the
 * profile to that workspace and installs its skills; `d` unassigns without
 * touching installed skills.
 */
export function WorkspacePickerModal({ profileName, targets, onApply, onUnassign, onCancel }: WorkspacePickerModalProps) {
  const [index, setIndex] = useState(0);
  const sel = Math.min(index, Math.max(0, targets.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (targets.length === 0) return;
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(targets.length - 1, i + 1));
    else if (key.return) onApply(targets[sel].path);
    else if ((input === "d" || key.delete) && targets[sel].assigned) onUnassign(targets[sel].path);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Apply profile {profileName} to…</Text>
      {targets.length === 0 ? (
        <>
          <Text color="gray">No workspaces. Add a project on the Projects tab (a) first.</Text>
          <Text color="gray">Esc to close</Text>
        </>
      ) : (
        <>
          <Text color="gray">Installs the profile's skills into that workspace and marks it as using this profile:</Text>
          {targets.map((t, i) => (
            <Box key={t.path}>
              <Text color={i === sel ? "cyan" : "white"}>
                {i === sel ? "❯ " : "  "}
                {t.label}
              </Text>
              {t.assigned ? <Text color="green">{"  "}✓ assigned</Text> : null}
            </Box>
          ))}
          {/* `d` only does something on an assigned row, so only offer it there. */}
          <Text color="gray">↑/↓ select · Enter apply{targets[sel].assigned ? " · d unassign" : ""} · Esc cancel</Text>
        </>
      )}
    </Box>
  );
}
