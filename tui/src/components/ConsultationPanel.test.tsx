import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConsultationPanel } from "./ConsultationPanel.js";

const callbacks = () => ({
  onSubmit: vi.fn(),
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
            proposals: [
              {
                id: "install-search",
                operation: "install",
                target: "search-tools",
                reason: "It fills a gap in the current marketplace.",
              },
              {
                id: "disable-legacy",
                operation: "disable",
                target: "legacy-helper",
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
    expect(lastFrame()).toContain("search-tools");

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
});
