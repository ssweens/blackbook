/**
 * Notification bar — stacked toasts at the bottom of the screen.
 */

import React from "react";
import { Box, Text } from "ink";
import type { PlaybookNotification } from "../lib/playbook-store.js";

export function NotificationsBar({
  notifications,
  onDismiss,
}: {
  notifications: PlaybookNotification[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={2}>
      {notifications.slice(-3).map((n) => (
        <Box key={n.id}>
          <Text
            color={
              n.level === "error"
                ? "red"
                : n.level === "warning"
                ? "yellow"
                : n.level === "success"
                ? "green"
                : "cyan"
            }
          >
            [{n.level}] {n.message}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
