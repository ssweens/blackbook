import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useStore } from "../lib/store.js";

const COLORS: Record<import("../lib/types.js").Notification["type"], string> = {
  info: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
};

// Every notification is sticky — dismissed only by a keystroke (see App.tsx's
// global input handler), never by a timer. A spinner notification is still
// in flight and isn't dismissible at all until its owner clears it.
export function Notifications() {
  const notifications = useStore((s) => s.notifications);

  if (notifications.length === 0) return null;

  const latest = notifications.slice(-3);
  const hasDismissible = latest.some((n) => !n.spinner);

  return (
    <Box flexDirection="column" marginY={1}>
      {latest.map((n) => (
        <Box key={n.id}>
          {n.spinner && (
            <>
              <Text color={COLORS[n.type]}>
                <Spinner type="dots" />
              </Text>
              <Text> </Text>
            </>
          )}
          <Text color={COLORS[n.type]}>{n.message}</Text>
        </Box>
      ))}
      {hasDismissible && (
        <Box>
          <Text color="gray">Press any key to dismiss</Text>
        </Box>
      )}
    </Box>
  );
}
