import React from "react";
import { Box, Text } from "ink";
import type { Plugin } from "../lib/types.js";

interface PluginSummaryProps {
  plugins: Plugin[];
  selected: boolean;
}

export interface PluginStats {
  total: number;
  installed: number;
  notInstalled: number;
  incomplete: number;
}

export function getPluginStats(plugins: Plugin[]): PluginStats {
  return {
    total: plugins.length,
    installed: plugins.filter((p) => p.installed).length,
    notInstalled: plugins.filter((p) => !p.installed).length,
    incomplete: plugins.filter((p) => p.incomplete).length,
  };
}

export function PluginSummary({ plugins, selected }: PluginSummaryProps): React.ReactElement {
  const stats = getPluginStats(plugins);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={selected ? "cyan" : "gray"}>  Plugins</Text>
        {selected && <Text color="cyan"> ▸</Text>}
      </Box>
      <Box marginLeft={4} flexDirection="row" gap={2}>
        <Text color="white">{stats.total}</Text>
        <Text color="gray">total</Text>
        <Text color="gray">·</Text>
        <Text color="green">{stats.installed}</Text>
        <Text color="gray">installed</Text>
        <Text color="gray">·</Text>
        <Text color="yellow">{stats.notInstalled}</Text>
        <Text color="gray">available</Text>
        {stats.incomplete > 0 && (
          <>
            <Text color="gray">·</Text>
            <Text color="magenta">{stats.incomplete}</Text>
            <Text color="gray">incomplete</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
