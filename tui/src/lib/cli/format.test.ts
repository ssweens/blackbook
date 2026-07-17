import { describe, it, expect } from "vitest";
import {
  toStatusRows,
  formatStatusText,
  formatStatusJson,
  toListResult,
  formatListText,
  formatListJson,
  formatSyncText,
  formatSyncJson,
  formatInstallText,
  formatInstallJson,
} from "./format.js";
import type { SyncPreviewItem, Plugin, FileStatus, PiPackage } from "../types.js";
import type { StandaloneSkill } from "../install.js";

function mkPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: "test-plugin",
    marketplace: "test-marketplace",
    description: "A test plugin",
    source: "./plugins/test-plugin",
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: false,
    scope: "user",
    ...overrides,
  };
}

describe("toStatusRows / formatStatusText / formatStatusJson", () => {
  it("projects each SyncPreviewItem kind into a flat status row", () => {
    const items: SyncPreviewItem[] = [
      { kind: "plugin", plugin: mkPlugin({ name: "p1" }), missingInstances: ["Claude"] },
      {
        kind: "file",
        file: { name: "AGENTS.md", source: "s", target: "t", kind: "file", instances: [] } as FileStatus,
        missingInstances: ["Claude"],
        driftedInstances: ["Codex"],
      },
      {
        kind: "skill",
        skill: { name: "sk1", installations: [], diskPath: "/d", toolId: "", instanceId: "", instanceName: "" } as StandaloneSkill,
        missingInstances: [],
        driftedInstances: ["Claude"],
      },
      { kind: "tool", toolId: "opencode", name: "OpenCode", installedVersion: "1.0.0", latestVersion: "1.1.0" },
      { kind: "piPackage", piPackage: { name: "pi-pkg", description: "", version: "1", source: "npm:pi-pkg", sourceType: "npm", marketplace: "npm", installed: false } as PiPackage },
    ];

    const rows = toStatusRows(items);
    expect(rows).toEqual([
      { kind: "plugin", name: "p1", missingInstances: ["Claude"], driftedInstances: [] },
      { kind: "file", name: "AGENTS.md", missingInstances: ["Claude"], driftedInstances: ["Codex"] },
      { kind: "skill", name: "sk1", missingInstances: [], driftedInstances: ["Claude"] },
      { kind: "tool", name: "OpenCode", missingInstances: [], driftedInstances: ["1.0.0 → 1.1.0"] },
      { kind: "piPackage", name: "pi-pkg", missingInstances: ["not installed"], driftedInstances: [] },
    ]);
  });

  it("formats an empty row list as 'Everything is in sync.'", () => {
    expect(formatStatusText([])).toBe("Everything is in sync.");
  });

  it("formats non-empty rows with missing/drifted detail", () => {
    const text = formatStatusText([{ kind: "skill", name: "sk1", missingInstances: ["Claude"], driftedInstances: [] }]);
    expect(text).toContain("1 item(s) need attention:");
    expect(text).toContain("[skill] sk1");
    expect(text).toContain("missing: Claude");
  });

  it("produces valid, round-trippable JSON with a total count", () => {
    const rows = [{ kind: "skill" as const, name: "sk1", missingInstances: ["Claude"], driftedInstances: [] }];
    const parsed = JSON.parse(formatStatusJson(rows));
    expect(parsed.total).toBe(1);
    expect(parsed.items).toEqual(rows);
  });
});

describe("toListResult / formatListText / formatListJson", () => {
  const plugins: Plugin[] = [mkPlugin({ name: "p1", installed: true, hasUpdate: true })];
  const skills: StandaloneSkill[] = [
    {
      name: "sk1",
      namespace: "ns",
      installations: [{ toolId: "claude-code", instanceId: "default", instanceName: "Claude", diskPath: "/d", drifted: true }],
      diskPath: "/d",
      toolId: "claude-code",
      instanceId: "default",
      instanceName: "Claude",
    } as StandaloneSkill,
  ];
  const files: FileStatus[] = [
    {
      name: "AGENTS.md",
      source: "s",
      target: "t",
      kind: "file",
      instances: [{ toolId: "claude-code", instanceId: "default", instanceName: "Claude", configDir: "/c", targetRelPath: "t", sourcePath: "/s", targetPath: "/t", status: "missing", message: "" }],
    },
  ];
  const piPackages: PiPackage[] = [{ name: "pi-pkg", description: "", version: "1", source: "npm:pi-pkg", sourceType: "npm", marketplace: "npm", installed: true } as PiPackage];

  it("projects plugins/skills/files/piPackages into flat, plain-object shapes", () => {
    const result = toListResult(plugins, skills, files, piPackages);
    expect(result.plugins).toEqual([{ name: "p1", marketplace: "test-marketplace", installed: true, incomplete: false, hasUpdate: true }]);
    expect(result.skills).toEqual([{ name: "sk1", namespace: "ns", installations: [{ toolId: "claude-code", instanceId: "default", drifted: true }] }]);
    expect(result.files).toEqual([{ name: "AGENTS.md", kind: "file", instances: [{ toolId: "claude-code", instanceId: "default", status: "missing" }] }]);
    expect(result.piPackages).toEqual([{ name: "pi-pkg", installed: true, hasUpdate: undefined }]);
  });

  it("renders each section with a count header in text form", () => {
    const result = toListResult(plugins, skills, files, piPackages);
    const text = formatListText(result);
    expect(text).toContain("Plugins (1):");
    expect(text).toContain("Skills (1):");
    expect(text).toContain("Files (1):");
    expect(text).toContain("Pi packages (1):");
    expect(text).toContain("ns/sk1");
  });

  it("produces valid JSON matching the ListResult shape", () => {
    const result = toListResult(plugins, skills, files, piPackages);
    expect(JSON.parse(formatListJson(result))).toEqual(result);
  });
});

describe("sync/install result formatting", () => {
  it("formatSyncText reports the synced/remaining split and any errors", () => {
    const text = formatSyncText({ attempted: 3, remaining: 1, errors: ["boom"] });
    expect(text).toContain("Synced 2/3 item(s).");
    expect(text).toContain("1 item(s) still need attention");
    expect(text).toContain("✗ boom");
  });

  it("formatSyncText omits the remaining/error lines when everything succeeded", () => {
    const text = formatSyncText({ attempted: 2, remaining: 0, errors: [] });
    expect(text).toBe("Synced 2/2 item(s).");
  });

  it("formatSyncJson round-trips the summary", () => {
    const summary = { attempted: 3, remaining: 1, errors: ["boom"] };
    expect(JSON.parse(formatSyncJson(summary))).toEqual(summary);
  });

  it("formatInstallText marks success/failure with a check or cross", () => {
    expect(formatInstallText({ name: "sk1", kind: "skill", success: true, detail: "installed: 1" })).toBe("✓ sk1 — installed: 1");
    expect(formatInstallText({ name: "sk1", kind: "skill", success: false, detail: "failed" })).toBe("✗ sk1 — failed");
  });

  it("formatInstallJson round-trips the summary", () => {
    const summary = { name: "sk1", kind: "skill" as const, success: true, detail: "installed: 1" };
    expect(JSON.parse(formatInstallJson(summary))).toEqual(summary);
  });
});
