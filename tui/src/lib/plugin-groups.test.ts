import { describe, it, expect } from "vitest";
import { buildPluginRows } from "./plugin-groups.js";
import type { Plugin } from "./types.js";

const plugin = (name: string, marketplace: string): Plugin =>
  ({ name, marketplace, description: "", source: "", skills: [], commands: [], agents: [], hooks: [], installed: true, scope: "user" }) as unknown as Plugin;

const label = (rows: ReturnType<typeof buildPluginRows>) =>
  rows.map((r) => (r.kind === "marketplace" ? `# ${r.marketplace} (${r.count})${r.collapsed ? " ▸" : " ▾"}` : `  ${r.plugin.name}`));

describe("buildPluginRows", () => {
  const plugins = [
    plugin("context7", "claude-plugins-official"),
    plugin("playwright", "claude-plugins-official"),
    plugin("desk", "desk"),
  ];

  it("groups by marketplace with a header per group, headers sorted case-insensitively, plugins in given order", () => {
    expect(label(buildPluginRows(plugins, new Set()))).toEqual([
      "# claude-plugins-official (2) ▾",
      "  context7",
      "  playwright",
      "# desk (1) ▾",
      "  desk",
    ]);
  });

  it("a collapsed marketplace shows only its header", () => {
    expect(label(buildPluginRows(plugins, new Set(["claude-plugins-official"])))).toEqual([
      "# claude-plugins-official (2) ▸",
      "# desk (1) ▾",
      "  desk",
    ]);
  });

  it("expandAll overrides the collapsed set so search matches stay visible", () => {
    expect(label(buildPluginRows(plugins, new Set(["claude-plugins-official", "desk"]), { expandAll: true }))).toEqual([
      "# claude-plugins-official (2) ▾",
      "  context7",
      "  playwright",
      "# desk (1) ▾",
      "  desk",
    ]);
  });

  it("falls back to a placeholder marketplace label", () => {
    const rows = buildPluginRows([plugin("orphan", "")], new Set());
    expect(rows[0]).toMatchObject({ kind: "marketplace", marketplace: "(no marketplace)", count: 1 });
  });
});
