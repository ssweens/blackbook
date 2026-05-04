/**
 * Settings tab — tool instances, package manager, config management toggle.
 */

import React from "react";
import { Box, Text } from "ink";
import { usePlaybookStore } from "../lib/playbook-store.js";

export function SettingsTab({ isFocused: _f }: { isFocused: boolean }) {
  const { playbook, playbookPath, playbookValidation } = usePlaybookStore();

  if (!playbook) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="yellow">No playbook loaded.</Text>
      </Box>
    );
  }

  const { settings, defaults } = playbook.manifest;
  const validation = playbookValidation;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={0}>
      {/* Playbook path */}
      <Text bold>Playbook</Text>
      <Text dimColor>  {playbookPath ?? "(unknown)"}</Text>

      {/* Validation status */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Validation</Text>
        {!validation || validation.issues.length === 0 ? (
          <Text color="green">  ✓ no issues</Text>
        ) : (
          validation.issues.map((issue, i) => (
            <Text
              key={i}
              color={
                issue.severity === "error"
                  ? "red"
                  : issue.severity === "warning"
                  ? "yellow"
                  : "gray"
              }
            >
              {"  "}[{issue.severity}] {issue.source}: {issue.message}
            </Text>
          ))
        )}
      </Box>

      {/* Settings */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Settings</Text>
        <Text dimColor>  package_manager: {settings.package_manager}</Text>
        <Text dimColor>  backup_retention: {settings.backup_retention}</Text>
        <Text dimColor>  default_strategy: {defaults.default_strategy}</Text>
        <Text dimColor>  drift_action: {defaults.drift_action}</Text>
        <Text dimColor>  confirm_removals: always (locked)</Text>
      </Box>

      {/* Tool instances */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Tool instances</Text>
        {playbook.manifest.tools_enabled.length === 0 && (
          <Text dimColor>  (no tools enabled)</Text>
        )}
        {playbook.manifest.tools_enabled.map((toolId) => {
          const tc = playbook.tools[toolId];
          if (!tc) return null;
          return (
            <Box key={toolId} flexDirection="column" marginTop={1}>
              <Text bold dimColor>  {toolId}</Text>
              {tc.config.instances.map((inst) => (
                <Text key={inst.id} dimColor>
                  {"    "}
                  {inst.enabled ? "✓" : "·"} [{inst.id}] {inst.name}  →  {inst.config_dir}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>

      {/* Keybinds hint */}
      <Box marginTop={2}>
        <Text dimColor>Edit playbook.yaml / tool.yaml to change settings · r to reload</Text>
      </Box>
    </Box>
  );
}
