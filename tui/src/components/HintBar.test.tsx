import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { HintBar } from "./HintBar.js";

// Regression: HintBar's content row was unbounded — a long enough hint (the
// Tools tab's dynamic `toolsHint` in particular) wraps to a second physical
// line at typical terminal widths, but CHROME_ROWS only budgets 1 row for
// HintBar. That silent wrap pushed the whole frame over the terminal's row
// count and made Ink fall back to a full-screen clearTerminal + redraw on
// every re-render (visible as flicker).
describe("HintBar", () => {
  it("stays on exactly one content line for the longest static hint", () => {
    const { lastFrame } = render(<HintBar tab="tools" hasDetail={false} />);
    // border-top line + text line = 2 non-blank rows (paddingTop renders as a
    // blank row, filtered out below); the hint text itself must never wrap.
    const lines = (lastFrame() ?? "").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(2);
  });

  it("stays on exactly one content line for a very long dynamic toolsHint", () => {
    const { lastFrame } = render(
      <HintBar tab="tools" hasDetail={false} toolsHint={"x".repeat(300)} />,
    );
    const lines = (lastFrame() ?? "").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(2);
  });
});
