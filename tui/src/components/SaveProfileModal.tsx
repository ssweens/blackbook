import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface SaveProfileModalProps {
  workspaceName: string;
  skillCount: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Name prompt for saving a workspace's skills lock as a profile. */
export function SaveProfileModal({ workspaceName, skillCount, onSubmit, onCancel }: SaveProfileModalProps) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Save {workspaceName}'s skills lock as a profile</Text>
      <Text color="gray">
        {skillCount} skill{skillCount === 1 ? "" : "s"} → &lt;source repo&gt;/profiles/&lt;name&gt;.skills-lock.json. Existing profiles are never overwritten.
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">name ❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            const trimmed = v.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        />
      </Box>
      <Text color="gray">Enter to save · Esc to cancel</Text>
    </Box>
  );
}
