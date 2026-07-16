import type { AppState, Notification, DiscoverSection, DiscoverSubView } from "../types.js";
import { fetchNpmPackageDetails } from "../marketplace.js";
import { groupSkillsByNamespace } from "../install.js";
import type { PluginDrift } from "../plugin-drift.js";
import type { Store, SliceCreator } from "./types.js";

export type UiSlice = Pick<
  Store,
  // state
  | "tab"
  | "search"
  | "selectedIndex"
  | "loading"
  | "error"
  | "detailPlugin"
  | "detailMarketplace"
  | "detailPiPackage"
  | "detail"
  | "notifications"
  | "sortBy"
  | "sortDir"
  | "syncSelection"
  | "syncArmed"
  | "pluginDriftMap"
  | "currentSection"
  | "discoverSubView"
  // actions
  | "setTab"
  | "setSortBy"
  | "setSortDir"
  | "setSearch"
  | "setSelectedIndex"
  | "setDetailMarketplace"
  | "setDetail"
  | "refreshDetail"
  | "setDetailPiPackage"
  | "setCurrentSection"
  | "setDiscoverSubView"
  | "toggleSyncSelection"
  | "setSyncArmed"
  | "setPluginDriftMap"
  | "notify"
  | "clearNotification"
>;

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  tab: "installed",
  search: "",
  selectedIndex: 0,
  loading: false,
  error: null,
  detailPlugin: null,
  detailMarketplace: null,
  detailPiPackage: null,
  detail: null,
  notifications: [],
  // Sort state
  sortBy: "default" as AppState["sortBy"],
  sortDir: "asc" as AppState["sortDir"],
  // Sync tab state
  syncSelection: [] as string[],
  syncArmed: false,
  // Plugin drift cache
  pluginDriftMap: {} as Record<string, PluginDrift>,
  // Section navigation
  currentSection: "plugins" as DiscoverSection,
  discoverSubView: null as DiscoverSubView,

  setTab: (tab) =>
    set((state) =>
      state.tab === tab
        ? state
        : {
            tab,
            selectedIndex: 0,
            search: "",
            detailPlugin: null,
            detailMarketplace: null,
            discoverSubView: null,
            currentSection: "plugins",
            detail: null,
            projectDetailPath: null,
          }
    ),
  setSortBy: (by) => set({ sortBy: by }),
  setSortDir: (dir) => set({ sortDir: dir }),
  setSearch: (search) => set({ search, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setDetailMarketplace: (marketplace) => set({ detailMarketplace: marketplace }),
  /**
   * Unified detail setter. Replaces the removed per-kind setters (setDetailPlugin/
   * setDetailFile/setDetailSkill). Sets `detail` and mirrors plugin/piPackage data
   * into the legacy detailPlugin/detailPiPackage fields during the migration period
   * (tests still reference those).
   */
  setDetail: (d) => {
    set({
      detail: d,
      detailPlugin: d?.kind === "plugin" ? d.data : null,
      detailPiPackage: d?.kind === "piPackage" ? d.data : null,
    });
  },
  /**
   * Re-resolve the active detail from the current store state. Used after a mutation
   * to pick up fresh data (e.g. drift updates, install status changes). Closes detail
   * if the artifact no longer exists.
   */
  refreshDetail: () => {
    const state = get();
    const d = state.detail;
    if (!d) return;
    switch (d.kind) {
      case "plugin": {
        // Prefer the installed copy — it has merged version/update metadata.
        // Fall back to marketplace row for not-yet-installed plugins.
        const fromInstalled = state.installedPlugins.find(
          (p) => p.name === d.data.name,
        );
        const fromMP = state.marketplaces
          .flatMap((m) => m.plugins)
          .find((p) => p.name === d.data.name);
        const resolved = fromInstalled || fromMP;
        if (resolved) {
          set({
            detail: { kind: "plugin", data: resolved, drift: d.drift },
            detailPlugin: resolved,
          });
        } else {
          set({ detail: null, detailPlugin: null });
        }
        return;
      }
      case "file": {
        const fresh = state.files.find((f) => f.name === d.data.name);
        set({ detail: fresh ? { kind: "file", data: fresh } : null });
        return;
      }
      case "skill": {
        const fresh = state.standaloneSkills.find((s) => s.name === d.data.name);
        set({ detail: fresh ? { kind: "skill", data: fresh } : null });
        return;
      }
      case "namespace": {
        const fresh = groupSkillsByNamespace(state.standaloneSkills).find(
          (n) => n.name === d.data.name
        );
        set({ detail: fresh ? { kind: "namespace", data: fresh } : null });
        return;
      }
      case "piPackage": {
        const fresh = state.piPackages.find(
          (p) => p.name === d.data.name && p.marketplace === d.data.marketplace,
        );
        if (fresh) {
          set({ detail: { kind: "piPackage", data: fresh }, detailPiPackage: fresh });
        } else {
          set({ detail: null, detailPiPackage: null });
        }
        return;
      }
    }
  },
  setDetailPiPackage: async (pkg) => {
    if (!pkg) {
      set({ detailPiPackage: null, detail: null });
      return;
    }

    // Set immediately so UI shows something. Mirror into unified `detail`.
    set({ detailPiPackage: pkg, detail: { kind: "piPackage", data: pkg } });

    // Fetch full details for npm packages
    if (pkg.sourceType === "npm") {
      const details = await fetchNpmPackageDetails(pkg.source);
      if (details) {
        // Merge details into the package (both mirrors)
        set((state) => {
          if (state.detailPiPackage?.source !== pkg.source) return {};
          const merged = { ...state.detailPiPackage, ...details };
          return {
            detailPiPackage: merged,
            detail: { kind: "piPackage", data: merged },
          };
        });
      }
    }
  },
  setCurrentSection: (section) => set({ currentSection: section }),
  setDiscoverSubView: (subView) => set({ discoverSubView: subView }),
  toggleSyncSelection: (key: string) =>
    set((state) => {
      const has = state.syncSelection.includes(key);
      const next = has
        ? state.syncSelection.filter((k) => k !== key)
        : [...state.syncSelection, key];
      return { syncSelection: next, syncArmed: false };
    }),
  setSyncArmed: (armed: boolean) => set({ syncArmed: armed }),
  setPluginDriftMap: (map) => set({ pluginDriftMap: map }),

  notify: (message, type = "info", options) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification: Notification = { id, message, type, timestamp: Date.now(), spinner: options?.spinner };
    set((state) => ({ notifications: [...state.notifications, notification] }));
    return id;
  },

  clearNotification: (id) => {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }));
  },
});
