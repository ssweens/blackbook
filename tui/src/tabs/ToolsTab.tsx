import React from "react";
import { useStore } from "../lib/store.js";
import { ToolsList } from "../components/ToolsList.js";

export function ToolsTab() {
  const managedTools = useStore((s) => s.managedTools);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const toolDetection = useStore((s) => s.toolDetection);
  const toolDetectionPending = useStore((s) => s.toolDetectionPending);
  const toolActionInProgress = useStore((s) => s.toolActionInProgress);
  return (
    <ToolsList
      tools={managedTools}
      selectedIndex={selectedIndex}
      detection={toolDetection}
      detectionPending={toolDetectionPending}
      actionInProgress={toolActionInProgress}
    />
  );
}
