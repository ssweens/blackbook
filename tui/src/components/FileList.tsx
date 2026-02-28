import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { FileStatus } from "../lib/types.js";

interface FileListProps {
  files: FileStatus[];
  selectedIndex: number;
  nameColumnWidth?: number;
  scopeColumnWidth?: number;
  maxHeight?: number;
}

function getToolScope(file: FileStatus): string {
  if (file.tools && file.tools.length > 0) {
    return file.tools.join(", ");
  }
  return "All tools";
}

function computeFlags(file: FileStatus): {
  installed: boolean;
  incomplete: boolean;
  drifted: boolean;
  sourceMissing: boolean;
} {
  const installed = file.instances.some((i) => i.status !== "missing");
  const incomplete = installed && file.instances.some((i) => i.status === "missing");
  const drifted = installed && file.instances.some((i) => i.status === "drifted" || i.driftKind === "both-changed" || i.driftKind === "target-changed");
  const sourceMissing = file.instances.some(
    (i) => i.message.toLowerCase().startsWith("source not found") || i.message.toLowerCase().startsWith("source pattern matched 0") || i.message.toLowerCase().startsWith("source directory not found"),
  );
  return { installed, incomplete, drifted, sourceMissing };
}

export function FileList({
  files,
  selectedIndex,
  nameColumnWidth,
  scopeColumnWidth,
  maxHeight = 8,
}: FileListProps) {
  const hasSelection = selectedIndex >= 0;
  const effectiveIndex = hasSelection ? selectedIndex : 0;

  const maxNameLen = useMemo(() => {
    if (nameColumnWidth) return nameColumnWidth;
    return Math.min(30, Math.max(...files.map((f) => f.name.length), 10));
  }, [files, nameColumnWidth]);

  const scopeWidth = scopeColumnWidth ?? Math.min(20, Math.max(...files.map((f) => getToolScope(f).length), 9));

  const { visibleFiles, startIndex } = useMemo(() => {
    if (files.length <= maxHeight) {
      return {
        visibleFiles: files,
        startIndex: 0,
      };
    }

    const maxStart = Math.max(0, files.length - maxHeight);
    const start = Math.min(Math.max(0, effectiveIndex - (maxHeight - 1)), maxStart);

    return {
      visibleFiles: files.slice(start, start + maxHeight),
      startIndex: start,
    };
  }, [files, effectiveIndex, maxHeight]);

  if (files.length === 0) {
    return (
      <Box>
        <Text color="gray">No files configured</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleFiles.map((file, visibleIdx) => {
        const actualIndex = startIndex + visibleIdx;
        const isSelected = hasSelection && actualIndex === selectedIndex;
        const indicator = isSelected ? "❯" : " ";

        const flags = computeFlags(file);
        const statusIcon = flags.installed ? "✔" : " ";
        const statusColor = flags.installed ? "green" : "gray";
        const statusLabel = flags.installed ? "installed" : "";
        const statusWidth = 9;

        const paddedName = file.name.padEnd(maxNameLen);
        const scope = getToolScope(file);
        const isScoped = file.tools && file.tools.length > 0;

        return (
          <Box key={file.name} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>{indicator} </Text>
              <Text bold={isSelected} color="white">
                {paddedName}
              </Text>
              <Text color="gray"> </Text>
              <Text color={isScoped ? "magenta" : "blue"}>{scope.padEnd(scopeWidth)}</Text>
              <Text color="gray"> </Text>
              <Text color={statusColor}>{statusIcon}</Text>
              <Text color={statusColor}>{" " + statusLabel.padEnd(statusWidth)}</Text>

              {flags.incomplete && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">incomplete</Text>
                </>
              )}
              {flags.drifted && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="yellow">changed</Text>
                </>
              )}
              {flags.sourceMissing && (
                <>
                  <Text color="gray"> · </Text>
                  <Text color="red">source missing</Text>
                </>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
