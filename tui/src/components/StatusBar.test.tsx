import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";
import { useStore } from "../lib/store.js";
import type { ToolInstance } from "../lib/types.js";

function makeTool(name: string): ToolInstance {
  return {
    toolId: name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
    instanceId: "default",
    name,
    configDir: `/tmp/${name}`,
    skillsSubdir: "skills",
    commandsSubdir: "commands",
    agentsSubdir: "agents",
    enabled: true,
    kind: "tool",
    pluginFlatInstall: false,
  };
}

// Regression: the status line's text (plugin/package/file counts + the full
// enabled-tools list) is unbounded — with enough enabled tools it exceeds the
// terminal width and used to wrap to a second physical line. CHROME_ROWS only
// budgets 1 row for StatusBar, so that silent wrap pushed the whole frame
// over the terminal's row count and made Ink fall back to a full-screen
// clearTerminal + redraw on every re-render (visible as flicker).
describe("StatusBar", () => {
  it("stays on exactly one line even with many enabled tools", () => {
    useStore.setState({
      loading: false,
      error: null,
      tools: [
        makeTool("Claude"),
        makeTool("Claude (Learning)"),
        makeTool("OpenCode"),
        makeTool("Amp"),
        makeTool("Codex"),
        makeTool("Pi"),
        makeTool("Blackbook"),
        makeTool("Another Very Long Tool Name Here"),
        makeTool("And Yet One More Extremely Long Tool Name"),
      ],
    });

    const { lastFrame } = render(<StatusBar />);
    const lines = (lastFrame() ?? "").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
  });

  it("stays on exactly one line for a long error message", () => {
    useStore.setState({
      loading: false,
      error: "A".repeat(300),
      tools: [makeTool("Claude")],
    });

    const { lastFrame } = render(<StatusBar />);
    const lines = (lastFrame() ?? "").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(1);
  });
});
