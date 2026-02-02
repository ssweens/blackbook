import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { ConfigFile } from "../lib/types.js";
import { getConfigToolStatus } from "../lib/install.js";
import { getConfigRepoPath } from "../lib/config.js";

interface ConfigDetailProps {
  config: ConfigFile;
  selectedAction: number;
}

export function ConfigDetail({ config, selectedAction }: ConfigDetailProps) {
  const sourceFiles = config.sourceFiles || [];
  const toolStatuses = useMemo(
    () => getConfigToolStatus(config, sourceFiles),
    [config, sourceFiles]
  );
  const configRepo = useMemo(() => getConfigRepoPath(), []);

  const enabledStatuses = toolStatuses.filter((status) => status.enabled);
  const missingCount = enabledStatuses.filter((status) => !status.installed).length;
  const driftedCount = enabledStatuses.filter((status) => status.drifted).length;
  const needsSync = missingCount > 0 || driftedCount > 0;

  const actions = useMemo(() => {
    const base = [] as string[];
    if (needsSync) base.push("Sync to tool");
    base.push("Back to list");
    return base;
  }, [needsSync]);

  const sourceDisplay = useMemo(() => {
    if (config.mappings && config.mappings.length > 0) {
      return config.mappings.map(m => `${m.source} → ${m.target}`).join(", ");
    }
    if (config.sourcePath && config.targetPath) {
      return `${config.sourcePath} → ${config.targetPath}`;
    }
    return "(not configured)";
  }, [config]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{config.name}</Text>
        <Text color="gray"> · config</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Tool: </Text>
        <Text color="magenta">{config.toolId}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Config repo: </Text>
        <Text>{configRepo || "(not configured)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Source(s): </Text>
        <Text>{sourceDisplay}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Files: </Text>
        <Text>{sourceFiles.length > 0 ? `${sourceFiles.length} file(s)` : "(none)"}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">Status: </Text>
        <Text color={config.installed ? "green" : "yellow"}>
          {config.installed ? "Synced" : "Not synced"}
        </Text>
        {config.drifted && <Text color="yellow"> (drifted)</Text>}
      </Box>

      {!config.sourceExists && (
        <Box marginBottom={1}>
          <Text color="red">Source unavailable: {config.sourceError || "Missing"}</Text>
        </Box>
      )}

      {toolStatuses.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Tool Status:</Text>
          {toolStatuses.map((status) => {
            let label = "Not enabled";
            let color: "green" | "yellow" | "gray" = "gray";
            if (status.enabled) {
              if (status.drifted) {
                label = "Drifted";
                color = "yellow";
              } else if (status.installed) {
                label = "Synced";
                color = "green";
              } else {
                label = "Missing";
                color = "yellow";
              }
            }

            return (
              <Box key={`${status.toolId}:${status.instanceId}`} marginLeft={1}>
                <Text color="gray">• {status.name}: </Text>
                <Text color={color}>{label}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const isSelected = i === selectedAction;
          const color = action === "Sync to tool" ? "green" : "white";
          return (
            <Box key={action}>
              <Text color={isSelected ? "cyan" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text bold={isSelected} color={isSelected ? color : "gray"}>
                {action}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
