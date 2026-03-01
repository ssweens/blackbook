import React, { useState, useEffect, useCallback } from "react";
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
// Menu item model: settings, changed files, repo actions
// ─────────────────────────────────────────────────────────────────────────────

type MenuItem =
  | { kind: "setting"; def: SettingDef }
  | { kind: "change"; change: SourceRepoChange }
  | { kind: "action"; id: string; label: string };

function buildMenuItems(
  repoStatus: SourceRepoStatus | null,
): MenuItem[] {
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
    if (repoStatus.behind > 0 || !repoStatus.hasChanges) {
      items.push({ kind: "action", id: "pull", label: "Pull latest" });
    }
  }

  return items;
}

function changeStatusIcon(status: SourceRepoChange["status"]): { char: string; color: string } {
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
// Diff viewer
// ─────────────────────────────────────────────────────────────────────────────

function DiffView({ diff, maxLines }: { diff: string; maxLines: number }) {
  const lines = diff.split("\n");
  const display = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <Box flexDirection="column" marginLeft={4} marginBottom={1}>
      {display.map((line, i) => {
        let color: string = "gray";
        if (line.startsWith("+")) color = "green";
        else if (line.startsWith("-")) color = "red";
        else if (line.startsWith("@@")) color = "cyan";

        return (
          <Text key={i} color={color} dimColor={line.startsWith("diff ") || line.startsWith("index ")}>
            {line}
          </Text>
        );
      })}
      {truncated && (
        <Text color="gray" italic>
          ... {lines.length - maxLines} more line{lines.length - maxLines !== 1 ? "s" : ""}
        </Text>
      )}
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
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null); // path of expanded file
  const [diffContent, setDiffContent] = useState<Record<string, string>>({}); // path -> diff text
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  const menuItems = buildMenuItems(repoStatus);

  const refreshRepoStatus = useCallback(async () => {
    setRepoLoading(true);
    const status = await getSourceRepoStatus();
    setRepoStatus(status);
    setRepoLoading(false);
  }, []);

  // Load settings and repo status on mount
  useEffect(() => {
    const { config } = loadConfig();
    setSettings(config.settings);
    refreshRepoStatus();
  }, [refreshRepoStatus]);

  // Clear save/action messages after a delay
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
      return;
    }

    // Load diff if not cached
    if (!diffContent[filePath]) {
      setDiffLoading(filePath);
      const diff = await getSourceRepoDiff(filePath);
      setDiffContent((prev) => ({ ...prev, [filePath]: diff || "(no diff available)" }));
      setDiffLoading(null);
    }

    setExpandedDiff(filePath);
  };

  useInput((input, key) => {
    if (!active || !settings) return;

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
            setExpandedDiff(null);
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

      {/* Settings */}
      {menuItems.map((item, i) => {
        if (item.kind !== "setting") return null;
        const isSelected = i === selectedIndex;
        const value = settings[item.def.key];
        const isEditing = isSelected && editing;

        return (
          <Box key={item.def.key} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? "white" : "gray"}>
                {item.def.label}
              </Text>
              <Text>  </Text>
              {isEditing ? (
                <Box>
                  <TextInput value={editValue} onChange={setEditValue} />
                </Box>
              ) : (
                <Text color={isSelected ? "yellow" : "gray"}>
                  {formatValue(item.def, value)}
                </Text>
              )}
            </Box>
            {isSelected && (
              <Box marginLeft={4}>
                <Text color="gray" italic>
                  {isEditing
                    ? "Enter to save · Esc to cancel"
                    : item.def.type === "enum"
                      ? `Enter to cycle (${item.def.enumValues?.join(", ")})`
                      : item.def.type === "boolean"
                        ? "Enter to toggle"
                        : "Enter to edit"}
                  {" · "}
                  {item.def.description}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Source Repo Status header */}
      {repoStatus && repoStatus.isGitRepo && (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">Source Repo</Text>
            <Text color="gray">  </Text>
            <Text color="gray">{repoStatus.branch}</Text>
            {repoStatus.ahead > 0 && (
              <Text color="green"> ↑{repoStatus.ahead}</Text>
            )}
            {repoStatus.behind > 0 && (
              <Text color="red"> ↓{repoStatus.behind}</Text>
            )}
            {!repoStatus.hasChanges && repoStatus.ahead === 0 && repoStatus.behind === 0 && (
              <Text color="green"> ✔ clean</Text>
            )}
            {repoLoading && <Text color="gray"> (checking...)</Text>}
          </Box>

          {repoStatus.hasChanges && (
            <Box marginBottom={1}>
              <Text color="yellow" bold>
                {repoStatus.changes.length} pending change{repoStatus.changes.length !== 1 ? "s" : ""}:
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Changed files (selectable) */}
      {menuItems.map((item, i) => {
        if (item.kind !== "change") return null;
        const isSelected = i === selectedIndex;
        const { char, color } = changeStatusIcon(item.change.status);
        const isExpanded = expandedDiff === item.change.path;
        const isLoading = diffLoading === item.change.path;

        return (
          <Box key={`change-${item.change.path}`} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={color}>{char}</Text>
              <Text color={isSelected ? "white" : "gray"}> {item.change.path}</Text>
              {isExpanded && <Text color="gray"> ▾</Text>}
              {!isExpanded && isSelected && <Text color="gray"> ▸</Text>}
            </Box>
            {isSelected && !isExpanded && (
              <Box marginLeft={4}>
                <Text color="gray" italic>Enter to view diff</Text>
              </Box>
            )}
            {isExpanded && isLoading && (
              <Box marginLeft={4}>
                <Text color="gray">Loading diff...</Text>
              </Box>
            )}
            {isExpanded && !isLoading && diffContent[item.change.path] && (
              <DiffView diff={diffContent[item.change.path]} maxLines={40} />
            )}
          </Box>
        );
      })}

      {/* Repo actions */}
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
            {isSelected && !isCommitAction && (
              <Box marginLeft={4}>
                <Text color="gray" italic>
                  {item.id === "commit_push"
                    ? "Enter to commit and push all changes"
                    : "Enter to pull latest from remote"}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
