/**
 * E2E interaction tests for the new playbook TUI.
 *
 * Pattern matches the existing app.e2e.test.tsx: render the real component,
 * drive the Zustand store directly, poll with waitForFrame until expected
 * content appears. This validates that state transitions produce correct
 * rendered output — the same guarantee the legacy E2E suite provides.
 *
 * Flows covered:
 *   1.  First render shows playbook content (no "No playbook" flash)
 *   2.  Tab switching renders correct tab content
 *   3.  Tool selection updates detail panel
 *   4.  Drift display appears after preview resolves
 *   5.  Apply without removals runs immediately and shows success
 *   6.  Apply with removals enters confirmation phase
 *   7.  Cancel confirmation clears apply state
 *   8.  Confirm removals runs apply and shows success
 *   9.  Playbook tab shows shared + tool artifacts
 *   10. Sources tab shows marketplaces + env status
 *   11. Settings tab shows validation + instances
 *   12. Error state renders error, not "No playbook loaded"
 *   13. Notification appears and auto-dismisses
 */

import React from "react";
import { render } from "ink-testing-library";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  scaffoldSkeleton,
  validatePlaybook,
  writePlaybookManifest,
  writeToolConfig,
} from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore } from "../lib/playbook-store.js";
import { __resetRegistryForTests, registerAdapter } from "../lib/adapters/index.js";
import { claudeAdapter } from "../lib/adapters/claude/index.js";
import { piAdapter } from "../lib/adapters/pi/index.js";
import type { ToolAdapter } from "../lib/adapters/types.js";
import { PlaybookApp } from "./PlaybookApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (same pattern as app.e2e.test.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const waitForFrame = async (
  getFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
) => {
  const start = Date.now();
  for (let i = 0; i < 500; i += 1) {
    const frame = getFrame();
    if (frame && predicate(frame)) return frame;
    if (Date.now() - start > timeoutMs) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const last = getFrame();
  throw new Error(
    `waitForFrame timed out after ${timeoutMs}ms.\nLast frame:\n${last ?? "(no frame)"}`,
  );
};

let tmp: string;

function stubAdapter(real: ToolAdapter, configDir: string): ToolAdapter {
  return {
    ...real,
    defaults: { ...real.defaults, defaultConfigDir: configDir },
    async detect() {
      return {
        toolId: real.defaults.toolId,
        installed: true,
        version: "1.0.0-test",
        binaryPath: "/usr/bin/test",
        configDir,
      };
    },
  };
}

function buildTestPlaybook() {
  const pbRoot = join(tmp, "playbook");
  const claudeDir = join(tmp, "claude-config");
  const piDir = join(tmp, "pi-config");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(piDir, { recursive: true });

  scaffoldSkeleton(pbRoot, ["claude", "pi"]);
  writePlaybookManifest(pbRoot, {
    playbook_schema_version: 1,
    name: "test-playbook",
    tools_enabled: ["claude", "pi"],
    marketplaces: {
      claude: [{ name: "test-mkt", url: "https://example.com/mkt.json" }],
    },
    required_env: [{ name: "TEST_TOKEN", used_by: ["test-mcp"], optional: false }],
    defaults: { confirm_removals: true, default_strategy: "copy", drift_action: "warn" },
    settings: { package_manager: "pnpm", backup_retention: 3 },
  });

  mkdirSync(join(pbRoot, "shared", "skills", "test-skill"), { recursive: true });
  writeFileSync(join(pbRoot, "shared", "skills", "test-skill", "SKILL.md"), "# test-skill");
  writeFileSync(join(pbRoot, "shared", "commands", "test-cmd.md"), "# test-cmd");
  writeFileSync(join(pbRoot, "shared", "AGENTS.md"), "# test agents");

  writeToolConfig(pbRoot, "claude", {
    tool: "claude",
    instances: [{ id: "default", name: "Claude Test", config_dir: claudeDir, enabled: true }],
    include_shared: { agents_md: true, skills: ["test-skill"], commands: ["test-cmd"], agents: [], mcp: [] },
    overrides: { agents_md: { default: "CLAUDE.md" } },
    config_files: [],
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
  });

  writeToolConfig(pbRoot, "pi", {
    tool: "pi",
    instances: [{ id: "default", name: "Pi Test", config_dir: piDir, enabled: true }],
    include_shared: { agents_md: true, skills: ["test-skill"], commands: ["test-cmd"], agents: [], mcp: [] },
    overrides: { agents_md: {} },
    config_files: [],
    lifecycle: { install_strategy: "native", uninstall_strategy: "native" },
  });

  return { pbRoot, claudeDir, piDir };
}

function preloadStore(pbRoot: string) {
  const pb = loadPlaybook(pbRoot);
  const validation = validatePlaybook(pb);
  usePlaybookStore.getState().setPlaybookImmediate(pbRoot, pb, validation);
}

const INITIAL_STATE: Partial<PlaybookStore> = {
  playbookPath: null,
  playbook: null,
  playbookValidation: null,
  playbookError: null,
  playbookLoading: false,
  enginePreview: null,
  enginePreviewLoading: false,
  enginePreviewError: null,
  toolStatuses: {},
  detectionLoading: false,
  activeTab: "dashboard",
  selectedToolId: null,
  expandedArtifact: null,
  applyState: null,
  notifications: [],
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bb-e2e-"));
  __resetRegistryForTests();
  usePlaybookStore.setState(INITIAL_STATE);
});

afterEach(() => {
  __resetRegistryForTests();
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Playbook TUI E2E", () => {
  it("1. first render shows playbook content — no flash", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      const frame = await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("claude") && f.includes("Dashboard") && !f.includes("No playbook"),
      );
      expect(frame).toContain("claude");
      expect(frame).toContain("pi");
    } finally {
      unmount();
    }
  });

  it("2. tab switching renders correct content", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      // Dashboard first
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Tools"));

      // Switch to Playbook
      usePlaybookStore.getState().setActiveTab("playbook");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Sections") && f.includes("shared/skills"));

      // Switch to Sources
      usePlaybookStore.getState().setActiveTab("sources");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Marketplaces") && f.includes("test-mkt"));

      // Switch to Settings
      usePlaybookStore.getState().setActiveTab("settings");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Validation") && f.includes("pnpm"));

      // Back to Dashboard
      usePlaybookStore.getState().setActiveTab("dashboard");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Tools"));
    } finally {
      unmount();
    }
  });

  it("3. tool selection updates detail panel", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      // Default: claude detail shown
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Claude Test"));

      // Select pi
      usePlaybookStore.getState().setSelectedToolId("pi");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Pi Test"));

      // Back to claude
      usePlaybookStore.getState().setSelectedToolId("claude");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("Claude Test"));
    } finally {
      unmount();
    }
  });

  it("4. drift appears after preview resolves", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      // Trigger detection + preview
      await usePlaybookStore.getState().detectAllTools();
      await usePlaybookStore.getState().refreshPreview();

      // Drift should show adds (config dirs are empty)
      await waitForFrame(stdout.lastFrame, (f) => /\+\d+ add/.test(f));
    } finally {
      unmount();
    }
  });

  it("5. apply without removals runs immediately and shows success", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      await usePlaybookStore.getState().detectAllTools();
      await usePlaybookStore.getState().refreshPreview();

      // No pre-existing files → no removals → apply should run directly
      await usePlaybookStore.getState().applyTool("claude");

      // Should see success notification
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[success]"));

      // Files should be on disk
      expect(readFileSync(join(claudeDir, "skills", "test-skill", "SKILL.md"), "utf-8")).toBe("# test-skill");
      expect(readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8")).toBe("# test agents");
      expect(readFileSync(join(claudeDir, "commands", "test-cmd.md"), "utf-8")).toBe("# test-cmd");
    } finally {
      unmount();
    }
  });

  it("6. apply with removals enters confirmation phase", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    // Pre-populate orphan so it becomes a removal candidate
    mkdirSync(join(claudeDir, "skills", "orphan"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "orphan", "SKILL.md"), "# orphan");

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      await usePlaybookStore.getState().detectAllTools();
      await usePlaybookStore.getState().refreshPreview();

      // Apply without confirmRemovals → enters confirming state
      await usePlaybookStore.getState().applyTool("claude");

      const state = usePlaybookStore.getState();
      expect(state.applyState?.phase).toBe("confirming");
      expect(state.applyState?.pendingRemovals).toBeGreaterThan(0);

      // Confirmation bar should render
      await waitForFrame(stdout.lastFrame, (f) => f.includes("will be removed"));
    } finally {
      unmount();
    }
  });

  it("7. cancel confirmation clears apply state", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    mkdirSync(join(claudeDir, "skills", "orphan"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "orphan", "SKILL.md"), "# orphan");

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      await usePlaybookStore.getState().detectAllTools();
      await usePlaybookStore.getState().refreshPreview();
      await usePlaybookStore.getState().applyTool("claude");

      await waitForFrame(stdout.lastFrame, (f) => f.includes("will be removed"));

      // Cancel
      usePlaybookStore.getState().cancelApply();

      await waitForFrame(stdout.lastFrame, (f) => !f.includes("will be removed"));
      expect(usePlaybookStore.getState().applyState).toBeNull();
    } finally {
      unmount();
    }
  });

  it("8. confirm removals applies and removes orphan", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    mkdirSync(join(claudeDir, "skills", "orphan"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "orphan", "SKILL.md"), "# orphan");

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      await usePlaybookStore.getState().detectAllTools();
      await usePlaybookStore.getState().refreshPreview();
      await usePlaybookStore.getState().applyTool("claude");
      await waitForFrame(stdout.lastFrame, (f) => f.includes("will be removed"));

      // Confirm
      await usePlaybookStore.getState().applyTool("claude", true);
      await waitForFrame(stdout.lastFrame, (f) => f.includes("[success]"));

      // Orphan should be deleted
      expect(() => readFileSync(join(claudeDir, "skills", "orphan", "SKILL.md"))).toThrow();
      // Playbook content should be applied
      expect(readFileSync(join(claudeDir, "skills", "test-skill", "SKILL.md"), "utf-8")).toBe("# test-skill");
    } finally {
      unmount();
    }
  });

  it("9. Playbook tab shows shared skills and tool-specific", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      usePlaybookStore.getState().setActiveTab("playbook");
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("shared/skills") && f.includes("test-skill"),
      );
    } finally {
      unmount();
    }
  });

  it("10. Sources tab shows marketplaces and required env", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      usePlaybookStore.getState().setActiveTab("sources");
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("test-mkt") && f.includes("TEST_TOKEN"),
      );
    } finally {
      unmount();
    }
  });

  it("11. Settings tab shows validation and instances", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      usePlaybookStore.getState().setActiveTab("settings");
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("no issues") && f.includes("Claude Test") && f.includes("Pi Test"),
      );
    } finally {
      unmount();
    }
  });

  it("12. error state renders error message", async () => {
    usePlaybookStore.setState({
      playbookPath: "/bad",
      playbookError: "Playbook root does not exist: /bad",
      playbookLoading: false,
    });

    const { stdout, unmount } = render(<PlaybookApp playbookPath="/bad" />);
    try {
      await waitForFrame(stdout.lastFrame, (f) =>
        f.includes("✗") && f.includes("does not exist") && !f.includes("No playbook loaded"),
      );
    } finally {
      unmount();
    }
  });

  it("13. notification auto-dismisses", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { stdout, unmount } = render(<PlaybookApp playbookPath={pbRoot} />);
    try {
      usePlaybookStore.getState().addNotification({
        level: "success",
        message: "test notification",
        dismissAfter: 200,
      });
      await waitForFrame(stdout.lastFrame, (f) => f.includes("test notification"));

      // Wait for auto-dismiss
      await new Promise((r) => setTimeout(r, 300));
      await waitForFrame(stdout.lastFrame, (f) => !f.includes("test notification"));
    } finally {
      unmount();
    }
  });
});
