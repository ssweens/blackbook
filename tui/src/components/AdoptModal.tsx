import React from "react";
import { Box, Text, useInput } from "ink";
import type { UnmanagedSkill } from "../lib/projects.js";

interface AdoptModalProps {
  skills: UnmanagedSkill[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirm sweep: adopt every unmanaged `.agents/skills` skill into the source repo. */
export function AdoptModal({ skills, onConfirm, onCancel }: AdoptModalProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (skills.length > 0 && (key.return || input === "a")) {
      onConfirm();
    }
  });

  const shown = skills.slice(0, 15);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Adopt unmanaged skills</Text>
      {skills.length === 0 ? (
        <>
          <Text color="gray">No unmanaged skills found — every `.agents/skills` skill is already in the source repo.</Text>
          <Text color="gray">Esc to close</Text>
        </>
      ) : (
        <>
          <Text color="gray">In a workspace `.agents/skills` but not your source repo — adopting copies them in and commits:</Text>
          {shown.map((s) => (
            <Box key={s.name}>
              <Text color="green">+ </Text>
              <Text color="white">{s.name}</Text>
              <Text color="gray">
                {"  "}(in {s.workspace})
              </Text>
            </Box>
          ))}
          {skills.length > shown.length && <Text color="gray">…and {skills.length - shown.length} more</Text>}
          <Text color="gray">
            Enter/a to adopt all {skills.length} · Esc to cancel
          </Text>
        </>
      )}
    </Box>
  );
}
