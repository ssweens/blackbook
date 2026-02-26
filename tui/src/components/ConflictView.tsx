import React from "react";
import { Box, Text } from "ink";
import type { FileInstanceStatus } from "../lib/types.js";

export type ConflictAction = "force-forward" | "force-pullback" | "skip";

interface ConflictViewProps {
  fileName: string;
  instance: FileInstanceStatus;
  selectedAction: ConflictAction;
  actions: ConflictAction[];
}

const ACTION_LABELS: Record<ConflictAction, string> = {
  "force-forward": "Force Forward (source → target)",
  "force-pullback": "Force Pullback (target → source)",
  skip: "Skip",
};

export function getConflictActions(): ConflictAction[] {
  return ["force-forward", "force-pullback", "skip"];
}

export function ConflictView({ fileName, instance, selectedAction, actions }: ConflictViewProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="red">Conflict: </Text>
        <Text color="white">{fileName}</Text>
        <Text color="gray"> · {instance.instanceName}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Both source and target have changed since the last sync.</Text>
      </Box>

      {instance.diff && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray" dimColor>
            {instance.diff.split("\n").slice(0, 20).join("\n")}
            {instance.diff.split("\n").length > 20 ? "\n..." : ""}
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {actions.map((action) => {
          const isSelected = action === selectedAction;
          return (
            <Box key={action}>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
                {ACTION_LABELS[action]}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
