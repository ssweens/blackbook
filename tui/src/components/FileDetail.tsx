import React from "react";
import { Box, Text } from "ink";
import type { FileStatus, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { buildFileDiffTarget } from "../lib/diff.js";

export interface FileAction {
  label: string;
  type: "diff" | "missing" | "sync" | "back" | "status";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

interface FileDetailProps {
  file: FileStatus;
  selectedAction: number;
  actions: FileAction[];
}

function summarizeFileStatus(file: FileStatus): { label: string; color: string } {
  const failed = file.instances.filter((i) => i.status === "failed").length;
  const missing = file.instances.filter((i) => i.status === "missing").length;
  const drifted = file.instances.filter((i) => i.status === "drifted").length;

  if (failed > 0) return { label: `Failed (${failed})`, color: "red" };
  if (missing > 0) return { label: `Missing (${missing})`, color: "yellow" };
  if (drifted > 0) return { label: `Drifted (${drifted})`, color: "yellow" };
  return { label: "In Sync", color: "green" };
}

export function FileDetail({ file, selectedAction, actions }: FileDetailProps) {
  const overall = summarizeFileStatus(file);
  const kindLabel = file.tools && file.tools.length > 0 ? "config" : "asset";

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{file.name}</Text>
        <Text color="gray"> · {kindLabel}</Text>
        {file.pullback && <Text color="magenta"> · pullback</Text>}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source: </Text>
        <Text color="cyan">{file.source}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Target: </Text>
        <Text>{file.target}</Text>
      </Box>

      <Box marginBottom={1}>
        {file.tools && file.tools.length > 0 ? (
          <>
            <Text color="gray">Tool: </Text>
            <Text color="magenta">{file.tools.join(", ")}</Text>
          </>
        ) : (
          <>
            <Text color="gray">Tools: </Text>
            <Text>(all syncable tools)</Text>
          </>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={overall.color}>{overall.label}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Instances:</Text>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;

          if (action.type === "diff" || action.type === "missing" || action.type === "status") {
            return (
              <Box key={action.label}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color={isSelected ? "white" : "gray"}>{action.label}:</Text>
                <Text color={action.statusColor || "gray"}> {action.statusLabel}</Text>
                {action.type === "diff" && action.instance && "totalAdded" in action.instance && (
                  <>
                    <Text color="green"> +{action.instance.totalAdded}</Text>
                    <Text color="red"> -{action.instance.totalRemoved}</Text>
                  </>
                )}
                {action.type === "missing" && <Text color="yellow"> (click to view)</Text>}
              </Box>
            );
          }

          let color = "white";
          if (action.type === "sync") color = "green";

          return (
            <Box key={action.label} marginTop={action.type === "sync" ? 1 : 0}>
              <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {action.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Esc back</Text>
      </Box>
    </Box>
  );
}

export function getFileActions(file: FileStatus): FileAction[] {
  const actions: FileAction[] = [];

  for (const inst of file.instances) {
    const instance: DiffInstanceRef = {
      toolId: inst.toolId,
      instanceId: inst.instanceId,
      instanceName: inst.instanceName,
      configDir: inst.configDir,
    };

    if (inst.status === "drifted") {
      const diffTarget = buildFileDiffTarget(
        file.name,
        inst.targetRelPath,
        inst.sourcePath,
        inst.targetPath,
        instance,
      );
      const totalAdded = diffTarget.files.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalRemoved = diffTarget.files.reduce((sum, f) => sum + f.linesRemoved, 0);
      const summary: DiffInstanceSummary = { ...instance, totalAdded, totalRemoved };
      actions.push({
        label: inst.instanceName,
        type: "diff",
        instance: summary,
        statusColor: "yellow",
        statusLabel: "Drifted",
      });
      continue;
    }

    if (inst.status === "missing") {
      actions.push({
        label: inst.instanceName,
        type: "missing",
        instance,
        statusColor: "yellow",
        statusLabel: "Missing",
      });
      continue;
    }

    if (inst.status === "failed") {
      actions.push({
        label: inst.instanceName,
        type: "status",
        statusColor: "red",
        statusLabel: "Failed",
      });
      continue;
    }

    actions.push({
      label: inst.instanceName,
      type: "status",
      statusColor: "green",
      statusLabel: "Synced",
    });
  }

  const needsSync = file.instances.some(
    (i) => i.status === "missing" || i.status === "drifted",
  );
  if (needsSync) {
    actions.push({ label: "Sync to all tools", type: "sync" });
  }
  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
