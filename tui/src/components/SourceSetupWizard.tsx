import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface SourceSetupWizardProps {
  onComplete: (source: string) => Promise<void> | void;
  onSkip: () => void;
}

type Step = "confirm" | "input" | "running";

export function SourceSetupWizard({ onComplete, onSkip }: SourceSetupWizardProps) {
  const [step, setStep] = useState<Step>("confirm");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (step === "running") return;

    if (key.escape) {
      onSkip();
      return;
    }

    if (step === "confirm") {
      if (input.toLowerCase() === "n") {
        onSkip();
        return;
      }
      if (input.toLowerCase() === "y" || key.return) {
        setStep("input");
      }
      return;
    }

    if (step === "input" && key.return) {
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Enter a local path or git URL.");
        return;
      }
      setError(null);
      setStep("running");
      Promise.resolve(onComplete(trimmed)).catch((e) => {
        setStep("input");
        setError(e instanceof Error ? e.message : String(e));
      });
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Setup source repository</Text>
      </Box>

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text>Add a source repo/directory now?</Text>
          <Text color="gray">We can clone a git repo or reference a local path.</Text>
          <Text color="gray">If it contains blackbook config.yaml, we’ll use it.</Text>
          <Text color="gray" italic>Y/Enter continue · N/Esc skip</Text>
        </Box>
      )}

      {step === "input" && (
        <Box flexDirection="column">
          <Text>Enter local path or git URL:</Text>
          <Text color="gray">Examples: /path/to/playbook-config · https://github.com/org/repo.git</Text>
          <TextInput value={value} onChange={setValue} />
          {error && <Text color="red">{error}</Text>}
          <Text color="gray" italic>Enter confirm · Esc skip</Text>
        </Box>
      )}

      {step === "running" && (
        <Box>
          <Text color="cyan">⠋ Configuring source…</Text>
        </Box>
      )}
    </Box>
  );
}
