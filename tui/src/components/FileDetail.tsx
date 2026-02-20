import React, { useMemo } from "react";
import { Box, Text } from "ink";
import fg from "fast-glob";
import { join } from "node:path";
import type { FileStatus, DiffInstanceRef, DiffInstanceSummary } from "../lib/types.js";
import { buildFileDiffTarget } from "../lib/diff.js";
import { getAssetsRepoPath, getConfigRepoPath } from "../lib/config.js";

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
  const isConfig = Boolean(file.tools && file.tools.length > 0);
  const kindLabel = isConfig ? "config" : "asset";

  const repoPath = useMemo(() => (isConfig ? getConfigRepoPath() : getAssetsRepoPath()), [isConfig]);

  const sourceDisplay = useMemo(() => {
    const prefix = isConfig ? "config/" : "assets/";
    return file.source.startsWith(prefix) ? file.source.slice(prefix.length) : file.source;
  }, [file.source, isConfig]);

  const sourceMappingDisplay = useMemo(() => `${sourceDisplay} → ${file.target}`, [sourceDisplay, file.target]);

  const sourceFilesCount = useMemo(() => {
    if (!repoPath) return null;
    try {
      const matches = fg.sync(join(repoPath, file.source), {
        onlyFiles: true,
        dot: true,
        unique: true,
        followSymbolicLinks: true,
      });
      return matches.length;
    } catch {
      return null;
    }
  }, [repoPath, file.source]);

  const sourceExists = useMemo(() => (sourceFilesCount == null ? true : sourceFilesCount > 0), [sourceFilesCount]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{file.name}</Text>
        <Text color="gray"> · {kindLabel}</Text>
      </Box>

      {isConfig && (
        <Box marginBottom={1}>
          <Text color="gray">Tool: </Text>
          <Text color="magenta">{file.tools!.join(", ")}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">{isConfig ? "Config repo" : "Assets repo"}: </Text>
        <Text>{repoPath || "(not configured)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">{isConfig ? "Source(s)" : "Source"}: </Text>
        <Text>{isConfig ? sourceMappingDisplay : sourceDisplay}</Text>
      </Box>

      {isConfig && (
        <Box marginBottom={1}>
          <Text color="gray">Files: </Text>
          <Text>{sourceFilesCount == null ? "(unknown)" : `${sourceFilesCount} file(s)`}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={overall.color}>{overall.label}</Text>
        {overall.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {isConfig && !sourceExists && (
        <Box marginBottom={1}>
          <Text color="yellow">Source empty — use p to pull from an instance</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text bold>{isConfig ? "Tools:" : "Instances:"}</Text>
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
    actions.push({ label: "Sync to tool", type: "sync" });
  }

  if (file.pullback) {
    const best =
      file.instances.find((i) => i.status === "drifted") ||
      file.instances.find((i) => i.status === "ok") ||
      file.instances[0];
    if (best) {
      actions.push({
        label: `Pull to source from ${best.instanceName}`,
        type: "pullback",
        instance: {
          toolId: best.toolId,
          instanceId: best.instanceId,
          instanceName: best.instanceName,
          configDir: best.configDir,
        },
      });
    }
  }

  actions.push({ label: "Back to list", type: "back" });

  return actions;
}
