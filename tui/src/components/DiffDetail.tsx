import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { DiffFileSummary, DiffFileDetail as DiffFileDetailType } from "../lib/types.js";
import { computeFileDetail } from "../lib/diff.js";

interface DiffDetailProps {
  file: DiffFileSummary;
  title: string;
  instanceName: string;
  onBack: () => void;
}

const MAX_VISIBLE_LINES = 20;

export function DiffDetail({ file, title, instanceName, onBack }: DiffDetailProps) {
  const [scrollOffset, setScrollOffset] = useState(0);

  // Compute full diff on demand
  const detail: DiffFileDetailType = useMemo(() => computeFileDetail(file), [file]);

  // Flatten all lines for scrolling
  const allLines = useMemo(() => {
    const lines: { type: "header" | "add" | "remove" | "context"; content: string }[] = [];
    for (const hunk of detail.hunks) {
      lines.push({ type: "header", content: hunk.header });
      for (const line of hunk.lines) {
        lines.push(line);
      }
    }
    return lines;
  }, [detail.hunks]);

  const totalLines = allLines.length;
  const maxScroll = Math.max(0, totalLines - MAX_VISIBLE_LINES);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxScroll, o + 1));
    } else if (key.pageUp || (key.ctrl && input === "u")) {
      setScrollOffset((o) => Math.max(0, o - MAX_VISIBLE_LINES));
    } else if (key.pageDown || (key.ctrl && input === "d")) {
      setScrollOffset((o) => Math.min(maxScroll, o + MAX_VISIBLE_LINES));
    }
  });

  // Binary file
  if (file.status === "binary") {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Diff · {title} · {instanceName}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold>{file.displayPath}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="yellow">Binary files differ</Text>
        </Box>
        <Box>
          <Text color="gray">Esc back</Text>
        </Box>
      </Box>
    );
  }

  // Empty diff (no changes)
  if (allLines.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Diff · {title} · {instanceName}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold>{file.displayPath}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="green">✓ No differences</Text>
        </Box>
        <Box>
          <Text color="gray">Esc back</Text>
        </Box>
      </Box>
    );
  }

  const visibleLines = allLines.slice(scrollOffset, scrollOffset + MAX_VISIBLE_LINES);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Diff · {title} · {instanceName}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold>{file.displayPath}</Text>
        <Text>  </Text>
        <Text color="green">+{file.linesAdded}</Text>
        <Text> </Text>
        <Text color="red">-{file.linesRemoved}</Text>
        {totalLines > MAX_VISIBLE_LINES && (
          <>
            <Text>  </Text>
            <Text color="gray">
              (lines {scrollOffset + 1}-{Math.min(scrollOffset + MAX_VISIBLE_LINES, totalLines)} of {totalLines})
            </Text>
          </>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {visibleLines.map((line, i) => {
          if (line.type === "header") {
            return (
              <Text key={scrollOffset + i} color="cyan">
                {line.content}
              </Text>
            );
          }
          const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
          const color = line.type === "add" ? "green" : line.type === "remove" ? "red" : "gray";
          return (
            <Text key={scrollOffset + i} color={color}>
              {prefix}{line.content}
            </Text>
          );
        })}
      </Box>

      <Box>
        <Text color="gray">↑/↓ scroll · PgUp/PgDn jump · Esc back</Text>
      </Box>
    </Box>
  );
}
