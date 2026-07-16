import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface AddProjectModalProps {
  onSubmit: (path: string) => void;
  onCancel: () => void;
}

/** Minimal path-input modal for registering a project directory. */
export function AddProjectModal({ onSubmit, onCancel }: AddProjectModalProps) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Add project</Text>
      <Text color="gray">Enter a project directory; its .agents/skills is managed against the source repo.</Text>
      <Box marginTop={1}>
        <Text color="cyan">path ❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            const trimmed = v.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        />
      </Box>
      <Text color="gray">Enter to add · Esc to cancel</Text>
    </Box>
  );
}
