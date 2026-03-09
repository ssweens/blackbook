import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleItemAction, type DispatchCallbacks } from "./action-dispatch.js";
import type { ManagedItem } from "./managed-item.js";
import type { ItemAction } from "../components/ItemDetail.js";
import type { Plugin, FileStatus, PiPackage, DiffInstanceRef } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

function createPlugin(): Plugin {
  return {
    name: "test-plugin",
    marketplace: "playbook",
    description: "test",
    source: "/src",
    skills: ["s"],
    commands: [],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: true,
    scope: "user",
  };
}

function createFileStatus(): FileStatus {
  return {
    name: "AGENTS.md",
    source: "assets/AGENTS.md",
    target: "AGENTS.md",
    instances: [
      {
        toolId: "claude-code",
        instanceId: "main",
        instanceName: "Claude",
        configDir: "/home/.claude",
        targetRelPath: "AGENTS.md",
        sourcePath: "/repo/AGENTS.md",
        targetPath: "/home/.claude/AGENTS.md",
        status: "drifted",
        message: "",
        driftKind: "source-changed",
      },
    ],
    kind: "file",
  };
}

function createPiPackage(): PiPackage {
  return {
    name: "pi-themes",
    description: "themes",
    version: "1.0.0",
    source: "npm:@pi/themes",
    sourceType: "npm",
    marketplace: "npm",
    installed: true,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
}

function createItem(overrides?: Partial<ManagedItem>): ManagedItem {
  return {
    name: "test",
    kind: "plugin",
    marketplace: "test",
    description: "test",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
    ...overrides,
  };
}

function createCallbacks(): DispatchCallbacks {
  return {
    closeDetail: vi.fn(),
    openDiffForFile: vi.fn(),
    openMissingSummaryForFile: vi.fn(),
    setDiffTarget: vi.fn(),
    installPlugin: vi.fn().mockResolvedValue(true),
    uninstallPlugin: vi.fn().mockResolvedValue(true),
    updatePlugin: vi.fn().mockResolvedValue(true),
    installPluginToInstance: vi.fn().mockResolvedValue(undefined),
    uninstallPluginFromInstance: vi.fn().mockResolvedValue(undefined),
    refreshDetailPlugin: vi.fn(),
    syncFiles: vi.fn().mockResolvedValue(undefined),
    pullbackFileInstance: vi.fn().mockResolvedValue(true),
    installPiPackage: vi.fn().mockResolvedValue(true),
    uninstallPiPackage: vi.fn().mockResolvedValue(true),
    updatePiPackage: vi.fn().mockResolvedValue(true),
    refreshDetailPiPackage: vi.fn(),
    buildPluginDiffTarget: vi.fn().mockResolvedValue(null),
  };
}

const instance: DiffInstanceRef = {
  toolId: "claude-code",
  instanceId: "main",
  instanceName: "Claude",
  configDir: "/home/.claude",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("handleItemAction", () => {
  let callbacks: DispatchCallbacks;

  beforeEach(() => {
    callbacks = createCallbacks();
  });

  // ── back ─────────────────────────────────────────────────────────────
  it("back calls closeDetail", async () => {
    const action: ItemAction = { id: "back", label: "Back", type: "back" };
    const result = await handleItemAction(createItem(), action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.closeDetail).toHaveBeenCalled();
  });

  // ── status ───────────────────────────────────────────────────────────
  it("status is a no-op", async () => {
    const action: ItemAction = { id: "s", label: "Claude", type: "status", statusLabel: "Synced" };
    const result = await handleItemAction(createItem(), action, callbacks);
    expect(result).toBe(false);
  });

  // ── diff (file) ──────────────────────────────────────────────────────
  it("diff on file opens diff view", async () => {
    const file = createFileStatus();
    const item = createItem({ _file: file });
    const action: ItemAction = { id: "d", label: "Claude", type: "diff", instance };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.openDiffForFile).toHaveBeenCalledWith(file, instance);
  });

  // ── diff (plugin) ────────────────────────────────────────────────────
  it("diff on plugin builds and sets diff target", async () => {
    const plugin = createPlugin();
    const diffTarget = { kind: "file" as const, title: "test", instance, files: [] };
    vi.mocked(callbacks.buildPluginDiffTarget).mockResolvedValue(diffTarget);
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "d", label: "Claude", type: "diff", instance };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.setDiffTarget).toHaveBeenCalledWith(diffTarget);
  });

  it("diff with no instance is a no-op", async () => {
    const action: ItemAction = { id: "d", label: "X", type: "diff" };
    const result = await handleItemAction(createItem(), action, callbacks);
    expect(result).toBe(false);
  });

  // ── missing ──────────────────────────────────────────────────────────
  it("missing opens missing summary", async () => {
    const file = createFileStatus();
    const item = createItem({ _file: file });
    const action: ItemAction = { id: "m", label: "Claude", type: "missing", instance };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.openMissingSummaryForFile).toHaveBeenCalledWith(file, instance);
  });

  // ── sync ─────────────────────────────────────────────────────────────
  it("sync on file calls syncFiles with sync item", async () => {
    const file = createFileStatus();
    const item = createItem({ _file: file });
    const action: ItemAction = { id: "s", label: "Sync", type: "sync" };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.syncFiles).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "file", file }),
    ]);
  });

  it("sync on non-file is a no-op", async () => {
    const action: ItemAction = { id: "s", label: "Sync", type: "sync" };
    const result = await handleItemAction(createItem(), action, callbacks);
    expect(result).toBe(false);
  });

  // ── install ──────────────────────────────────────────────────────────
  it("install plugin calls installPlugin + refresh", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "i", label: "Install", type: "install" };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.installPlugin).toHaveBeenCalledWith(plugin);
    expect(callbacks.refreshDetailPlugin).toHaveBeenCalledWith(plugin);
  });

  it("install pi-package calls installPiPackage + refresh", async () => {
    const pkg = createPiPackage();
    const item = createItem({ _piPackage: pkg });
    const action: ItemAction = { id: "i", label: "Install", type: "install" };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.installPiPackage).toHaveBeenCalledWith(pkg);
    expect(callbacks.refreshDetailPiPackage).toHaveBeenCalledWith(pkg);
  });

  // ── uninstall ────────────────────────────────────────────────────────
  it("uninstall plugin calls uninstallPlugin + refresh", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "u", label: "Uninstall", type: "uninstall" };
    await handleItemAction(item, action, callbacks);
    expect(callbacks.uninstallPlugin).toHaveBeenCalledWith(plugin);
    expect(callbacks.refreshDetailPlugin).toHaveBeenCalledWith(plugin);
  });

  // ── update ───────────────────────────────────────────────────────────
  it("update plugin calls updatePlugin + refresh", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "u", label: "Update", type: "update" };
    await handleItemAction(item, action, callbacks);
    expect(callbacks.updatePlugin).toHaveBeenCalledWith(plugin);
    expect(callbacks.refreshDetailPlugin).toHaveBeenCalledWith(plugin);
  });

  // ── install_tool ─────────────────────────────────────────────────────
  it("install_tool calls installPluginToInstance", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "it", label: "Install to Claude", type: "install_tool", instance };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.installPluginToInstance).toHaveBeenCalledWith(plugin, "claude-code", "main");
  });

  it("install_tool uses toolStatus when instance is not provided", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = {
      id: "it2",
      label: "Install to Claude",
      type: "install_tool",
      toolStatus: { toolId: "claude-code", instanceId: "main", name: "Claude" },
    };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.installPluginToInstance).toHaveBeenCalledWith(plugin, "claude-code", "main");
  });

  // ── uninstall_tool ───────────────────────────────────────────────────
  it("uninstall_tool calls uninstallPluginFromInstance", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = { id: "ut", label: "Uninstall from Claude", type: "uninstall_tool", instance };
    await handleItemAction(item, action, callbacks);
    expect(callbacks.uninstallPluginFromInstance).toHaveBeenCalledWith(plugin, "claude-code", "main");
  });

  it("uninstall_tool uses toolStatus when instance is not provided", async () => {
    const plugin = createPlugin();
    const item = createItem({ _plugin: plugin });
    const action: ItemAction = {
      id: "ut2",
      label: "Uninstall from Claude",
      type: "uninstall_tool",
      toolStatus: { toolId: "claude-code", instanceId: "main", name: "Claude" },
    };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.uninstallPluginFromInstance).toHaveBeenCalledWith(plugin, "claude-code", "main");
  });

  // ── pullback ─────────────────────────────────────────────────────────
  it("pullback calls pullbackFileInstance", async () => {
    const file = createFileStatus();
    const item = createItem({ _file: file });
    const action: ItemAction = { id: "p", label: "Pull from Claude", type: "pullback", instance };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(true);
    expect(callbacks.pullbackFileInstance).toHaveBeenCalledWith(file, instance);
  });

  it("pullback without instance is a no-op", async () => {
    const file = createFileStatus();
    const item = createItem({ _file: file });
    const action: ItemAction = { id: "p", label: "Pull", type: "pullback" };
    const result = await handleItemAction(item, action, callbacks);
    expect(result).toBe(false);
  });
});
