import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ProfilePickerModalProps {
  profiles: Record<string, string[]>;
  workspaceName: string;
  onApply: (name: string) => void;
  onCancel: () => void;
}

/** Pick a named profile (skill bundle) and apply it to a workspace. */
export function ProfilePickerModal({ profiles, workspaceName, onApply, onCancel }: ProfilePickerModalProps) {
  const names = Object.keys(profiles).sort();
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (names.length === 0) return;
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(names.length - 1, i + 1));
    else if (key.return) onApply(names[Math.min(index, names.length - 1)]);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Apply profile to {workspaceName}</Text>
      {names.length === 0 ? (
        <>
          <Text color="gray">No profiles defined. Add a `profiles:` map to config.yaml (name → skill names).</Text>
          <Text color="gray">Esc to close</Text>
        </>
      ) : (
        <>
          <Text color="gray">Pushes the profile's skills into this workspace's .agents/skills:</Text>
          {names.map((n, i) => (
            <Box key={n}>
              <Text color={i === index ? "cyan" : "white"}>
                {i === index ? "❯ " : "  "}
                {n}
              </Text>
              <Text color="gray">
                {"  "}({profiles[n].length} skill{profiles[n].length === 1 ? "" : "s"})
              </Text>
            </Box>
          ))}
          <Text color="gray">↑/↓ select · Enter apply · Esc cancel</Text>
        </>
      )}
    </Box>
  );
}
