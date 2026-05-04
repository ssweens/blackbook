/**
 * Zustand store for the new playbook-centric TUI.
 *
 * Deliberately separate from the legacy store (store.ts) so the two can
 * coexist during the transition. Once the new TUI is the default, the
 * legacy store can be removed.
 */

import { create } from "zustand";
import type {
  DetectionResult,
  LoadedPlaybook,
  ToolId,
  ValidationReport,
} from "./playbook/index.js";
import { loadPlaybook, validatePlaybook } from "./playbook/index.js";
import type { EngineSyncResult, PerInstanceResult } from "./sync/index.js";
import { getAdapter, listAdapters } from "./adapters/index.js";
import { registerAllAdapters as _ra } from "./adapters/all.js";
import { enginePreview, engineApply } from "./sync/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlaybookTab = "dashboard" | "playbook" | "sources" | "settings";

export interface ToolStatus {
  toolId: ToolId;
  detection: DetectionResult;
  /** Latest preview result for this tool (undefined if not yet computed). */
  previewResult?: PerInstanceResult[];
  loading: boolean;
  error?: string;
}

export interface PlaybookState {
  // ── Playbook ──────────────────────────────────────────────────────────────
  playbookPath: string | null;
  playbook: LoadedPlaybook | null;
  playbookValidation: ValidationReport | null;
  playbookError: string | null;
  playbookLoading: boolean;

  // ── Engine ────────────────────────────────────────────────────────────────
  /** Latest full preview result (all tools). */
  enginePreview: EngineSyncResult | null;
  enginePreviewLoading: boolean;
  enginePreviewError: string | null;

  // ── Tool detection ────────────────────────────────────────────────────────
  toolStatuses: Partial<Record<ToolId, ToolStatus>>;
  detectionLoading: boolean;

  // ── UI state ─────────────────────────────────────────────────────────────
  activeTab: PlaybookTab;
  /** Which toolId is selected in the Dashboard list. */
  selectedToolId: ToolId | null;
  /** Which artifact is expanded in the Playbook tab. */
  expandedArtifact: string | null;

  // ── Apply state ────────────────────────────────────────────────────────
  /** Tool currently being applied (or awaiting confirmation). */
  applyState: ApplyState | null;

  // ── Notifications ─────────────────────────────────────────────────────
  notifications: PlaybookNotification[];
}

export interface ApplyState {
  toolId: ToolId;
  /** 'confirming' = waiting for user to confirm removals; 'running' = in flight. */
  phase: "confirming" | "running";
  /** How many remove ops are pending confirmation. */
  pendingRemovals: number;
}

export interface PlaybookNotification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  /** Auto-dismiss after ms (undefined = sticky). */
  dismissAfter?: number;
}

export interface PlaybookActions {
  // Navigation
  setActiveTab(tab: PlaybookTab): void;
  setSelectedToolId(id: ToolId | null): void;
  setExpandedArtifact(key: string | null): void;

  /** Pre-populate from a synchronous load before first render (used in cli.tsx). */
  setPlaybookImmediate(path: string, pb: LoadedPlaybook, validation: ValidationReport): void;
  loadPlaybookFromPath(path: string): Promise<void>;
  reloadPlaybook(): Promise<void>;

  // Engine
  refreshPreview(): Promise<void>;
  refreshPreviewForTool(toolId: ToolId): Promise<void>;

  // Tool detection
  detectAllTools(): Promise<void>;
  detectTool(toolId: ToolId): Promise<void>;

  // Apply (playbook → disk)
  applyTool(toolId: ToolId, confirmRemovals?: boolean): Promise<void>;
  cancelApply(): void;

  // Pullback (disk → playbook): copy a single drifted file from disk back into the playbook
  pullbackArtifact(op: import('./playbook/index.js').DiffOp): Promise<void>;

  // Notifications
  addNotification(n: Omit<PlaybookNotification, "id">): void;
  dismissNotification(id: string): void;
}

export type PlaybookStore = PlaybookState & PlaybookActions;

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL: PlaybookState = {
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

let _notifCounter = 0;
function notifId() {
  return `n-${Date.now()}-${++_notifCounter}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const usePlaybookStore = create<PlaybookStore>((set, get) => ({
  ...INITIAL,

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setSelectedToolId(id) {
    set({ selectedToolId: id });
  },

  setExpandedArtifact(key) {
    set({ expandedArtifact: key });
  },

  cancelApply() {
    set({ applyState: null });
  },

  async applyTool(toolId, confirmRemovals = false) {
    const pb = get().playbook;
    if (!pb) return;

    // Check if this tool has pending removals in the current preview
    const preview = get().enginePreview;
    const removals = preview?.perInstance
      .filter((p) => p.toolId === toolId)
      .flatMap((p) => p.diff.ops.filter((o) => o.kind === "remove"))
      .length ?? 0;

    // If there are removals and caller hasn't confirmed, gate on confirmation
    if (removals > 0 && !confirmRemovals) {
      set({ applyState: { toolId, phase: "confirming", pendingRemovals: removals } });
      return;
    }

    set({ applyState: { toolId, phase: "running", pendingRemovals: removals } });
    ensureAdapters();

    try {
      const result = await engineApply(pb, {
        confirmRemovals,
        dryRun: false,
        toolFilter: [toolId],
      });

      const instance = result.perInstance[0];
      const performed = instance?.apply.performed.length ?? 0;
      const errors = [
        ...(instance?.apply.errors ?? []),
        ...(instance?.errors ?? []),
      ];
      const bundleInstalls = instance?.bundleOps.filter((b) => b.op === "install" && b.ok).length ?? 0;

      if (errors.length === 0) {
        get().addNotification({
          level: "success",
          message: `${toolId}: ${performed} file op(s)${bundleInstalls ? `, ${bundleInstalls} bundle(s) installed` : ""} applied`,
          dismissAfter: 4000,
        });
      } else {
        get().addNotification({
          level: "error",
          message: `${toolId}: ${errors.map((e) => e.message).join("; ")}`,
        });
      }

      // Refresh preview to reflect new state
      await get().refreshPreview();
    } catch (e) {
      get().addNotification({
        level: "error",
        message: `${toolId} apply failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      set({ applyState: null });
    }
  },

  async pullbackArtifact(op) {
    const pb = get().playbook;
    if (!pb) return;
    if (op.kind !== "update" || !op.sourcePath || !op.targetPath) {
      get().addNotification({ level: "error", message: `Cannot pull back: not an update op` });
      return;
    }

    const { join } = await import("node:path");
    const { copyFileSync, mkdirSync, existsSync, statSync } = await import("node:fs");

    // sourcePath = playbook file, targetPath = disk file
    // Pullback = disk → playbook (copy targetPath → sourcePath)
    try {
      let diskFile = op.targetPath;
      let playbookFile = op.sourcePath;

      // For skills, copy SKILL.md specifically
      if (op.artifactType === "skill") {
        diskFile = join(op.targetPath, "SKILL.md");
        playbookFile = join(op.sourcePath, "SKILL.md");
      }

      if (!existsSync(diskFile)) {
        get().addNotification({ level: "error", message: `Disk file not found: ${diskFile}` });
        return;
      }

      const destDir = join(playbookFile, "..");
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

      // Backup the playbook version first
      if (existsSync(playbookFile)) {
        copyFileSync(playbookFile, `${playbookFile}.bak.${Date.now()}`);
      }

      copyFileSync(diskFile, playbookFile);

      get().addNotification({
        level: "success",
        message: `Pulled ${op.name} from disk → playbook`,
        dismissAfter: 4000,
      });

      // Reload playbook to pick up the changed file
      const path = get().playbookPath;
      if (path) await get().loadPlaybookFromPath(path);
    } catch (e) {
      get().addNotification({
        level: "error",
        message: `Pullback failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  },

  addNotification(n) {
    const id = notifId();
    set((s) => ({ notifications: [...s.notifications, { ...n, id }] }));
    if (n.dismissAfter) {
      setTimeout(() => get().dismissNotification(id), n.dismissAfter);
    }
  },

  dismissNotification(id) {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  setPlaybookImmediate(path, pb, validation) {
    set({
      playbookPath: path,
      playbook: pb,
      playbookValidation: validation,
      playbookLoading: false,
      playbookError: null,
    });
  },

  async loadPlaybookFromPath(path) {
    set({ playbookLoading: true, playbookError: null });
    try {
      const pb = loadPlaybook(path);
      const validation = validatePlaybook(pb);
      set({
        playbookPath: path,
        playbook: pb,
        playbookValidation: validation,
        playbookLoading: false,
      });
      // Kick off detection + preview in background
      void get().detectAllTools();
      void get().refreshPreview();
    } catch (e) {
      set({
        playbookLoading: false,
        playbookError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async reloadPlaybook() {
    const path = get().playbookPath;
    if (!path) return;
    return get().loadPlaybookFromPath(path);
  },

  async refreshPreviewForTool(toolId) {
    const pb = get().playbook;
    if (!pb) return;
    set({ enginePreviewLoading: true, enginePreviewError: null });
    try {
      ensureAdapters();
      await new Promise((r) => setTimeout(r, 0));
      const result = await enginePreview(pb, {
        confirmRemovals: false,
        toolFilter: [toolId],
      });
      // Merge this tool's results into the existing preview
      const existing = get().enginePreview;
      const merged = existing
        ? {
            ...existing,
            envCheck: result.envCheck,
            perInstance: [
              ...existing.perInstance.filter((p) => p.toolId !== toolId),
              ...result.perInstance,
            ],
            topLevelErrors: result.topLevelErrors,
          }
        : result;
      set({ enginePreview: merged, enginePreviewLoading: false });
    } catch (e) {
      set({
        enginePreviewLoading: false,
        enginePreviewError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async refreshPreview() {
    const pb = get().playbook;
    if (!pb) return;
    set({ enginePreviewLoading: true, enginePreviewError: null });
    try {
      ensureAdapters();
      // Yield before heavy work so pending renders and input events process.
      await new Promise((r) => setTimeout(r, 0));
      const result = await enginePreview(pb, { confirmRemovals: false });
      set({ enginePreview: result, enginePreviewLoading: false });
    } catch (e) {
      set({
        enginePreviewLoading: false,
        enginePreviewError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  async detectAllTools() {
    set({ detectionLoading: true });
    ensureAdapters();
    const results = await Promise.all(
      listAdapters().map(async (adapter) => {
        try {
          const det = await adapter.detect();
          return [adapter.defaults.toolId, { toolId: adapter.defaults.toolId, detection: det, loading: false }] as const;
        } catch (e) {
          return [adapter.defaults.toolId, {
            toolId: adapter.defaults.toolId,
            detection: { toolId: adapter.defaults.toolId, installed: false },
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }] as const;
        }
      }),
    );
    const statuses = Object.fromEntries(results) as Partial<Record<ToolId, ToolStatus>>;
    set({ toolStatuses: statuses, detectionLoading: false });
  },

  async detectTool(toolId) {
    const adapter = getAdapter(toolId);
    if (!adapter) return;
    set((s) => ({
      toolStatuses: {
        ...s.toolStatuses,
        [toolId]: {
          toolId,
          detection: s.toolStatuses[toolId]?.detection ?? { toolId, installed: false },
          loading: true,
        },
      },
    }));
    try {
      const det = await adapter.detect();
      set((s) => ({
        toolStatuses: {
          ...s.toolStatuses,
          [toolId]: { toolId, detection: det, loading: false },
        },
      }));
    } catch (e) {
      set((s) => ({
        toolStatuses: {
          ...s.toolStatuses,
          [toolId]: {
            toolId,
            detection: { toolId, installed: false },
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          },
        },
      }));
    }
  },
}));

import { listRegisteredToolIds } from "./adapters/index.js";

function ensureAdapters() {
  // Only auto-register if nothing is registered yet.
  // Tests pre-register stubs; we must not clobber them.
  if (listRegisteredToolIds().length > 0) return;
  _ra();
}
