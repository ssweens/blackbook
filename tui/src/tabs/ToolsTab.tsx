import React, { useEffect } from "react";
import { useStore } from "../lib/store.js";
import { ToolsList } from "../components/ToolsList.js";

export function ToolsTab() {
  const managedTools = useStore((s) => s.managedTools);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const toolDetection = useStore((s) => s.toolDetection);
  const toolDetectionPending = useStore((s) => s.toolDetectionPending);
  const toolActionInProgress = useStore((s) => s.toolActionInProgress);
  const refreshManagedTools = useStore((s) => s.refreshManagedTools);
  const refreshToolDetection = useStore((s) => s.refreshToolDetection);

  useEffect(() => {
    refreshManagedTools();
    void refreshToolDetection();
  }, [refreshManagedTools, refreshToolDetection]);

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
