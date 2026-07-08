import { describe, it, expect } from "vitest";
import { buildMenuItems, getUpstreamStateLabel, wouldDiscardLocalWork } from "./SettingsPanel.js";
import type { SourceRepoStatus } from "../lib/source-setup.js";

function makeRepoStatus(overrides: Partial<SourceRepoStatus>): SourceRepoStatus {
  return {
    isGitRepo: true,
    branch: "main",
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    changes: [],
    hasChanges: false,
    ...overrides,
  };
}

describe("buildMenuItems", () => {
  it("includes pull action when repo is clean", () => {
    const items = buildMenuItems(makeRepoStatus({ hasChanges: false, behind: 0 }));
    const actionIds = items.filter((item) => item.kind === "action").map((item) => item.id);
    expect(actionIds).toContain("pull");
  });

  it("includes pull action when repo has local changes", () => {
    const items = buildMenuItems(
      makeRepoStatus({
        hasChanges: true,
        behind: 0,
        changes: [{ path: "assets/AGENTS.md", status: "modified" }],
      }),
    );

    const actionIds = items.filter((item) => item.kind === "action").map((item) => item.id);
    expect(actionIds).not.toContain("commit_push");
    expect(actionIds).toContain("pull");
  });
});

describe("wouldDiscardLocalWork", () => {
  it("is false for a clean, up-to-date repo", () => {
    expect(wouldDiscardLocalWork(makeRepoStatus({ hasChanges: false, ahead: 0, behind: 0 }))).toBe(false);
  });

  it("is false when only behind (fast-forward can't lose local work)", () => {
    expect(wouldDiscardLocalWork(makeRepoStatus({ hasChanges: false, ahead: 0, behind: 5 }))).toBe(false);
  });

  it("is true when there are uncommitted local changes", () => {
    expect(wouldDiscardLocalWork(makeRepoStatus({ hasChanges: true }))).toBe(true);
  });

  it("is true when there are un-pushed local commits", () => {
    expect(wouldDiscardLocalWork(makeRepoStatus({ ahead: 2 }))).toBe(true);
  });

  it("is false for a null repo status", () => {
    expect(wouldDiscardLocalWork(null)).toBe(false);
  });
});

describe("getUpstreamStateLabel", () => {
  it("reports no upstream", () => {
    const label = getUpstreamStateLabel(makeRepoStatus({ hasUpstream: false }));
    expect(label).toBe("no upstream configured");
  });

  it("reports behind state", () => {
    const label = getUpstreamStateLabel(makeRepoStatus({ hasUpstream: true, behind: 2, ahead: 0 }));
    expect(label).toBe("behind by 2");
  });

  it("reports diverged state", () => {
    const label = getUpstreamStateLabel(makeRepoStatus({ hasUpstream: true, behind: 1, ahead: 3 }));
    expect(label).toBe("diverged (ahead 3, behind 1)");
  });
});
