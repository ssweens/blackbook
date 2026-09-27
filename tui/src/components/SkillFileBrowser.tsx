import React, { useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

interface SkillFileBrowserProps {
  skillName: string;
  rootPath: string;
  onClose: () => void;
}

interface BrowserEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FilePreview {
  path: string;
  lines: string[];
  message?: string;
}

const MAX_PREVIEW_BYTES = 1024 * 1024;

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resolveWithinRoot(root: string, candidate: string): string | null {
  try {
    const resolved = realpathSync(candidate);
    return isWithinRoot(root, resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function resolveRoot(rootPath: string): string | null {
  try {
    const root = realpathSync(rootPath);
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function listDirectory(root: string, directory: string): BrowserEntry[] {
  const resolvedDirectory = resolveWithinRoot(root, directory);
  if (!resolvedDirectory) return [];

  try {
    return readdirSync(resolvedDirectory, { withFileTypes: true })
      .flatMap((entry) => {
        const path = join(directory, entry.name);
        const resolved = resolveWithinRoot(root, path);
        if (!resolved) return [];
        try {
          const stat = statSync(resolved);
          if (!stat.isDirectory() && !stat.isFile()) return [];
          return [{ name: entry.name, path, isDirectory: stat.isDirectory() }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

function readPreview(root: string, path: string): FilePreview {
  const resolved = resolveWithinRoot(root, path);
  if (!resolved) return { path, lines: [], message: "File is outside the skill directory or is unavailable." };

  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) return { path, lines: [], message: "This entry is not a regular file." };
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { path, lines: [], message: "File is larger than the 1 MiB preview limit." };
    }

    const content = readFileSync(resolved);
    if (content.includes(0)) {
      return { path, lines: [], message: "Binary files cannot be previewed as text." };
    }
    return { path, lines: content.toString("utf8").split(/\r\n|\n|\r/) };
  } catch (error) {
    return {
      path,
      lines: [],
      message: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function windowStart(total: number, selected: number, size: number): number {
  if (total <= size) return 0;
  return Math.min(Math.max(0, selected - Math.floor(size / 2)), total - size);
}

export function SkillFileBrowser({ skillName, rootPath, onClose }: SkillFileBrowserProps) {
  const root = useMemo(() => resolveRoot(rootPath), [rootPath]);
  const [directory, setDirectory] = useState<string | null>(root);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const entries = root && directory ? listDirectory(root, directory) : [];
  const { stdout } = useStdout();
  const rows = stdout?.rows || 30;
  const listWindowSize = Math.max(4, rows - 18);
  const previewWindowSize = Math.max(3, rows - 17);
  const listStart = windowStart(entries.length, selectedIndex, listWindowSize);
  const visibleEntries = entries.slice(listStart, listStart + listWindowSize);
  const visibleLines = preview?.lines.slice(scrollTop, scrollTop + previewWindowSize) ?? [];
  const currentPath = root && directory ? relative(root, directory) || "." : rootPath;
  const previewPath = root && preview ? relative(root, preview.path) || "SKILL.md" : "";

  useInput((input, key) => {
    if (key.escape) {
      if (preview) {
        setPreview(null);
        setScrollTop(0);
      } else {
        onClose();
      }
      return;
    }

    if (preview) {
      if (key.backspace) {
        setPreview(null);
        setScrollTop(0);
      } else if (key.upArrow) {
        setScrollTop((offset) => Math.max(0, offset - 1));
      } else if (key.downArrow) {
        setScrollTop((offset) => Math.min(Math.max(0, preview.lines.length - previewWindowSize), offset + 1));
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(Math.max(0, entries.length - 1), index + 1));
      return;
    }
    if (key.backspace) {
      if (!root || !directory) return;
      if (directory === root) {
        onClose();
        return;
      }
      const childDirectory = directory;
      const parent = dirname(childDirectory);
      const parentEntries = listDirectory(root, parent);
      setDirectory(parent);
      setSelectedIndex(Math.max(0, parentEntries.findIndex((entry) => entry.path === childDirectory)));
      return;
    }
    if (key.return) {
      const entry = entries[selectedIndex];
      if (!entry) return;
      if (entry.isDirectory) {
        setDirectory(entry.path);
        setSelectedIndex(0);
      } else if (root) {
        setPreview(readPreview(root, entry.path));
        setScrollTop(0);
      }
      return;
    }

    // Do not let this view's ordinary character input reach app-level shortcuts.
    void input;
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{preview ? previewPath : `Files · ${skillName}`}</Text>
        {!preview && <Text color="gray">{currentPath}</Text>}
      </Box>

      {preview ? (
        <Box flexDirection="column">
          {preview.message ? (
            <Text color="yellow">{preview.message}</Text>
          ) : (
            <>
              {visibleLines.map((line, index) => {
                const lineNumber = scrollTop + index + 1;
                return (
                  <Text key={lineNumber} wrap="truncate">
                    <Text color="gray" dimColor>{String(lineNumber).padStart(4, " ")} │ </Text>
                    {line || " "}
                  </Text>
                );
              })}
              {preview.lines.length > previewWindowSize && (
                <Text color="gray" dimColor>
                  Lines {scrollTop + 1}–{Math.min(preview.lines.length, scrollTop + previewWindowSize)} of {preview.lines.length}
                </Text>
              )}
            </>
          )}
        </Box>
      ) : root && directory ? (
        <Box flexDirection="column">
          {listStart > 0 && <Text color="gray" dimColor>↑ {listStart} more above</Text>}
          {visibleEntries.map((entry, index) => {
            const isSelected = listStart + index === selectedIndex;
            return (
              <Box key={entry.path}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "❯ " : "  "}</Text>
                <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                  {entry.isDirectory ? `📁 ${entry.name}/` : `📄 ${entry.name}`}
                </Text>
              </Box>
            );
          })}
          {listStart + visibleEntries.length < entries.length && (
            <Text color="gray" dimColor>↓ {entries.length - listStart - visibleEntries.length} more below</Text>
          )}
          {entries.length === 0 && <Text color="gray">No files in this directory.</Text>}
        </Box>
      ) : (
        <Text color="yellow">Skill files are unavailable at this path.</Text>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {preview ? "↑/↓ scroll · Esc or Backspace to files" : "↑/↓ navigate · Enter open · Backspace up · Esc close"}
        </Text>
      </Box>
    </Box>
  );
}
