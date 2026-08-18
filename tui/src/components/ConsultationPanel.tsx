import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { ConsultationProposal, ConsultationResponse } from "../lib/consultation-context.js";

const MAX_RESPONSE_TEXT_LENGTH = 480;
const MAX_PROPOSAL_REASON_LENGTH = 480;
const RESULT_VIEWPORT_CHROME_ROWS = 20;
const FOLLOW_UP_VIEWPORT_CHROME_ROWS = 25;
export type ConsultationPanelState =
  | { phase: "prompt"; initialPrompt?: string }
  | { phase: "running"; prompt: string }
  | { phase: "result"; prompt: string; response: ConsultationResponse }
  | { phase: "error"; prompt: string; message: string };

export interface ConsultationPanelProps {
  state: ConsultationPanelState;
  selectedProposalIds: readonly string[];
  onSubmit: (prompt: string) => void;
  onContinue: (prompt: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onToggleProposal: (proposalId: string) => void;
  onAccept: (proposalIds: string[]) => void;
  turnCount?: number;
}

interface ResultLine {
  id: string;
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

interface ResultLineSet {
  lines: ResultLine[];
  proposalLineIndexes: number[];
}

function displayText(value: string, maximumLength: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maximumLength
    ? `${normalized.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`
    : normalized;
}

function displayProposalTarget(proposal: ConsultationProposal): string {
  if (proposal.targetLabel) return proposal.targetLabel;
  const action = proposal.operation.replace("_", " ");
  if (proposal.target.startsWith("available-project-skill:")) {
    return `${action} ${proposal.target.slice("available-project-skill:".length)} in project`;
  }
  if (proposal.target.startsWith("project-skill:")) {
    return `${action} ${proposal.target.slice("project-skill:".length)} in project`;
  }
  if (proposal.target.startsWith("profile-member:")) {
    return `${action} ${proposal.target.slice("profile-member:".length)} in profile`;
  }
  if (proposal.target.startsWith("plugin-component:")) {
    const [, kind, name] = proposal.target.split(":", 3);
    return `${action} ${kind} ${name}`;
  }
  if (proposal.target === "plugin") return `${action} installed plugin`;
  if (proposal.target === "skill") return `${action} installed skill`;
  return proposal.operation === "select_action" ? "Review selected action" : action;
}

function takeWrappedLine(value: string, maximumLength: number): [line: string, rest: string] {
  if (value.length <= maximumLength) return [value, ""];
  const boundary = value.lastIndexOf(" ", maximumLength);
  const splitAt = boundary > 0 ? boundary : maximumLength;
  return [value.slice(0, splitAt).trimEnd(), value.slice(splitAt).trimStart()];
}

function appendWrappedLines(
  lines: ResultLine[],
  {
    id,
    value,
    width,
    firstPrefix = "",
    continuationPrefix = firstPrefix,
    color,
    bold,
    dimColor,
  }: {
    id: string;
    value: string;
    width: number;
    firstPrefix?: string;
    continuationPrefix?: string;
    color?: string;
    bold?: boolean;
    dimColor?: boolean;
  },
): number {
  const start = lines.length;
  let remaining = value || "—";
  let prefix = firstPrefix;
  let index = 0;

  do {
    const [line, rest] = takeWrappedLine(remaining, Math.max(8, width - prefix.length));
    lines.push({
      id: `${id}-${index}`,
      text: `${prefix}${line}`,
      color,
      bold,
      dimColor,
    });
    remaining = rest;
    prefix = continuationPrefix;
    index += 1;
  } while (remaining.length > 0);

  return start;
}

function appendAssessmentField(
  lines: ResultLine[],
  id: string,
  label: string,
  value: string,
  width: number,
): void {
  lines.push({ id: `${id}-label`, text: `  ${label}`, bold: true });
  appendWrappedLines(lines, {
    id: `${id}-content`,
    value: displayText(value, MAX_RESPONSE_TEXT_LENGTH),
    width,
    firstPrefix: "    ",
  });
}

function buildResultLines(
  response: ConsultationResponse,
  proposals: readonly ConsultationProposal[],
  selectedIds: ReadonlySet<string>,
  selectedIndex: number,
  width: number,
): ResultLineSet {
  const lines: ResultLine[] = [];
  const proposalLineIndexes: number[] = [];

  lines.push({ id: "ready", text: "The advisor’s recommendations are ready.", color: "green" });
  lines.push({ id: "ready-gap", text: "" });
  lines.push({ id: "recommendation-heading", text: "Recommendation", bold: true });
  appendWrappedLines(lines, {
    id: "recommendation-content",
    value: displayText(response.summary, MAX_RESPONSE_TEXT_LENGTH),
    width,
    firstPrefix: "  ",
  });

  lines.push({ id: "assessment-gap", text: "" });
  lines.push({ id: "assessment-heading", text: "Assessment", bold: true });
  appendAssessmentField(lines, "what-changed", "What changed", response.analysis.whatChanged, width);
  appendAssessmentField(lines, "recency", "Recency", response.analysis.recency, width);
  appendAssessmentField(lines, "why", "Why this is safest", response.analysis.assessment, width);

  const recommendedProposal = response.analysis.recommendedProposalId
    ? proposals.find((proposal) => proposal.id === response.analysis.recommendedProposalId)
    : null;
  lines.push({ id: "recommended-gap", text: "" });
  lines.push({ id: "recommended-heading", text: "Recommended action", bold: true });
  appendWrappedLines(lines, {
    id: "recommended-content",
    value: recommendedProposal
      ? displayText(displayProposalTarget(recommendedProposal), MAX_RESPONSE_TEXT_LENGTH)
      : "Keep the current state",
    width,
    firstPrefix: "  ",
    color: "cyan",
  });

  lines.push({ id: "proposals-gap", text: "" });
  lines.push({ id: "proposals-heading", text: "Proposals", bold: true });
  if (proposals.length === 0) {
    lines.push({ id: "no-proposals", text: "  The advisor did not suggest any actions.", color: "gray" });
  } else {
    proposals.forEach((proposal, index) => {
      const active = index === selectedIndex;
      const selected = selectedIds.has(proposal.id);
      const recommended = proposal.id === response.analysis.recommendedProposalId;
      const target = displayText(displayProposalTarget(proposal), MAX_RESPONSE_TEXT_LENGTH);
      const action = proposal.operation.replace("_", " ");
      proposalLineIndexes.push(appendWrappedLines(lines, {
        id: `proposal-${proposal.id}`,
        value: `${active ? "❯ " : "  "}[${selected ? "x" : " "}] ${target} · ${action}${recommended ? " · recommended" : ""}`,
        width,
        continuationPrefix: "    ",
        color: active ? "cyan" : undefined,
        bold: active,
      }));
      appendWrappedLines(lines, {
        id: `proposal-reason-${proposal.id}`,
        value: displayText(proposal.reason, MAX_PROPOSAL_REASON_LENGTH),
        width,
        firstPrefix: "    ",
        color: "gray",
        dimColor: true,
      });
    });
  }

  return { lines, proposalLineIndexes };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function ConsultationPanel({
  state,
  selectedProposalIds,
  onSubmit,
  onContinue,
  onCancel,
  onRetry,
  onToggleProposal,
  onAccept,
  turnCount = 0,
}: ConsultationPanelProps) {
  const { stdout } = useStdout();
  const initialPrompt = state.phase === "prompt" ? state.initialPrompt ?? "" : "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [resultScroll, setResultScroll] = useState(0);
  const previousSelectedProposalId = useRef<string | null>(null);
  const response = state.phase === "result" ? state.response : null;
  const proposals = response?.proposals ?? [];
  const proposalKey = proposals.map((proposal) => proposal.id).join("\u0000");
  const responseKey = response
    ? [
      response.summary,
      response.analysis.recommendedProposalId ?? "",
      response.analysis.whatChanged,
      response.analysis.recency,
      response.analysis.assessment,
      ...proposals.flatMap((proposal) => [proposal.id, proposal.reason]),
    ].join("\u0000")
    : "";
  const selectedIds = useMemo(() => new Set(selectedProposalIds), [selectedProposalIds]);
  const terminalRows = stdout?.rows ?? 24;
  const contentWidth = Math.max(20, (stdout?.columns ?? 80) - 6);
  const resultViewportRows = Math.max(
    3,
    terminalRows - (followUpOpen ? FOLLOW_UP_VIEWPORT_CHROME_ROWS : RESULT_VIEWPORT_CHROME_ROWS),
  );
  const resultLineSet = useMemo(
    () => response
      ? buildResultLines(response, proposals, selectedIds, selectedIndex, contentWidth)
      : { lines: [], proposalLineIndexes: [] },
    [contentWidth, proposals, response, selectedIds, selectedIndex],
  );
  const maximumResultScroll = Math.max(0, resultLineSet.lines.length - resultViewportRows);
  const visibleResultStart = clamp(resultScroll, 0, maximumResultScroll);
  const visibleResultLines = resultLineSet.lines.slice(
    visibleResultStart,
    visibleResultStart + resultViewportRows,
  );
  const selectedProposalId = proposals[selectedIndex]?.id ?? null;
  const selectedProposalLineIndex = selectedProposalId === null
    ? null
    : resultLineSet.proposalLineIndexes[selectedIndex] ?? null;

  useEffect(() => {
    setPrompt(initialPrompt);
    setFollowUpOpen(false);
    setFollowUpPrompt("");
  }, [initialPrompt, state.phase]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, proposals.length - 1)));
  }, [proposalKey, proposals.length]);

  useEffect(() => {
    setResultScroll(0);
  }, [responseKey]);

  useEffect(() => {
    if (state.phase !== "result" || selectedProposalId === null || selectedProposalLineIndex === null) {
      previousSelectedProposalId.current = null;
      return;
    }
    const previous = previousSelectedProposalId.current;
    previousSelectedProposalId.current = selectedProposalId;
    if (previous === null || previous === selectedProposalId) return;

    setResultScroll((current) => {
      const scroll = clamp(current, 0, maximumResultScroll);
      if (selectedProposalLineIndex < scroll) return selectedProposalLineIndex;
      if (selectedProposalLineIndex >= scroll + resultViewportRows) {
        return selectedProposalLineIndex - resultViewportRows + 1;
      }
      return scroll;
    });
  }, [maximumResultScroll, resultViewportRows, selectedProposalId, selectedProposalLineIndex, state.phase]);

  const submitPrompt = () => {
    onSubmit(prompt.trim());
  };

  const scrollResult = (amount: number) => {
    setResultScroll((current) => clamp(current + amount, 0, maximumResultScroll));
  };

  useInput((input, key) => {
    if (state.phase === "result" && followUpOpen) {
      if (key.escape) {
        setFollowUpOpen(false);
        setFollowUpPrompt("");
      } else if (key.return) {
        setFollowUpOpen(false);
        onContinue(followUpPrompt.trim());
      }
      return;
    }

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

    if (key.pageUp || (key.ctrl && input === "u")) {
      scrollResult(-resultViewportRows);
      return;
    }
    if (key.pageDown || (key.ctrl && input === "d")) {
      scrollResult(resultViewportRows);
      return;
    }
    if (key.home) {
      setResultScroll(0);
      return;
    }
    if (key.end) {
      setResultScroll(maximumResultScroll);
      return;
    }
    if (input === "c") {
      setFollowUpOpen(true);
      setFollowUpPrompt("");
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
      if (selectedProposalLineIndex !== null) {
        setResultScroll((current) => {
          const scroll = clamp(current, 0, maximumResultScroll);
          if (selectedProposalLineIndex < scroll) return selectedProposalLineIndex;
          if (selectedProposalLineIndex >= scroll + resultViewportRows) {
            return selectedProposalLineIndex - resultViewportRows + 1;
          }
          return scroll;
        });
      }
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
        {turnCount > 0 && <Text color="gray"> · turn {turnCount}</Text>}
      </Box>

      {state.phase === "prompt" && (
        <>
          <Text>What would you like the advisor to review?</Text>
          <Box marginTop={1} marginBottom={1}>
            <TextInput
              value={prompt}
              onChange={setPrompt}
              placeholder="Ask for recommendations… (optional)"
            />
          </Box>
          <Text color="gray" italic>Enter to consult advisor · Esc to cancel</Text>
        </>
      )}

      {state.phase === "running" && (
        <>
          <Text color="cyan">The advisor is reviewing your request…</Text>
          <Box marginTop={1}>
            <Text color="gray" wrap="truncate">{displayText(state.prompt, MAX_RESPONSE_TEXT_LENGTH)}</Text>
          </Box>
          <Text color="gray" italic>Esc to cancel</Text>
        </>
      )}

      {state.phase === "error" && (
        <>
          <Text color="red">The advisor could not complete this consultation.</Text>
          <Box marginTop={1} marginBottom={1}>
            <Text color="gray" wrap="wrap">{displayText(state.message, MAX_RESPONSE_TEXT_LENGTH)}</Text>
          </Box>
          <Text color="gray" italic>Enter to retry · Esc to cancel</Text>
        </>
      )}

      {state.phase === "result" && (
        <>
          <Box flexDirection="column">
            {visibleResultStart > 0 && (
              <Text color="gray" dimColor>↑ more response above</Text>
            )}
            {visibleResultLines.map((line) => (
              <Text
                key={line.id}
                color={line.color}
                bold={line.bold}
                dimColor={line.dimColor}
                wrap="truncate"
              >
                {line.text}
              </Text>
            ))}
            {visibleResultStart + visibleResultLines.length < resultLineSet.lines.length && (
              <Text color="gray" dimColor>↓ more response below</Text>
            )}
          </Box>

          {followUpOpen && (
            <Box flexDirection="column" marginTop={1} marginBottom={1}>
              <Text bold>Ask a follow-up</Text>
              <Box marginTop={1}>
                <TextInput
                  value={followUpPrompt}
                  onChange={setFollowUpPrompt}
                  placeholder="Ask another question… (optional)"
                />
              </Box>
              <Text color="gray" italic>Enter to continue · Esc to return to recommendations</Text>
            </Box>
          )}

          {!followUpOpen && (
            <Text color="gray" italic wrap="truncate">
              {maximumResultScroll > 0 ? "PgUp/PgDn read · " : ""}
              {proposals.length > 0
                ? "↑↓ select · Space toggle · Enter accept selected · c continue · Esc to close"
                : "c continue · Esc to close"}
            </Text>
          )}
        </>
      )}
    </Box>
  );
}
