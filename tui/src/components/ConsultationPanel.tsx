import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ConsultationProposal, ConsultationResponse } from "../lib/consultation-context.js";

const DEFAULT_VISIBLE_PROPOSALS = 6;
const MAX_SUMMARY_LENGTH = 480;
const MAX_REASON_LENGTH = 180;

export type ConsultationPanelState =
  | { phase: "prompt"; initialPrompt?: string }
  | { phase: "running"; prompt: string }
  | { phase: "result"; prompt: string; response: ConsultationResponse }
  | { phase: "error"; prompt: string; message: string };

export interface ConsultationPanelProps {
  state: ConsultationPanelState;
  selectedProposalIds: readonly string[];
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onToggleProposal: (proposalId: string) => void;
  onAccept: (proposalIds: string[]) => void;
  maxVisibleProposals?: number;
}

function displayText(value: string, maximumLength: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maximumLength
    ? `${normalized.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`
    : normalized;
}

function proposalViewport(
  proposalCount: number,
  selectedIndex: number,
  visibleCount: number,
): { start: number; end: number } {
  const maxStart = Math.max(0, proposalCount - visibleCount);
  const start = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2)),
    maxStart,
  );
  return { start, end: Math.min(proposalCount, start + visibleCount) };
}

function ProposalRow({
  proposal,
  active,
  selected,
}: {
  proposal: ConsultationProposal;
  active: boolean;
  selected: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text color={active ? "cyan" : undefined} bold={active} wrap="truncate">
        {active ? "❯ " : "  "}[{selected ? "x" : " "}] {displayText(proposal.targetLabel ?? proposal.target, MAX_REASON_LENGTH)} · {proposal.operation.replace("_", " ")}
      </Text>
      <Box marginLeft={4}>
        <Text color="gray" wrap="truncate">{displayText(proposal.reason, MAX_REASON_LENGTH)}</Text>
      </Box>
    </Box>
  );
}

export function ConsultationPanel({
  state,
  selectedProposalIds,
  onSubmit,
  onCancel,
  onRetry,
  onToggleProposal,
  onAccept,
  maxVisibleProposals = DEFAULT_VISIBLE_PROPOSALS,
}: ConsultationPanelProps) {
  const initialPrompt = state.phase === "prompt" ? state.initialPrompt ?? "" : "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const visibleCount = Math.max(1, Math.floor(maxVisibleProposals));
  const response = state.phase === "result" ? state.response : null;
  const proposals = response?.proposals ?? [];
  const proposalKey = proposals.map((proposal) => proposal.id).join("\u0000");

  useEffect(() => {
    setPrompt(initialPrompt);
    setPromptError(null);
  }, [initialPrompt, state.phase]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, proposals.length - 1)));
  }, [proposalKey, proposals.length]);

  const selectedIds = useMemo(() => new Set(selectedProposalIds), [selectedProposalIds]);
  const viewport = proposalViewport(proposals.length, selectedIndex, visibleCount);
  const visibleProposals = proposals.slice(viewport.start, viewport.end);

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setPromptError("Enter a question for the advisor before continuing.");
      return;
    }
    setPromptError(null);
    onSubmit(trimmed);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (state.phase === "prompt") {
      if (key.return) submitPrompt();
      return;
    }

    if (state.phase === "running") return;

    if (state.phase === "error") {
      if (key.return) onRetry();
      return;
    }

    if (proposals.length === 0) return;

    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => Math.min(proposals.length - 1, current + 1));
      return;
    }
    if (input === " ") {
      onToggleProposal(proposals[selectedIndex].id);
      return;
    }
    if (key.return && selectedProposalIds.length > 0) {
      onAccept([...selectedProposalIds]);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Consult advisor</Text>
        <Text color="gray"> · advisory only</Text>
      </Box>

      {state.phase === "prompt" && (
        <>
          <Text>What would you like the advisor to review?</Text>
          <Box marginTop={1} marginBottom={1}>
            <TextInput
              value={prompt}
              onChange={(value) => {
                setPrompt(value);
                if (promptError) setPromptError(null);
              }}
              placeholder="Ask for recommendations…"
            />
          </Box>
          {promptError && <Text color="red">{promptError}</Text>}
          <Text color="gray" italic>Enter to consult advisor · Esc to cancel</Text>
        </>
      )}

      {state.phase === "running" && (
        <>
          <Text color="cyan">The advisor is reviewing your request…</Text>
          <Box marginTop={1}>
            <Text color="gray" wrap="truncate">{displayText(state.prompt, MAX_REASON_LENGTH)}</Text>
          </Box>
          <Text color="gray" italic>Esc to cancel</Text>
        </>
      )}

      {state.phase === "error" && (
        <>
          <Text color="red">The advisor could not complete this consultation.</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text color="gray" wrap="wrap">{displayText(state.message, MAX_SUMMARY_LENGTH)}</Text>
          </Box>
          <Text color="gray" italic>Enter to retry · Esc to cancel</Text>
        </>
      )}

      {state.phase === "result" && (
        <>
          <Box flexDirection="column" marginBottom={1}>
            <Text color="green">The advisor’s recommendations are ready.</Text>
            <Text wrap="wrap">{displayText(state.response.summary, MAX_SUMMARY_LENGTH)}</Text>
          </Box>

          {proposals.length > 0 ? (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>Proposals</Text>
              {viewport.start > 0 && <Text color="gray">↑ more proposals above</Text>}
              {visibleProposals.map((proposal, offset) => (
                <ProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  active={viewport.start + offset === selectedIndex}
                  selected={selectedIds.has(proposal.id)}
                />
              ))}
              {viewport.end < proposals.length && <Text color="gray">↓ more proposals below</Text>}
            </Box>
          ) : (
            <Box marginBottom={1}>
              <Text color="gray">The advisor did not suggest any actions.</Text>
            </Box>
          )}

          <Text color="gray" italic>
            {proposals.length > 0
              ? "↑↓ select · Space toggle · Enter accept selected · Esc to close"
              : "Esc to close"}
          </Text>
        </>
      )}
    </Box>
  );
}
