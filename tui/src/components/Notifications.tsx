import React, { useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Notification } from "../lib/types.js";

interface NotificationsProps {
  notifications: Notification[];
  onClear: (id: string) => void;
}

const COLORS: Record<Notification["type"], string> = {
  info: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
};

const STICKY_TYPES: Set<Notification["type"]> = new Set(["error", "warning"]);

export function Notifications({ notifications, onClear }: NotificationsProps) {
  useEffect(() => {
    const timers = notifications
      .filter((n) => !STICKY_TYPES.has(n.type) && !n.spinner)
      .map((n) => {
        const age = Date.now() - n.timestamp;
        const remaining = Math.max(0, 4000 - age);
        return setTimeout(() => onClear(n.id), remaining);
      });

    return () => timers.forEach(clearTimeout);
  }, [notifications, onClear]);

  if (notifications.length === 0) return null;

  const latest = notifications.slice(-3);
  const hasSticky = latest.some((n) => STICKY_TYPES.has(n.type));

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
      {hasSticky && (
        <Box>
          <Text color="gray">Press any key to dismiss</Text>
        </Box>
      )}
    </Box>
  );
}
