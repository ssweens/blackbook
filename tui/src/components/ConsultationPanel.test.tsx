import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConsultationPanel } from "./ConsultationPanel.js";

const callbacks = () => ({
  onSubmit: vi.fn(),
  onContinue: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onToggleProposal: vi.fn(),
  onAccept: vi.fn(),
});

describe("ConsultationPanel", () => {
  it("keeps result actions advisory while supporting keyboard selection", async () => {
    const handlers = callbacks();
    const { stdin, lastFrame } = render(
      <ConsultationPanel
        state={{
          phase: "result",
          prompt: "Which marketplace actions are worth taking?",
          response: {
            summary: "Review the proposed marketplace changes before applying them.",
            analysis: {
              recommendedProposalId: "install-search",
              whatChanged: "The requested search capability is not installed.",
              recency: "No timestamps were supplied for marketplace metadata.",
              assessment: "Install the focused capability; the legacy helper does not address the request.",
            },
            proposals: [
              {
                id: "install-search",
                operation: "install",
                target: "search-tools",
                targetLabel: "Install search tools",
                reason: "It fills a gap in the current marketplace.",
              },
              {
                id: "disable-legacy",
                operation: "disable",
                target: "legacy-helper",
                targetLabel: "Disable legacy helper",
                reason: "It overlaps with the current workflow.",
              },
            ],
          },
        }}
        selectedProposalIds={["disable-legacy"]}
        {...handlers}
      />,
    );

    expect(lastFrame()).toContain("Consult advisor");
    expect(lastFrame()).toContain("Install search tools");
    expect(lastFrame()).toContain("Advisor assessment");
    expect(lastFrame()).toContain("Recommended: Install search tools");
    expect(lastFrame()).toContain("What changed:");
    expect(lastFrame()).toContain("[recommended]");

    act(() => {
      stdin.write(" ");
    });
    act(() => {
      stdin.write("\u001B[B");
    });
    act(() => {
      stdin.write("\r");
    });
    act(() => {
      stdin.write("\u001B");
    });
    await vi.waitFor(() => {
      expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    });

    expect(handlers.onToggleProposal).toHaveBeenCalledWith("install-search");
    expect(handlers.onAccept).toHaveBeenCalledWith(["disable-legacy"]);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("opens a follow-up input without closing the consultation", async () => {
    const handlers = callbacks();
    const { stdin, lastFrame } = render(
      <ConsultationPanel
        state={{
          phase: "result",
          prompt: "",
          response: {
            summary: "Keep the current plugin state.",
            analysis: {
              recommendedProposalId: null,
              whatChanged: "The installed copy matches its source.",
              recency: "The copies have matching timestamps.",
              assessment: "No action is necessary.",
            },
            proposals: [],
          },
        }}
        selectedProposalIds={[]}
        turnCount={1}
        {...handlers}
      />,
    );

    act(() => {
      stdin.write("c");
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Ask a follow-up");
    });

    act(() => {
      stdin.write("\u001B");
    });
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain("Ask a follow-up");
    });
    expect(handlers.onCancel).not.toHaveBeenCalled();

    act(() => {
      stdin.write("c");
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Ask a follow-up");
    });
    act(() => {
      stdin.write("Why is no action necessary?");
    });
    act(() => {
      stdin.write("\r");
    });
    await vi.waitFor(() => {
      expect(handlers.onContinue).toHaveBeenCalledWith("Why is no action necessary?");
    });
  });
});
