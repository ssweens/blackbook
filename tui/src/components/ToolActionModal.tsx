import React from "react";
import { Box, Text } from "ink";

export type ToolModalAction = "install" | "update" | "uninstall";

interface ToolActionModalProps {
  toolName: string;
  action: ToolModalAction;
  command: string;
  warning?: string | null;
  preferredPackageManager?: string;
  migrateSelected?: boolean;
  inProgress: boolean;
  done: boolean;
  success: boolean;
  output: string[];
}

function actionLabel(action: ToolModalAction): string {
  if (action === "install") return "Install";
  if (action === "update") return "Update";
  return "Uninstall";
}

export function ToolActionModal({
  toolName,
  action,
  command,
  warning,
  preferredPackageManager,
  migrateSelected,
  inProgress,
  done,
  success,
  output,
}: ToolActionModalProps) {
  const heading = `${actionLabel(action)} ${toolName}`;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>{heading}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Command: </Text>
        <Text>{command}</Text>
      </Box>

      {!inProgress && !done && (
        <>
          {warning && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="yellow">⚠ {warning}</Text>
              <Text color="cyan">
                [{migrateSelected ? "x" : " "}] Migrate to preferred install tool: {preferredPackageManager || "(configured)"} (press m)
              </Text>
            </Box>
          )}

          {action === "uninstall" && (
            <Box marginBottom={1}>
              <Text color="yellow">⚠ Config directory will NOT be removed.</Text>
            </Box>
          )}

          <Text color="gray">Enter to confirm · Esc to cancel</Text>
        </>
      )}

      {inProgress && (
        <>
          <Box marginBottom={1}>
            <Text color="cyan">Running... (Esc to cancel)</Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            {output.slice(-10).map((line, idx) => (
              <Text key={`${idx}-${line}`} color="gray">
                {line}
              </Text>
            ))}
          </Box>
        </>
      )}

      {done && (
        <>
          <Box marginBottom={1}>
            <Text color={success ? "green" : "red"}>
              {success ? `✓ ${actionLabel(action)} completed` : `✗ ${actionLabel(action)} failed`}
            </Text>
          </Box>
          {!success && warning && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="yellow">⚠ {warning}</Text>
              <Text color="cyan">
                [{migrateSelected ? "x" : " "}] Migrate to preferred install tool: {preferredPackageManager || "(configured)"} (press m)
              </Text>
            </Box>
          )}
          <Box flexDirection="column" marginBottom={1}>
            {output.slice(-10).map((line, idx) => (
              <Text key={`${idx}-${line}`} color="gray">
                {line}
              </Text>
            ))}
          </Box>
          <Text color="gray">{success ? "Press any key to close" : warning ? "Enter to retry · m toggle migration · Esc (or any other key) to close" : "Enter to retry · Esc (or any other key) to close"}</Text>
        </>
      )}
    </Box>
  );
}
