import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { compareProfileNames } from "../lib/skill-profiles.js";

interface ProfilePickerModalProps {
  profiles: Record<string, string[]>;
  workspaceName: string;
  /** Profiles already assigned to this workspace (named in its lock's `profiles` meta). */
  assigned?: ReadonlySet<string>;
  onApply: (name: string) => void;
  /** Unassign a profile from this workspace without uninstalling its skills. */
  onUnassign?: (name: string) => void;
  onCancel: () => void;
}

/**
 * Pick a named profile (skill bundle) and apply it to a workspace. Applying
 * assigns the profile to the workspace and installs its skills; `d` unassigns.
 */
export function ProfilePickerModal({ profiles, workspaceName, assigned, onApply, onUnassign, onCancel }: ProfilePickerModalProps) {
  // Same order as the Profiles tab list.
  const names = Object.keys(profiles).sort(compareProfileNames);
  const [index, setIndex] = useState(0);
  const sel = Math.min(index, Math.max(0, names.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (names.length === 0) return;
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(names.length - 1, i + 1));
    else if (key.return) onApply(names[sel]);
    else if ((input === "d" || key.delete) && onUnassign && assigned?.has(names[sel])) onUnassign(names[sel]);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Apply profile to {workspaceName}</Text>
      {names.length === 0 ? (
        <>
          <Text color="gray">No profiles yet. Create one on the Profiles tab (n).</Text>
          <Text color="gray">Esc to close</Text>
        </>
      ) : (
        <>
          <Text color="gray">Installs the profile's skills into this workspace's .agents/skills and marks it as using the profile:</Text>
          {names.map((n, i) => (
            <Box key={n}>
              <Text color={i === sel ? "cyan" : "white"}>
                {i === sel ? "❯ " : "  "}
                {n}
              </Text>
              <Text color="gray">
                {"  "}({profiles[n].length} skill{profiles[n].length === 1 ? "" : "s"})
              </Text>
              {assigned?.has(n) ? <Text color="green">{"  "}✓ assigned</Text> : null}
            </Box>
          ))}
          <Text color="gray">↑/↓ select · Enter apply{onUnassign ? " · d unassign" : ""} · Esc cancel</Text>
        </>
      )}
    </Box>
  );
}
