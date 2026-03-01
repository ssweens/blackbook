import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "../lib/config/loader.js";
import { saveConfig } from "../lib/config/writer.js";
import type { Settings } from "../lib/config/schema.js";
import {
  getSourceRepoStatus,
  commitAndPushSourceRepo,
  pullSourceRepoChanges,
  type SourceRepoStatus,
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
// Repo action items that appear below settings
// ─────────────────────────────────────────────────────────────────────────────

interface RepoAction {
  id: string;
  label: string;
  available: boolean;
}

function getRepoActions(repoStatus: SourceRepoStatus | null): RepoAction[] {
  if (!repoStatus || !repoStatus.isGitRepo) return [];
  return [
    {
      id: "commit_push",
      label: "Commit & push changes",
      available: repoStatus.hasChanges,
    },
    {
      id: "pull",
      label: "Pull latest",
      available: repoStatus.behind > 0 || !repoStatus.hasChanges,
    },
  ];
}

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

  const totalItems = SETTINGS_DEFS.length + getRepoActions(repoStatus).filter((a) => a.available).length;

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

  const availableActions = getRepoActions(repoStatus).filter((a) => a.available);

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
        const def = SETTINGS_DEFS[selectedIndex];
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
      setSelectedIndex((i) => Math.min(totalItems - 1, i + 1));
      return;
    }

    // Action on Enter
    if (key.return) {
      // Settings item
      if (selectedIndex < SETTINGS_DEFS.length) {
        const def = SETTINGS_DEFS[selectedIndex];
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

      // Repo action item
      const actionIndex = selectedIndex - SETTINGS_DEFS.length;
      const action = availableActions[actionIndex];
      if (!action) return;

      if (action.id === "commit_push") {
        setCommitEditing(true);
        return;
      }

      if (action.id === "pull") {
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

      {SETTINGS_DEFS.map((def, i) => {
        const isSelected = i === selectedIndex;
        const value = settings[def.key];
        const isEditing = isSelected && editing;

        return (
          <Box key={def.key} flexDirection="column">
            <Box>
              <Text color={isSelected ? "cyan" : "white"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? "white" : "gray"}>
                {def.label}
              </Text>
              <Text>  </Text>
              {isEditing ? (
                <Box>
                  <TextInput value={editValue} onChange={setEditValue} />
                </Box>
              ) : (
                <Text color={isSelected ? "yellow" : "gray"}>
                  {formatValue(def, value)}
                </Text>
              )}
            </Box>
            {isSelected && (
              <Box marginLeft={4}>
                <Text color="gray" italic>
                  {isEditing
                    ? "Enter to save · Esc to cancel"
                    : def.type === "enum"
                      ? `Enter to cycle (${def.enumValues?.join(", ")})`
                      : def.type === "boolean"
                        ? "Enter to toggle"
                        : "Enter to edit"}
                  {" · "}
                  {def.description}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* Source Repo Status */}
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
            <Box flexDirection="column" marginBottom={1}>
              <Text color="yellow" bold>
                {repoStatus.changes.length} pending change{repoStatus.changes.length !== 1 ? "s" : ""}:
              </Text>
              {repoStatus.changes.map((change, i) => (
                <Box key={i} marginLeft={2}>
                  <Text color={
                    change.status === "added" || change.status === "untracked" ? "green"
                    : change.status === "deleted" ? "red"
                    : "yellow"
                  }>
                    {change.status === "added" || change.status === "untracked" ? "+" :
                     change.status === "deleted" ? "-" : "~"}
                  </Text>
                  <Text color="gray"> {change.path}</Text>
                </Box>
              ))}
            </Box>
          )}

          {/* Repo actions */}
          {availableActions.map((action, i) => {
            const globalIndex = SETTINGS_DEFS.length + i;
            const isSelected = globalIndex === selectedIndex;
            const isCommitAction = action.id === "commit_push" && isSelected && commitEditing;

            return (
              <Box key={action.id} flexDirection="column">
                <Box>
                  <Text color={isSelected ? "cyan" : "white"}>
                    {isSelected ? "❯ " : "  "}
                  </Text>
                  <Text bold={isSelected} color={isSelected ? "white" : "gray"}>
                    {action.label}
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
                      {action.id === "commit_push"
                        ? "Enter to commit and push all changes"
                        : "Enter to pull latest from remote"}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
