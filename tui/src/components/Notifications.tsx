import React, { useEffect } from "react";
import { Box, Text } from "ink";
import type { Notification } from "../lib/types.js";

interface NotificationsProps {
  notifications: Notification[];
  onClear: (id: string) => void;
}

const COLORS: Record<Notification["type"], string> = {
  info: "cyan",
  success: "green",
  error: "red",
};

export function Notifications({ notifications, onClear }: NotificationsProps) {
  useEffect(() => {
    const timers = notifications.map((n) => {
      const age = Date.now() - n.timestamp;
      const remaining = Math.max(0, 4000 - age);
      return setTimeout(() => onClear(n.id), remaining);
    });

    return () => timers.forEach(clearTimeout);
  }, [notifications, onClear]);

  if (notifications.length === 0) return null;

  const latest = notifications.slice(-3);

  return (
    <Box flexDirection="column" marginY={1}>
      {latest.map((n) => (
        <Box key={n.id}>
          <Text color={COLORS[n.type]}>{n.message}</Text>
        </Box>
      ))}
    </Box>
  );
}
