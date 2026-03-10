import React, { useMemo } from "react";
import { Box, Text } from "ink";
import fg from "fast-glob";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FileStatus, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { buildFileDiffTarget } from "../lib/diff.js";
import { loadConfig as loadYamlConfig } from "../lib/config/loader.js";
import { expandPath } from "../lib/config/path.js";

export interface FileAction {
  label: string;
  type: "diff" | "missing" | "sync" | "pullback" | "back" | "status";
  instance?: DiffInstanceSummary | DiffInstanceRef;
  statusColor?: "green" | "yellow" | "gray" | "red" | "magenta";
  statusLabel?: string;
}

interface FileDetailProps {
  file: FileStatus;
  selectedAction: number;
  actions: FileAction[];
}

function summarizeFileStatus(file: FileStatus): { label: string; color: string; drifted: boolean } {
  const failed = file.instances.filter((i) => i.status === "failed").length;
  const missing = file.instances.filter((i) => i.status === "missing").length;
  const drifted = file.instances.filter((i) => i.status === "drifted").length;

  if (failed > 0) return { label: `Failed (${failed})`, color: "red", drifted: false };
  if (missing > 0) return { label: missing === 1 ? "Not synced" : `Not synced (${missing})`, color: "yellow", drifted: false };
  if (drifted > 0) return { label: "Synced", color: "green", drifted: true };
  return { label: "Synced", color: "green", drifted: false };
}

export function FileDetail({ file, selectedAction, actions }: FileDetailProps) {
  const overall = summarizeFileStatus(file);
  const isScoped = file.tools && file.tools.length > 0;
  const toolScope = isScoped ? file.tools!.join(", ") : "All tools";

  const repoPath = useMemo(() => {
    const { config } = loadYamlConfig();
    return config.settings.source_repo ? expandPath(config.settings.source_repo) : null;
  }, []);

  const sourceDisplay = useMemo(() => {
    return file.source;
  }, [file.source]);

  const sourceMappingDisplay = useMemo(() => `${sourceDisplay} → ${file.target}`, [sourceDisplay, file.target]);

  const sourceFilesCount = useMemo(() => {
    const sourcePath = file.instances[0]?.sourcePath;
    if (!sourcePath) return null;
    if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) return null;

    try {
      if (/[*?\[{]/.test(sourcePath)) {
        const matches = fg.sync(sourcePath, {
          onlyFiles: true,
          dot: true,
          unique: true,
          followSymbolicLinks: true,
        });
        return matches.length;
      }

      if (!existsSync(sourcePath)) return 0;
      const stat = statSync(sourcePath);
      if (stat.isFile()) return 1;
      if (stat.isDirectory()) {
        const matches = fg.sync(join(sourcePath, "**/*"), {
          onlyFiles: true,
          dot: true,
          unique: true,
          followSymbolicLinks: true,
        });
        return matches.length;
      }
      return 0;
    } catch {
      return null;
    }
  }, [file.instances]);

  const sourceExists = useMemo(() => (sourceFilesCount == null ? true : sourceFilesCount > 0), [sourceFilesCount]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{file.name}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Tools: </Text>
        <Text color={isScoped ? "magenta" : "blue"}>{toolScope}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source repo: </Text>
        <Text>{repoPath || "(not configured)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source: </Text>
        <Text>{sourceMappingDisplay}</Text>
      </Box>

      {sourceFilesCount != null && (
        <Box marginBottom={1}>
          <Text color="gray">Files: </Text>
          <Text>{`${sourceFilesCount} file(s)`}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={overall.color}>{overall.label}</Text>
        {overall.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {!sourceExists && (
        <Box marginBottom={1}>
          <Text color="yellow">Source empty — use p to pull from an instance</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Instances:</Text>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;

          if (action.type === "diff" || action.type === "missing" || action.type === "status") {
            const inst = file.instances.find(
              (fi) => fi.instanceName === action.label
            );
            return (
              <Box key={action.label} flexDirection="column">
                <Box>
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
                {isSelected && inst && (
                  <Box marginLeft={4}>
                    <Text color="gray">{inst.targetPath}</Text>
                  </Box>
                )}
              </Box>
            );
          }

          let color = "white";
          if (action.type === "sync") color = "green";
          if (action.type === "pullback") color = "cyan";

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
        <Text color="gray">
          {actions.some((a) => a.type === "pullback") ? "p pull to source · " : ""}Esc back
        </Text>
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

      let statusLabel = "Source changed";
      let statusColor: "yellow" | "magenta" | "red" = "yellow";
      if (inst.driftKind === "target-changed") {
        statusLabel = "Target changed";
        statusColor = "magenta";
      } else if (inst.driftKind === "both-changed") {
        statusLabel = "Both changed";
        statusColor = "red";
      }

      actions.push({
        label: inst.instanceName,
        type: "diff",
        instance: summary,
        statusColor,
        statusLabel,
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
    actions.push({ label: "Sync to tool", type: "sync" });
  }

  const drifted = file.instances.filter((i) => i.status === "drifted");

  if (drifted.length > 0) {
    for (const inst of drifted) {
      actions.push({
        label: `Pull to source from ${inst.instanceName}`,
        type: "pullback",
        instance: {
          toolId: inst.toolId,
          instanceId: inst.instanceId,
          instanceName: inst.instanceName,
          configDir: inst.configDir,
        },
      });
    }
  } else {
    // Source doesn't exist / no drift information — still allow pulling from any enabled instance.
    for (const inst of file.instances) {
      actions.push({
        label: `Pull to source from ${inst.instanceName}`,
        type: "pullback",
        instance: {
          toolId: inst.toolId,
          instanceId: inst.instanceId,
          instanceName: inst.instanceName,
          configDir: inst.configDir,
        },
      });
    }
  }

  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
