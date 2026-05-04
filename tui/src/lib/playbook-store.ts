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
import { enginePreview } from "./sync/index.js";

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

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: PlaybookNotification[];
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

  // Playbook management
  loadPlaybookFromPath(path: string): Promise<void>;
  reloadPlaybook(): Promise<void>;

  // Engine
  refreshPreview(): Promise<void>;

  // Tool detection
  detectAllTools(): Promise<void>;
  detectTool(toolId: ToolId): Promise<void>;

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

  async refreshPreview() {
    const pb = get().playbook;
    if (!pb) return;
    set({ enginePreviewLoading: true, enginePreviewError: null });
    try {
      ensureAdapters();
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
    const statuses: Partial<Record<ToolId, ToolStatus>> = {};
    for (const adapter of listAdapters()) {
      try {
        const det = await adapter.detect();
        statuses[adapter.defaults.toolId] = {
          toolId: adapter.defaults.toolId,
          detection: det,
          loading: false,
        };
      } catch (e) {
        statuses[adapter.defaults.toolId] = {
          toolId: adapter.defaults.toolId,
          detection: {
            toolId: adapter.defaults.toolId,
            installed: false,
          },
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
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

let _adaptersRegistered = false;
function ensureAdapters() {
  if (_adaptersRegistered) return;
  _ra();
  _adaptersRegistered = true;
}
