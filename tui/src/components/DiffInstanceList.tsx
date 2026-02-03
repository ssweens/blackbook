import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DiffInstanceRef } from "../lib/types.js";

interface DiffInstanceListProps {
  title: string;
  instances: DiffInstanceRef[];
  onSelect: (instance: DiffInstanceRef) => void;
  onClose: () => void;
}

export function DiffInstanceList({ title, instances, onSelect, onClose }: DiffInstanceListProps) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelected((i) => Math.min(instances.length - 1, i + 1));
    } else if (key.return) {
      const instance = instances[selected];
      if (instance) {
        onSelect(instance);
      }
    } else if (key.escape) {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Diff View · {title}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Select instance to compare:</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {instances.map((instance, i) => (
          <Box key={`${instance.toolId}:${instance.instanceId}`}>
            <Text color={i === selected ? "cyan" : "white"}>
              {i === selected ? "❯ " : "  "}
              {instance.instanceName}
            </Text>
            <Text color="gray"> ({instance.configDir})</Text>
          </Box>
        ))}
      </Box>

      <Box>
        <Text color="gray">↑/↓ navigate · Enter select · Esc back</Text>
      </Box>
    </Box>
  );
}
