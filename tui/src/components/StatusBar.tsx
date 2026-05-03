import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useStore } from "../lib/store.js";

export function StatusBar() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const tools = useStore((s) => s.tools);
  // Use primitive selectors to avoid new object references on every store change
  const marketplacesCount = useStore((s) => s.marketplaces.length);
  const pluginsCount = useStore((s) =>
    s.marketplaces.reduce((sum, m) => sum + m.plugins.length, 0)
  );
  const piPackagesCount = useStore((s) => s.piPackages.length);
  const filesCount = useStore((s) => s.files.length);

  const enabledTools = tools.filter((t) => t.enabled).map((t) => t.name);
  const toolsLabel = enabledTools.length > 0
    ? `Tools: ${enabledTools.join(", ")}`
    : "Tools: none";
  const statusText = loading
    ? `Loading... · ${toolsLabel}`
    : `${pluginsCount} plugins, ${piPackagesCount} pi-pkgs, ${filesCount} files from ${marketplacesCount} marketplaces · ${toolsLabel}`;

  return (
    <Box>
      {loading && (
        <>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> </Text>
        </>
      )}
      {error ? (
        <>
          <Text color="red">{error}</Text>
          <Text color="gray"> · {toolsLabel}</Text>
        </>
      ) : (
        <Text color="gray">{statusText}</Text>
      )}
    </Box>
  );
}
