import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "../lib/config/loader.js";
import { saveConfig } from "../lib/config/writer.js";
import type { Settings } from "../lib/config/schema.js";

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
    key: "default_pullback",
    label: "Default Pullback",
    type: "boolean",
    description: "Enable pullback (target → source) for new file entries",
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

interface SettingsPanelProps {
  active?: boolean;
}

export function SettingsPanel({ active = true }: SettingsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    const { config } = loadConfig();
    setSettings(config.settings);
  }, []);

  // Clear save message after a delay
  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 2000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  const persistSettings = (updated: Settings) => {
    const { config } = loadConfig();
    config.settings = updated;
    saveConfig(config);
    setSettings(updated);
    setSaveMessage("Saved");
  };

  useInput((input, key) => {
    if (!active || !settings) return;

    const def = SETTINGS_DEFS[selectedIndex];

    // When editing a text/number field
    if (editing) {
      if (key.escape) {
        setEditing(false);
        return;
      }
      if (key.return) {
        if (def.type === "number") {
          const num = parseInt(editValue, 10);
          if (isNaN(num) || num < 1 || num > 100) {
            // Invalid — stay in edit mode
            return;
          }
          persistSettings({ ...settings, [def.key]: num });
        } else {
          // text
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
      setSelectedIndex((i) => Math.min(SETTINGS_DEFS.length - 1, i + 1));
      return;
    }

    // Action on Enter
    if (key.return && def) {
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

      // text / number — enter edit mode
      const current = settings[def.key];
      setEditValue(current !== undefined && current !== null ? String(current) : "");
      setEditing(true);
      return;
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
        {saveMessage && (
          <Text color="green"> {saveMessage}</Text>
        )}
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
    </Box>
  );
}
