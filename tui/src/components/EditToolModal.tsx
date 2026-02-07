import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
interface EditableTool {
  toolId: string;
  instanceId: string;
  name: string;
  configDir: string;
}

interface EditToolModalProps {
  tool: EditableTool | null;
  onSubmit: (toolId: string, instanceId: string, configDir: string) => void;
  onCancel: () => void;
}

export function EditToolModal({ tool, onSubmit, onCancel }: EditToolModalProps) {
  const [value, setValue] = useState(tool?.configDir ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(tool?.configDir ?? "");
    setError(null);
  }, [tool]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (!tool) {
        onCancel();
        return;
      }
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Config directory cannot be empty");
        return;
      }
      onSubmit(tool.toolId, tool.instanceId, trimmed);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Edit tool config</Text>
      </Box>

      {tool && (
        <Box marginBottom={1}>
        <Text color="gray">Tool: </Text>
        <Text>{tool.name}</Text>
        <Text color="gray"> ({tool.toolId}:{tool.instanceId})</Text>
      </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Config directory</Text>
      </Box>

      <Box marginBottom={1}>
        <TextInput value={value} onChange={setValue} />
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box>
        <Text color="gray" italic>Enter to save · Esc to cancel</Text>
      </Box>
    </Box>
  );
}
