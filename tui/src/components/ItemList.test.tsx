import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ItemList, computeItemFlags, PLUGIN_COLUMNS, FILE_COLUMNS, type ItemListProps } from "./ItemList.js";
import type { ManagedItem, ItemInstanceStatus } from "../lib/managed-item.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

function createItem(overrides?: Partial<ManagedItem>): ManagedItem {
  return {
    name: "test-plugin",
    kind: "plugin",
    marketplace: "playbook",
    description: "A test plugin",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
    _plugin: undefined,
    _file: undefined,
    _piPackage: undefined,
    ...overrides,
  };
}

function createInstance(overrides?: Partial<ItemInstanceStatus>): ItemInstanceStatus {
  return {
    toolId: "claude-code",
    instanceId: "main",
    instanceName: "Claude",
    configDir: "/home/user/.claude",
    status: "synced",
    sourcePath: null,
    targetPath: null,
    linesAdded: 0,
    linesRemoved: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeItemFlags
// ─────────────────────────────────────────────────────────────────────────────

describe("computeItemFlags", () => {
  it("returns all false for uninstalled item", () => {
    const flags = computeItemFlags(createItem({ installed: false, incomplete: false }));
    expect(flags).toEqual({
      installed: false,
      incomplete: false,
      changed: false,
      sourceMissing: false,
      hasUpdate: false,
      notInGit: false,
    });
  });

  it("returns installed for installed item", () => {
    const flags = computeItemFlags(createItem({ installed: true }));
    expect(flags.installed).toBe(true);
  });

  it("detects changed from instance status", () => {
    const flags = computeItemFlags(
      createItem({ instances: [createInstance({ status: "changed" })] }),
    );
    expect(flags.changed).toBe(true);
  });

  it("detects incomplete", () => {
    const flags = computeItemFlags(createItem({ installed: true, incomplete: true }));
    expect(flags.incomplete).toBe(true);
  });

  it("detects hasUpdate for pi-package", () => {
    const flags = computeItemFlags(createItem({ kind: "pi-package", hasUpdate: true }));
    expect(flags.hasUpdate).toBe(true);
  });

  it("detects source missing from _file instance messages", () => {
    const flags = computeItemFlags(
      createItem({
        _file: {
          name: "test",
          source: "test",
          target: "test",
          instances: [
            {
              toolId: "a",
              instanceId: "a1",
              instanceName: "A",
              configDir: "/x",
              targetRelPath: "test",
              sourcePath: "/missing",
              targetPath: "/x/test",
              status: "failed",
              message: "Source not found: /missing",
            },
          ],
          kind: "file",
        },
      }),
    );
    expect(flags.sourceMissing).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ItemList Rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("ItemList", () => {
  it("renders empty message when no items", () => {
    const { lastFrame } = render(
      React.createElement(ItemList, { items: [], selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("No items found");
  });

  it("renders custom empty message", () => {
    const { lastFrame } = render(
      React.createElement(ItemList, {
        items: [],
        selectedIndex: 0,
        emptyMessage: "Nothing here",
      }),
    );
    expect(lastFrame()).toContain("Nothing here");
  });

  it("renders plugin item with name and marketplace", () => {
    const items = [createItem({ name: "my-plugin", marketplace: "playbook" })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    const frame = lastFrame()!;
    expect(frame).toContain("my-plugin");
    expect(frame).toContain("playbook");
    expect(frame).toContain("Plugin");
    expect(frame).toContain("✔");
    expect(frame).toContain("installed");
  });

  it("renders file item with scope", () => {
    const items = [
      createItem({
        name: "AGENTS.md",
        kind: "file",
        tools: ["claude-code"],
        marketplace: "local",
      }),
    ];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0, columns: FILE_COLUMNS }),
    );
    const frame = lastFrame()!;
    expect(frame).toContain("AGENTS.md");
    expect(frame).toContain("claude-code");
  });

  it("shows ❯ for selected item", () => {
    const items = [
      createItem({ name: "first" }),
      createItem({ name: "second" }),
    ];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 1 }),
    );
    const frame = lastFrame()!;
    const lines = frame.split("\n");
    const firstLine = lines.find((l) => l.includes("first"));
    const secondLine = lines.find((l) => l.includes("second"));
    expect(firstLine).toContain(" ");
    expect(secondLine).toContain("❯");
  });

  it("shows incomplete badge", () => {
    const items = [createItem({ installed: true, incomplete: true })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("incomplete");
  });

  it("shows changed badge", () => {
    const items = [
      createItem({ instances: [createInstance({ status: "changed" })] }),
    ];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("drifted");
  });

  it("shows update available badge for pi-package", () => {
    const items = [createItem({ kind: "pi-package", hasUpdate: true })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("update available");
  });

  it("windows correctly when items exceed maxHeight", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      createItem({ name: `plugin-${i}` }),
    );
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 15, maxHeight: 5 }),
    );
    const frame = lastFrame()!;
    // Selected item (15) should be visible
    expect(frame).toContain("plugin-15");
    // Items far from selection should not
    expect(frame).not.toContain("plugin-0");
  });

  it("renders MCP type for hasMcp plugin", () => {
    const items = [createItem({ hasMcp: true })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("MCP");
  });

  it("renders PiPkg type for pi-package", () => {
    const items = [createItem({ kind: "pi-package" })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0 }),
    );
    expect(lastFrame()).toContain("PiPkg");
  });

  it("renders Config type with plugin columns", () => {
    const items = [createItem({ kind: "config" })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0, columns: PLUGIN_COLUMNS }),
    );
    expect(lastFrame()).toContain("Config");
  });

  it("shows 'All tools' when no tools specified", () => {
    const items = [createItem({ kind: "file" })];
    const { lastFrame } = render(
      React.createElement(ItemList, { items, selectedIndex: 0, columns: FILE_COLUMNS }),
    );
    expect(lastFrame()).toContain("All tools");
  });

  it("auto-selects columns based on item kind", () => {
    // Plugins get PLUGIN_COLUMNS (marketplace col)
    const pluginItems = [createItem({ kind: "plugin", marketplace: "my-market" })];
    const { lastFrame: pf } = render(
      React.createElement(ItemList, { items: pluginItems, selectedIndex: 0 }),
    );
    expect(pf()).toContain("my-market");

    // Files get FILE_COLUMNS (scope col)
    const fileItems = [createItem({ kind: "file", tools: ["claude-code"] })];
    const { lastFrame: ff } = render(
      React.createElement(ItemList, { items: fileItems, selectedIndex: 0 }),
    );
    expect(ff()).toContain("claude-code");
  });
});
