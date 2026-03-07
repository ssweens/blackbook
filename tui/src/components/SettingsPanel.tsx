import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "../lib/config/loader.js";
import { saveConfig } from "../lib/config/writer.js";
import type { Settings } from "../lib/config/schema.js";
import {
  getSourceRepoStatus,
  getSourceRepoDiff,
  commitAndPushSourceRepo,
  pullSourceRepoChanges,
  type SourceRepoStatus,
  type SourceRepoChange,
} from "../lib/source-setup.js";

type SettingKey = keyof Settings;

interface SettingDef {
  key: SettingKey;
  label: string;
  type: "enum" | "text" | "number" | "boolean";
  enumValues?: string[];
  description: string;
}

const SETTINGS_DEFS: SettingDef[] = [
  {
    key: "package_manager",
    label: "Package Manager",
    type: "enum",
    enumValues: ["npm", "pnpm", "bun"],
    description: "Package manager for installing tool binaries",
  },
  {
    key: "source_repo",
    label: "Source Repo",
    type: "text",
    description: "Path to the source repository for config/asset files",
  },
  {
    key: "backup_retention",
    label: "Backup Retention",
    type: "number",
    description: "Number of backups to keep per file (1-100)",
  },
  {
    key: "config_management",
    label: "Config Management",
    type: "boolean",
    description: "Track and sync tool config files (settings.json, etc.)",
  },
];

function formatValue(def: SettingDef, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(not set)";
  }
  if (def.type === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu item model
// ─────────────────────────────────────────────────────────────────────────────

type MenuItem =
  | { kind: "setting"; def: SettingDef }
  | { kind: "change"; change: SourceRepoChange }
  | { kind: "action"; id: string; label: string };

export function buildMenuItems(repoStatus: SourceRepoStatus | null): MenuItem[] {
  const items: MenuItem[] = SETTINGS_DEFS.map((def) => ({ kind: "setting" as const, def }));

  if (repoStatus?.isGitRepo && repoStatus.hasChanges) {
    for (const change of repoStatus.changes) {
      items.push({ kind: "change", change });
    }
  }

  if (repoStatus?.isGitRepo) {
    if (repoStatus.hasChanges) {
      items.push({ kind: "action", id: "commit_push", label: "Commit & push changes" });
    }
    items.push({ kind: "action", id: "pull", label: "Pull latest" });
  }

  return items;
}

export function getUpstreamStateLabel(repoStatus: SourceRepoStatus): string {
  if (!repoStatus.hasUpstream) return "no upstream configured";
  if (repoStatus.ahead > 0 && repoStatus.behind > 0) {
    return `diverged (ahead ${repoStatus.ahead}, behind ${repoStatus.behind})`;
  }
  if (repoStatus.behind > 0) return `behind by ${repoStatus.behind}`;
  if (repoStatus.ahead > 0) return `ahead by ${repoStatus.ahead}`;
  return "up to date";
}

function changeStatusChar(status: SourceRepoChange["status"]): { char: string; color: string } {
  switch (status) {
    case "added":
    case "untracked":
      return { char: "+", color: "green" };
    case "deleted":
      return { char: "-", color: "red" };
    default:
      return { char: "~", color: "yellow" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff processing — strip git headers, truncate long lines
// ─────────────────────────────────────────────────────────────────────────────

function parseDiffLines(raw: string, maxLineWidth: number): string[] {
  return raw
    .split("\n")
    .filter((line) => {
      // Strip git metadata headers
      if (line.startsWith("diff --git")) return false;
      if (line.startsWith("index ")) return false;
      if (line.startsWith("--- ")) return false;
      if (line.startsWith("+++ ")) return false;
      return true;
    })
    .map((line) => (line.length > maxLineWidth ? line.slice(0, maxLineWidth - 1) + "…" : line));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-height diff panel
// ─────────────────────────────────────────────────────────────────────────────

const DIFF_HEIGHT = 12;

function DiffPanel({
  lines,
  scrollOffset,
}: {
  lines: string[];
  scrollOffset: number;
}) {
  const visible = lines.slice(scrollOffset, scrollOffset + DIFF_HEIGHT);
  const hasMore = scrollOffset + DIFF_HEIGHT < lines.length;
  const hasAbove = scrollOffset > 0;

  // Pad to fixed height
  const padded = [...visible];
  while (padded.length < DIFF_HEIGHT) {
    padded.push("");
  }

  return (
    <Box flexDirection="column" height={DIFF_HEIGHT + 1} marginLeft={4}>
      {padded.map((line, i) => {
        if (!line) {
          return <Text key={i}> </Text>;
        }
        let color: string = "gray";
        if (line.startsWith("+")) color = "green";
        else if (line.startsWith("-")) color = "red";
        else if (line.startsWith("@@")) color = "cyan";

        return <Text key={i} color={color} wrap="truncate">{line}</Text>;
      })}
      <Text color="gray" italic>
        {hasAbove && hasMore
          ? `↑↓ scroll · ${lines.length} lines · Esc to close`
          : hasMore
            ? `↓ more below · ${lines.length} lines · Esc to close`
            : hasAbove
              ? `↑ more above · ${lines.length} lines · Esc to close`
              : `${lines.length} lines · Esc to close`}
      </Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  active?: boolean;
}

export function SettingsPanel({ active = true }: SettingsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<SourceRepoStatus | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [commitEditing, setCommitEditing] = useState(false);
  const [commitMessage, setCommitMessage] = useState("chore: update playbook config and assets");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<Record<string, string[]>>({});
  const [diffLoading, setDiffLoading] = useState<string | null>(null);
  const [diffScroll, setDiffScroll] = useState(0);

  const menuItems = buildMenuItems(repoStatus);

  const refreshRepoStatus = useCallback(async () => {
    setRepoLoading(true);
    const status = await getSourceRepoStatus();
    setRepoStatus(status);
    setRepoLoading(false);
  }, []);

  useEffect(() => {
    const { config } = loadConfig();
    setSettings(config.settings);
    refreshRepoStatus();
  }, [refreshRepoStatus]);

  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 2000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  const persistSettings = (updated: Settings) => {
    const { config } = loadConfig();
    config.settings = updated;
    saveConfig(config);
    setSettings(updated);
    setSaveMessage("Saved");
  };

  const toggleDiff = async (filePath: string) => {
    if (expandedDiff === filePath) {
      setExpandedDiff(null);
      setDiffScroll(0);
      return;
    }

    if (!diffContent[filePath]) {
      setDiffLoading(filePath);
      const raw = await getSourceRepoDiff(filePath);
      const lines = raw ? parseDiffLines(raw, 100) : ["(no diff available)"];
      setDiffContent((prev) => ({ ...prev, [filePath]: lines }));
      setDiffLoading(null);
    }

    setExpandedDiff(filePath);
    setDiffScroll(0);
  };

  // Hint text for the selected item (always 1 line)
  const selectedHint = useMemo((): string => {
    const item = menuItems[selectedIndex];
    if (!item) return "";

    if (item.kind === "setting") {
      const def = item.def;
      if (editing) return "Enter to save · Esc to cancel";
      if (def.type === "enum") return `Enter to cycle (${def.enumValues?.join(", ")}) · ${def.description}`;
      if (def.type === "boolean") return `Enter to toggle · ${def.description}`;
      return `Enter to edit · ${def.description}`;
    }

    if (item.kind === "change") {
      if (expandedDiff === item.change.path) return "";
      return "Enter to view diff";
    }

    if (item.kind === "action") {
      if (commitEditing) return "";
      if (item.id === "commit_push") return "Enter to commit and push all changes";
      if (repoStatus?.hasChanges) return "Commit/stash local changes before pulling";
      return "Enter to pull latest from remote";
    }

    return "";
  }, [menuItems, selectedIndex, editing, expandedDiff, commitEditing, repoStatus]);

  useInput((input, key) => {
    if (!active || !settings) return;

    // Diff scrolling mode
    if (expandedDiff) {
      if (key.escape) {
        setExpandedDiff(null);
        setDiffScroll(0);
        return;
      }
      const lines = diffContent[expandedDiff] ?? [];
      const maxScroll = Math.max(0, lines.length - DIFF_HEIGHT);
      if (key.upArrow) {
        setDiffScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setDiffScroll((s) => Math.min(maxScroll, s + 1));
        return;
      }
      // Enter toggles diff off too
      if (key.return) {
        setExpandedDiff(null);
        setDiffScroll(0);
        return;
      }
      return;
    }

    // Commit message editing
    if (commitEditing) {
      if (key.escape) {
        setCommitEditing(false);
        return;
      }
      if (key.return) {
        setCommitEditing(false);
        const msg = commitMessage.trim() || "chore: update playbook config and assets";
        commitAndPushSourceRepo(msg).then((result) => {
          if (result.success) {
            setActionMessage("✔ Committed and pushed");
            setDiffContent({});
            refreshRepoStatus();
          } else {
            setActionMessage(`✗ ${result.error}`);
          }
        });
        return;
      }
      return;
    }

    // Settings field editing
    if (editing) {
      if (key.escape) {
        setEditing(false);
        return;
      }
      if (key.return) {
        const item = menuItems[selectedIndex];
        if (item?.kind !== "setting") return;
        const def = item.def;
        if (def.type === "number") {
          const num = parseInt(editValue, 10);
          if (isNaN(num) || num < 1 || num > 100) return;
          persistSettings({ ...settings, [def.key]: num });
        } else {
          persistSettings({ ...settings, [def.key]: editValue || undefined });
        }
        setEditing(false);
        return;
      }
      return;
    }

    // Navigation
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(menuItems.length - 1, i + 1));
      return;
    }

    // Action on Enter
    if (key.return) {
      const item = menuItems[selectedIndex];
      if (!item) return;

      if (item.kind === "setting") {
        const def = item.def;
        if (def.type === "enum" && def.enumValues) {
          const current = String(settings[def.key] ?? def.enumValues[0]);
          const idx = def.enumValues.indexOf(current);
          const next = def.enumValues[(idx + 1) % def.enumValues.length];
          persistSettings({ ...settings, [def.key]: next as any });
          return;
        }
        if (def.type === "boolean") {
          persistSettings({ ...settings, [def.key]: !settings[def.key] as any });
          return;
        }
        const current = settings[def.key];
        setEditValue(current !== undefined && current !== null ? String(current) : "");
        setEditing(true);
        return;
      }

      if (item.kind === "change") {
        toggleDiff(item.change.path);
        return;
      }

      if (item.kind === "action") {
        if (item.id === "commit_push") {
          setCommitEditing(true);
          return;
        }
        if (item.id === "pull") {
          if (repoStatus?.hasChanges) {
            setActionMessage("✗ Local changes detected. Commit or stash before pulling.");
            return;
          }

          setActionMessage("Pulling...");
          pullSourceRepoChanges().then((result) => {
            if (result.success) {
              setActionMessage("✔ Pulled latest");
              refreshRepoStatus();
            } else {
              setActionMessage(`✗ ${result.error}`);
            }
          });
          return;
        }
      }
    }
  });

  if (!settings) {
    return (
      <Box>
        <Text color="gray">Loading settings...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Settings</Text>
        {saveMessage && <Text color="green"> {saveMessage}</Text>}
        {actionMessage && <Text color="yellow"> {actionMessage}</Text>}
      </Box>

      {/* Settings items — each is exactly 1 line */}
      {menuItems.map((item, i) => {
        if (item.kind !== "setting") return null;
        const isSelected = i === selectedIndex;
        const value = settings[item.def.key];
        const isEditing = isSelected && editing;

        return (
          <Box key={item.def.key}>
            <Text color={isSelected ? "cyan" : "white"}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text bold={isSelected} color={isSelected ? "white" : "gray"}>
              {item.def.label}
            </Text>
            <Text>  </Text>
            {isEditing ? (
              <TextInput value={editValue} onChange={setEditValue} />
            ) : (
              <Text color={isSelected ? "yellow" : "gray"}>
                {formatValue(item.def, value)}
              </Text>
            )}
          </Box>
        );
      })}

      {/* Source Repo header */}
      {repoStatus && repoStatus.isGitRepo && (
        <Box marginTop={1}>
          <Text bold color="cyan">Source Repo</Text>
          <Text color="gray">  </Text>
          <Text color="gray">{repoStatus.branch}</Text>
          {repoStatus.ahead > 0 && <Text color="green"> ↑{repoStatus.ahead}</Text>}
          {repoStatus.behind > 0 && <Text color="red"> ↓{repoStatus.behind}</Text>}
          {!repoStatus.hasChanges && repoStatus.ahead === 0 && repoStatus.behind === 0 && repoStatus.hasUpstream && (
            <Text color="green"> ✔ clean</Text>
          )}
          {repoLoading && <Text color="gray"> (checking...)</Text>}
          {repoStatus.hasChanges && (
            <Text color="yellow"> · {repoStatus.changes.length} pending</Text>
          )}
          <Text color="gray"> · upstream: {getUpstreamStateLabel(repoStatus)}</Text>
        </Box>
      )}

      {/* Changed files — each is exactly 1 line */}
      {menuItems.map((item, i) => {
        if (item.kind !== "change") return null;
        const isSelected = i === selectedIndex;
        const { char, color } = changeStatusChar(item.change.status);
        const isExpanded = expandedDiff === item.change.path;

        return (
          <Box key={`change-${item.change.path}`}>
            <Text color={isSelected ? "cyan" : "white"}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text color={color}>{char}</Text>
            <Text color={isSelected ? "white" : "gray"}> {item.change.path}</Text>
            {isExpanded && <Text color="cyan"> ▾</Text>}
            {!isExpanded && isSelected && <Text color="gray"> ▸</Text>}
          </Box>
        );
      })}

      {/* Repo actions — each is exactly 1 line */}
      {menuItems.map((item, i) => {
        if (item.kind !== "action") return null;
        const isSelected = i === selectedIndex;
        const isCommitAction = item.id === "commit_push" && isSelected && commitEditing;

        return (
          <Box key={item.id} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? "white" : "gray"}>
                {item.label}
              </Text>
            </Box>
            {isCommitAction && (
              <Box marginLeft={4}>
                <Text color="gray">Message: </Text>
                <TextInput value={commitMessage} onChange={setCommitMessage} />
              </Box>
            )}
          </Box>
        );
      })}

      {/* Hint line — always 1 line, consistent position */}
      <Box marginTop={0} marginLeft={4} height={1}>
        <Text color="gray" italic wrap="truncate">{selectedHint}</Text>
      </Box>

      {/* Diff panel — fixed height, shown when expanded */}
      {expandedDiff && diffContent[expandedDiff] && (
        <DiffPanel lines={diffContent[expandedDiff]} scrollOffset={diffScroll} />
      )}
      {expandedDiff && diffLoading === expandedDiff && (
        <Box marginLeft={4} height={DIFF_HEIGHT + 1}>
          <Text color="gray">Loading diff...</Text>
        </Box>
      )}
    </Box>
  );
}
