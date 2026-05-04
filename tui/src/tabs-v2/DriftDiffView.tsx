/**
 * DriftDiffView — shows a unified diff for a single drifted artifact.
 *
 * Used when the user presses Enter on an `~` (update) item in the drift list.
 * Reuses the existing DiffDetail component.
 *
 * For skills (directories): diffs the SKILL.md file specifically.
 * For files (commands, agents, AGENTS.md): diffs the file directly.
 */

import React from "react";
import { Box, Text } from "ink";
import { join as pathJoin } from "node:path";
import { existsSync, statSync } from "node:fs";
import { DiffDetail } from "../components/DiffDetail.js";
import type { DiffOp } from "../lib/playbook/index.js";
import type { DiffFileSummary } from "../lib/types.js";


interface Props {
  op: DiffOp;
  onBack: () => void;
}

export function DriftDiffView({ op, onBack }: Props) {
  if (op.kind !== "update" || !op.sourcePath || !op.targetPath) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">No diff available for {op.kind} operations.</Text>
        <Text dimColor>Press Esc to go back.</Text>
      </Box>
    );
  }

  // For skills, point at SKILL.md inside the dir
  const sourcePath = resolveFilePath(op.sourcePath, op.artifactType);
  const targetPath = resolveFilePath(op.targetPath, op.artifactType);

  if (!sourcePath || !targetPath) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">Cannot locate files to diff for {op.name}.</Text>
        <Text dimColor>Press Esc to go back.</Text>
      </Box>
    );
  }

  const summary: DiffFileSummary = {
    id: op.name,
    displayPath: `${op.artifactType}/${op.name}`,
    sourcePath,
    targetPath,
    status: "modified",
    linesAdded: 0,  // DiffDetail computes the real counts
    linesRemoved: 0,
    sourceMtime: safeStatMs(sourcePath),
    targetMtime: safeStatMs(targetPath),
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={2} paddingY={0}>
        <Text bold>Diff: </Text>
        <Text>{op.artifactType}/{op.name}</Text>
        <Text dimColor>  (source: playbook  target: disk)  Esc to go back</Text>
      </Box>
      <DiffDetail
        file={summary}
        title={op.name}
        instanceName="disk"
        onBack={onBack}
      />
    </Box>
  );
}

function resolveFilePath(
  path: string,
  artifactType: DiffOp["artifactType"],
): string | null {
  if (artifactType === "skill") {
    // Skills are directories — diff the SKILL.md
    const skillMd = pathJoin(path, "SKILL.md");
    return existsSync(skillMd) ? skillMd : null;
  }
  return existsSync(path) ? path : null;
}

function safeStatMs(path: string): number | null {
  try { return statSync(path).mtimeMs; } catch { return null; }
}
