import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface StatusBarProps {
  loading: boolean;
  message?: string;
  error?: string | null;
  enabledTools: string[];
}

export function StatusBar({ loading, message, error, enabledTools }: StatusBarProps) {
  const toolsLabel = enabledTools.length > 0
    ? `Tools: ${enabledTools.join(", ")}`
    : "Tools: none";
  const statusText = message ? `${message} · ${toolsLabel}` : toolsLabel;

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
