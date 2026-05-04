/**
 * Smoke tests for the new TUI — validates core interaction flows.
 *
 * Uses ink-testing-library for render + character keypress testing,
 * and drives the store directly for state transitions that depend on
 * escape sequences (arrow keys, Tab) which ink-testing-library doesn't
 * reliably pass through.
 *
 * Every core flow:
 *   1. First render shows playbook content (no flash)
 *   2. Tab switching via number keys (real keypresses)
 *   3. Store-driven tab cycling (verifies component renders)
 *   4. Store-driven tool selection (verifies Dashboard updates)
 *   5. Drift display after preview completes
 *   6. Playbook tab shows shared artifacts
 *   7. Sources tab shows marketplaces + required env
 *   8. Settings tab shows validation + instances
 *   9. Error state renders properly
 *  10. Loading state renders properly
 *  11. Apply flow surfaces confirmation when removals exist
 */

import React from "react";
import { render } from "ink-testing-library";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadPlaybook,
  scaffoldSkeleton,
  validatePlaybook,
  writeMcpServer,
  writePlaybookManifest,
  writeToolConfig,
} from "../lib/playbook/index.js";
import { usePlaybookStore } from "../lib/playbook-store.js";
import { __resetRegistryForTests, registerAdapter } from "../lib/adapters/index.js";
import { claudeAdapter } from "../lib/adapters/claude/index.js";
import { piAdapter } from "../lib/adapters/pi/index.js";
import type { ToolAdapter } from "../lib/adapters/types.js";
import { PlaybookApp } from "./PlaybookApp.js";

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
      claude: [{ name: "test-marketplace", url: "https://example.com/marketplace.json" }],
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

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const INITIAL_STATE = {
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
  activeTab: "dashboard" as const,
  selectedToolId: null,
  expandedArtifact: null,
  applyState: null,
  notifications: [],
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-tui-smoke-"));
  __resetRegistryForTests();
  usePlaybookStore.setState(INITIAL_STATE);
});

afterEach(() => {
  __resetRegistryForTests();
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TUI smoke tests", () => {
  it("1. first render shows playbook content — no flash", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);
    const frame = lastFrame();

    expect(frame).toContain("Dashboard");
    expect(frame).toContain("Playbook");
    expect(frame).toContain("Sources");
    expect(frame).toContain("Settings");
    expect(frame).toContain("claude");
    expect(frame).toContain("pi");
    expect(frame).not.toContain("No playbook loaded");
  });

  it("2. number keys switch tabs", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame, stdin } = render(<PlaybookApp playbookPath={pbRoot} />);

    expect(lastFrame()).toContain("Tools");

    stdin.write("2");
    expect(lastFrame()).toContain("Sections");

    stdin.write("3");
    expect(lastFrame()).toContain("Marketplaces");

    stdin.write("4");
    expect(lastFrame()).toContain("Validation");

    stdin.write("1");
    expect(lastFrame()).toContain("Tools");
  });

  it("3. store-driven tab switch renders correct tab content", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);

    usePlaybookStore.getState().setActiveTab("playbook");
    expect(lastFrame()).toContain("Sections");
    expect(lastFrame()).toContain("shared/skills");

    usePlaybookStore.getState().setActiveTab("sources");
    expect(lastFrame()).toContain("Marketplaces");
    expect(lastFrame()).toContain("test-marketplace");

    usePlaybookStore.getState().setActiveTab("settings");
    expect(lastFrame()).toContain("no issues");
    expect(lastFrame()).toContain("pnpm");

    usePlaybookStore.getState().setActiveTab("dashboard");
    expect(lastFrame()).toContain("Tools");
  });

  it("4. store-driven tool selection shows correct detail", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);

    // Default: first tool (claude)
    expect(lastFrame()).toContain("Claude Test");

    // Select pi
    usePlaybookStore.getState().setSelectedToolId("pi");
    expect(lastFrame()).toContain("Pi Test");

    // Back to claude
    usePlaybookStore.getState().setSelectedToolId("claude");
    expect(lastFrame()).toContain("Claude Test");
  });

  it("5. drift display after preview completes", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);

    // Trigger preview manually (the useEffect may or may not have fired yet)
    await usePlaybookStore.getState().detectAllTools();
    await usePlaybookStore.getState().refreshPreview();

    const state = usePlaybookStore.getState();
    expect(state.enginePreviewLoading).toBe(false);
    expect(state.enginePreviewError).toBeNull();
    expect(state.enginePreview).not.toBeNull();

    const frame = lastFrame();
    // Should show add ops (tool config dirs are empty)
    expect(frame).toMatch(/\+\d+ add/);
  });

  it("6. Playbook tab shows shared skills and commands", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);
    usePlaybookStore.getState().setActiveTab("playbook");

    const frame = lastFrame();
    expect(frame).toContain("shared/skills");
    expect(frame).toContain("shared/commands");
    expect(frame).toContain("test-skill");
  });

  it("7. Sources tab shows marketplaces and required env", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);
    usePlaybookStore.getState().setActiveTab("sources");

    const frame = lastFrame();
    expect(frame).toContain("test-marketplace");
    expect(frame).toContain("TEST_TOKEN");
  });

  it("8. Settings tab shows validation and instances", () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    const { lastFrame } = render(<PlaybookApp playbookPath={pbRoot} />);
    usePlaybookStore.getState().setActiveTab("settings");

    const frame = lastFrame();
    expect(frame).toContain("no issues");
    expect(frame).toContain("Claude Test");
    expect(frame).toContain("Pi Test");
    expect(frame).toContain("pnpm");
  });

  it("9. error state renders — not 'No playbook loaded'", () => {
    usePlaybookStore.setState({
      playbookPath: "/bad",
      playbookError: "Playbook root does not exist: /bad",
      playbookLoading: false,
    });

    const { lastFrame } = render(<PlaybookApp playbookPath="/bad" />);
    const frame = lastFrame();

    expect(frame).toContain("✗");
    expect(frame).toContain("does not exist");
    expect(frame).not.toContain("No playbook loaded");
  });

  it("10. loading state renders", () => {
    usePlaybookStore.setState({ playbookLoading: true });

    const { lastFrame } = render(<PlaybookApp />);
    expect(lastFrame()).toContain("Loading");
  });

  it("11. apply triggers confirmation when removals exist", async () => {
    const { pbRoot, claudeDir, piDir } = buildTestPlaybook();
    registerAdapter(stubAdapter(claudeAdapter, claudeDir));
    registerAdapter(stubAdapter(piAdapter, piDir));
    preloadStore(pbRoot);

    // Pre-populate a file in the claude config dir so it becomes a removal candidate
    mkdirSync(join(claudeDir, "skills", "orphan"), { recursive: true });
    writeFileSync(join(claudeDir, "skills", "orphan", "SKILL.md"), "# orphan");

    // Run preview explicitly so removals are computed
    await usePlaybookStore.getState().detectAllTools();
    await usePlaybookStore.getState().refreshPreview();

    const preview = usePlaybookStore.getState().enginePreview;
    const claudeOps = preview?.perInstance.find((p) => p.toolId === "claude");
    const removeCount = claudeOps?.diff.ops.filter((o) => o.kind === "remove").length ?? 0;
    expect(removeCount).toBeGreaterThan(0);

    // Apply without confirmRemovals — should enter confirming phase
    await usePlaybookStore.getState().applyTool("claude");

    const state = usePlaybookStore.getState();
    expect(state.applyState?.phase).toBe("confirming");
    expect(state.applyState?.pendingRemovals).toBeGreaterThan(0);

    // Cancel
    usePlaybookStore.getState().cancelApply();
    expect(usePlaybookStore.getState().applyState).toBeNull();
  });
});
