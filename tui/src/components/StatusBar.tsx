import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface StatusBarProps {
  loading: boolean;
  message?: string;
  error?: string | null;
}

export function StatusBar({ loading, message, error }: StatusBarProps) {
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
        <Text color="red">{error}</Text>
      ) : (
        <Text color="gray">{message || ""}</Text>
      )}
    </Box>
  );
}
