import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MissingSummary as MissingSummaryType, DiffInstanceRef } from "../lib/types.js";
import { DiffInstanceList } from "./DiffInstanceList.js";

interface MissingSummaryViewProps {
  summary: MissingSummaryType;
  instances: DiffInstanceRef[];
  onSelectInstance: (instance: DiffInstanceRef) => void;
  onClose: () => void;
}

type Section = "missing" | "extra";

export function MissingSummaryView({
  summary,
  instances,
  onSelectInstance,
  onClose,
}: MissingSummaryViewProps) {
  const initialStep: "instance" | "summary" = instances.length > 1 ? "instance" : "summary";
  const [step, setStep] = useState<"instance" | "summary">(initialStep);
  const [section, setSection] = useState<Section>("missing");
  const [selectedMissing, setSelectedMissing] = useState(0);
  const [selectedExtra, setSelectedExtra] = useState(0);

  const hasMissing = summary.missingFiles.length > 0;
  const hasExtra = summary.extraFiles.length > 0;

  useInput((input, key) => {
    if (step === "instance") {
      // Instance list handles its own input
      return;
    }

    if (key.escape) {
      if (instances.length > 1) {
        setStep("instance");
      } else {
        onClose();
      }
      return;
    }

    if (key.tab) {
      if (hasMissing && hasExtra) {
        setSection((s) => (s === "missing" ? "extra" : "missing"));
      }
      return;
    }

    if (key.upArrow) {
      if (section === "missing" && hasMissing) {
        setSelectedMissing((i) => Math.max(0, i - 1));
      } else if (section === "extra" && hasExtra) {
        setSelectedExtra((i) => Math.max(0, i - 1));
      }
      return;
    }

    if (key.downArrow) {
      if (section === "missing" && hasMissing) {
        setSelectedMissing((i) => Math.min(summary.missingFiles.length - 1, i + 1));
      } else if (section === "extra" && hasExtra) {
        setSelectedExtra((i) => Math.min(summary.extraFiles.length - 1, i + 1));
      }
    }
  });

  if (step === "instance") {
    return (
      <DiffInstanceList
        title={summary.title}
        instances={instances}
        onSelect={(instance) => {
          onSelectInstance(instance);
          setStep("summary");
        }}
        onClose={onClose}
      />
    );
  }

  // Empty summary
  if (!hasMissing && !hasExtra) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Missing Summary · {summary.title} · {summary.instance.instanceName}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="green">✓ All files are present.</Text>
        </Box>
        <Box>
          <Text color="gray">Esc back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Missing Summary · {summary.title} · {summary.instance.instanceName}</Text>
      </Box>

      {hasMissing && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text bold color={section === "missing" ? "green" : "gray"}>
              Missing files ({summary.missingFiles.length}):
            </Text>
          </Box>
          <Box flexDirection="column">
            {summary.missingFiles.map((file, i) => (
              <Box key={file}>
                <Text color={section === "missing" && i === selectedMissing ? "cyan" : "white"}>
                  {section === "missing" && i === selectedMissing ? "❯ " : "  "}
                  {file}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {hasExtra && (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text bold color={section === "extra" ? "red" : "gray"}>
              Extra files ({summary.extraFiles.length}):
            </Text>
          </Box>
          <Box flexDirection="column">
            {summary.extraFiles.map((file, i) => (
              <Box key={file}>
                <Text color={section === "extra" && i === selectedExtra ? "cyan" : "white"}>
                  {section === "extra" && i === selectedExtra ? "❯ " : "  "}
                  {file}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          ↑/↓ move
          {hasMissing && hasExtra && " · Tab switch section"}
          {" · Esc back"}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Notes:
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          - This item is missing, not drifted, so no diff content is available.
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          - Sync will copy missing files from the configured source(s).
        </Text>
      </Box>
    </Box>
  );
}
