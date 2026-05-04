/**
 * Sources tab — marketplaces and upstream bundle sources.
 */

import React from "react";
import { Box, Text } from "ink";
import { usePlaybookStore } from "../lib/playbook-store.js";

export function SourcesTab({ isFocused: _f }: { isFocused: boolean }) {
  const { playbook, playbookLoading, playbookError } = usePlaybookStore();

  if (!playbook) {
    return (
      <Box paddingX={2} paddingY={1}>
        {playbookLoading ? <Text dimColor>Loading…</Text>
        : playbookError ? <Text color="red">✗ {playbookError}</Text>
        : <Text color="yellow">No playbook loaded.</Text>}
      </Box>
    );
  }

  const marketplaces = playbook.manifest.marketplaces;
  const toolIds = Object.keys(marketplaces) as string[];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Marketplaces</Text>
      {toolIds.length === 0 && (
        <Text dimColor>
          None declared — add under marketplaces: in playbook.yaml to pull
          Claude/Codex plugins.
        </Text>
      )}
      {toolIds.map((toolId) => {
        const refs = marketplaces[toolId] ?? [];
        return (
          <Box key={toolId} flexDirection="column" marginTop={1}>
            <Text bold dimColor>[{toolId}]</Text>
            {refs.map((ref) => (
              <Box key={ref.name} flexDirection="column" marginLeft={2}>
                <Text>
                  <Text bold>{ref.name}</Text>
                  {ref.url && <Text dimColor>  {ref.url}</Text>}
                </Text>
                {ref.publishers && ref.publishers.length > 0 && (
                  <Text dimColor>  publishers: {ref.publishers.join(", ")}</Text>
                )}
              </Box>
            ))}
          </Box>
        );
      })}

      {/* Required env */}
      <Box marginTop={2} flexDirection="column">
        <Text bold>Required environment variables</Text>
        {playbook.manifest.required_env.length === 0 ? (
          <Text dimColor>None declared.</Text>
        ) : (
          playbook.manifest.required_env.map((e) => {
            const set = !!process.env[e.name];
            return (
              <Box key={e.name}>
                <Text color={set ? "green" : e.optional ? "yellow" : "red"}>
                  {set ? "✓" : e.optional ? "?" : "✗"}
                </Text>
                <Text> {e.name}</Text>
                <Text dimColor>
                  {e.optional ? " (optional)" : ""}
                  {e.used_by.length ? `  used by: ${e.used_by.join(", ")}` : ""}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
