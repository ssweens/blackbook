import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DiffFileSummary } from "../lib/types.js";

interface DiffFileListProps {
  title: string;
  instanceName: string;
  files: DiffFileSummary[];
  onSelect: (index: number) => void;
  onClose: () => void;
}

function statusIcon(status: DiffFileSummary["status"]): { icon: string; color: string } {
  switch (status) {
    case "modified":
      return { icon: "M", color: "yellow" };
    case "missing":
      return { icon: "+", color: "green" };
    case "extra":
      return { icon: "-", color: "red" };
    case "binary":
      return { icon: "B", color: "magenta" };
  }
}

export function DiffFileList({ title, instanceName, files, onSelect, onClose }: DiffFileListProps) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelected((i) => Math.min(files.length - 1, i + 1));
    } else if (key.return) {
      if (files.length > 0) {
        onSelect(selected);
      }
    } else if (key.escape) {
      onClose();
    }
  });

  if (files.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Diff View · {title} · {instanceName}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="green">✓ No differences found - files are in sync.</Text>
        </Box>
        <Box>
          <Text color="gray">Esc back</Text>
        </Box>
      </Box>
    );
  }

  // Calculate column widths
  const maxPathLength = Math.min(50, Math.max(...files.map((f) => f.displayPath.length)));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Diff View · {title} · {instanceName}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          {files.length} file{files.length === 1 ? "" : "s"} with differences:
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {files.map((file, i) => {
          const { icon, color } = statusIcon(file.status);
          return (
            <Box key={file.id}>
              <Text color={i === selected ? "cyan" : "white"}>
                {i === selected ? "❯ " : "  "}
              </Text>
              <Text color={color}>[{icon}] </Text>
              <Text color={i === selected ? "cyan" : "white"}>
                {file.displayPath.padEnd(maxPathLength + 2)}
              </Text>
              {file.status !== "binary" && (
                <>
                  <Text color="green">+{file.linesAdded}</Text>
                  <Text> </Text>
                  <Text color="red">-{file.linesRemoved}</Text>
                </>
              )}
              {file.status === "binary" && (
                <Text color="magenta">binary</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text color="gray">↑/↓ navigate · Enter view diff · Esc back</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Legend: [M] modified · [+] missing in target · [-] extra in target · [B] binary
        </Text>
      </Box>
    </Box>
  );
}
