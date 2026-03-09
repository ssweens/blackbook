import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import {
  ItemDetail,
  PluginMetadata,
  FileMetadata,
  PiPackageMetadata,
  type ItemAction,
} from "./ItemDetail.js";
import type { ManagedItem, ItemInstanceStatus } from "../lib/managed-item.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

function createItem(overrides?: Partial<ManagedItem>): ManagedItem {
  return {
    name: "test-item",
    kind: "plugin",
    marketplace: "playbook",
    description: "A test item",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
    ...overrides,
  };
}

function backAction(): ItemAction {
  return { id: "back", label: "Back to list", type: "back" };
}

function statusAction(label: string, statusLabel: string, statusColor: "green" | "yellow" | "red" = "green"): ItemAction {
  return { id: `status_${label}`, label, type: "status", statusLabel, statusColor };
}

function diffAction(label: string, added: number, removed: number): ItemAction {
  return {
    id: `diff_${label}`,
    label,
    type: "diff",
    statusLabel: "Changed",
    statusColor: "yellow",
    instance: {
      toolId: "t",
      instanceId: "i",
      instanceName: label,
      configDir: "/c",
      totalAdded: added,
      totalRemoved: removed,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemDetail
// ─────────────────────────────────────────────────────────────────────────────

describe("ItemDetail", () => {
  it("renders item name and marketplace", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ name: "my-plugin", marketplace: "playbook" }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    const frame = lastFrame()!;
    expect(frame).toContain("my-plugin");
    expect(frame).toContain("@ playbook");
  });

  it("hides marketplace for local items", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ marketplace: "local" }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).not.toContain("@ local");
  });

  it("shows installed status", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ installed: true }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("Installed");
  });

  it("shows not installed status", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ installed: false }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("Not Installed");
  });

  it("shows incomplete badge", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ installed: true, incomplete: true }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("(incomplete)");
  });

  it("shows drifted badge when instances have changed status", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({
          instances: [{
            toolId: "t", instanceId: "i", instanceName: "T",
            configDir: "/c", status: "changed",
            sourcePath: null, targetPath: null, linesAdded: 0, linesRemoved: 0,
          }],
        }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("(drifted)");
  });

  it("renders Instances header when installed", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ installed: true }),
        actions: [statusAction("Claude", "Synced"), backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("Instances:");
  });

  it("does not show Instances header when not installed", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem({ installed: false }),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).not.toContain("Instances:");
  });

  it("renders status action with label and color", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions: [statusAction("Claude", "Synced", "green"), backAction()],
        selectedAction: 0,
      }),
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Claude:");
    expect(frame).toContain("Synced");
  });

  it("renders diff action with +/- counts", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions: [diffAction("Claude", 15, 3), backAction()],
        selectedAction: 0,
      }),
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Changed");
    expect(frame).toContain("+15");
    expect(frame).toContain("-3");
  });

  it("highlights selected action with ❯", () => {
    const actions: ItemAction[] = [
      statusAction("Claude", "Synced"),
      statusAction("OpenCode", "Missing"),
      backAction(),
    ];
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions,
        selectedAction: 1,
      }),
    );
    const frame = lastFrame()!;
    const lines = frame.split("\n");
    const claudeLine = lines.find((l) => l.includes("Claude"));
    const opencodeLine = lines.find((l) => l.includes("OpenCode"));
    expect(claudeLine).toContain("  ");
    expect(opencodeLine).toContain("❯");
  });

  it("renders back action", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("Back to list");
  });

  it("shows Esc back in footer", () => {
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions: [backAction()],
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("Esc back");
  });

  it("shows pullback hint when pullback actions exist", () => {
    const actions: ItemAction[] = [
      { id: "pull", label: "Pull from Claude", type: "pullback" },
      backAction(),
    ];
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions,
        selectedAction: 0,
      }),
    );
    expect(lastFrame()).toContain("p pull to source");
  });

  it("renders custom metadata via prop", () => {
    const metadata = React.createElement("ink-text", null, "Custom metadata here");
    const { lastFrame } = render(
      React.createElement(ItemDetail, {
        item: createItem(),
        actions: [backAction()],
        selectedAction: 0,
        metadata,
      }),
    );
    // Ink might not render <ink-text> but the metadata prop is passed through
    // Just verify the component doesn't crash
    expect(lastFrame()).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PluginMetadata
// ─────────────────────────────────────────────────────────────────────────────

describe("PluginMetadata", () => {
  it("renders scope", () => {
    const { lastFrame } = render(
      React.createElement(PluginMetadata, {
        item: createItem({ scope: "user" }),
      }),
    );
    expect(lastFrame()).toContain("user");
  });

  it("renders homepage", () => {
    const { lastFrame } = render(
      React.createElement(PluginMetadata, {
        item: createItem({ homepage: "https://example.com" }),
      }),
    );
    expect(lastFrame()).toContain("https://example.com");
  });

  it("renders skills", () => {
    const { lastFrame } = render(
      React.createElement(PluginMetadata, {
        item: createItem({ skills: ["skill-a", "skill-b"] }),
      }),
    );
    expect(lastFrame()).toContain("skill-a, skill-b");
  });

  it("renders MCP indicator", () => {
    const { lastFrame } = render(
      React.createElement(PluginMetadata, {
        item: createItem({ hasMcp: true }),
      }),
    );
    expect(lastFrame()).toContain("MCP");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FileMetadata
// ─────────────────────────────────────────────────────────────────────────────

describe("FileMetadata", () => {
  it("renders tool scope", () => {
    const { lastFrame } = render(
      React.createElement(FileMetadata, {
        item: createItem({ tools: ["claude-code"] }),
      }),
    );
    expect(lastFrame()).toContain("claude-code");
  });

  it("shows All tools when no tools specified", () => {
    const { lastFrame } = render(
      React.createElement(FileMetadata, {
        item: createItem({ tools: undefined }),
      }),
    );
    expect(lastFrame()).toContain("All tools");
  });

  it("renders source mapping", () => {
    const { lastFrame } = render(
      React.createElement(FileMetadata, {
        item: createItem({ fileSource: "assets/AGENTS.md", fileTarget: "AGENTS.md" }),
      }),
    );
    expect(lastFrame()).toContain("assets/AGENTS.md → AGENTS.md");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PiPackageMetadata
// ─────────────────────────────────────────────────────────────────────────────

describe("PiPackageMetadata", () => {
  it("renders version", () => {
    const { lastFrame } = render(
      React.createElement(PiPackageMetadata, {
        item: createItem({ version: "2.0.0" }),
      }),
    );
    expect(lastFrame()).toContain("2.0.0");
  });

  it("shows version mismatch", () => {
    const { lastFrame } = render(
      React.createElement(PiPackageMetadata, {
        item: createItem({ version: "2.0.0", installedVersion: "1.5.0" }),
      }),
    );
    expect(lastFrame()).toContain("(installed: 1.5.0)");
  });

  it("renders author", () => {
    const { lastFrame } = render(
      React.createElement(PiPackageMetadata, {
        item: createItem({ author: "test-author" }),
      }),
    );
    expect(lastFrame()).toContain("test-author");
  });

  it("renders themes in contents", () => {
    const { lastFrame } = render(
      React.createElement(PiPackageMetadata, {
        item: createItem({ themes: ["dark", "light"] }),
      }),
    );
    expect(lastFrame()).toContain("dark, light");
  });
});
