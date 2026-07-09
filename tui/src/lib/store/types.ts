import type { StoreApi } from "zustand";
import type {
  Tab,
  Marketplace,
  Plugin,
  FileStatus,
  AppState,
  Notification,
  SyncPreviewItem,
  DiffInstanceRef,
  DetailArtifact,
  PiPackage,
  DiscoverSection,
  DiscoverSubView,
} from "../types.js";
import type { PluginDrift } from "../plugin-drift.js";

export interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: (options?: { silent?: boolean }) => Promise<void>;
  loadFiles: (options?: { silent?: boolean }) => Promise<FileStatus[]>;
  refreshManagedTools: () => void;
  refreshToolDetection: () => Promise<void>;
  installToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  updateToolAction: (toolId: string, options?: { migrate?: boolean }) => Promise<boolean>;
  uninstallToolAction: (toolId: string) => Promise<boolean>;
  cancelToolAction: () => void;
  refreshAll: (options?: { silent?: boolean }) => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  trackPluginInSource: (plugin: Plugin) => Promise<boolean>;
  removePluginFromGit: (plugin: Plugin) => Promise<boolean>;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  /** Unified detail setter. Replaces the removed per-kind setters (setDetailPlugin/etc). */
  setDetail: (d: DetailArtifact | null) => void;
  /** Re-resolve `detail` from current store state; close if artifact no longer exists. */
  refreshDetail: () => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => Promise<void>;
  updateMarketplace: (name: string) => Promise<void>;
  toggleMarketplaceEnabled: (name: string) => Promise<void>;
  toggleToolEnabled: (toolId: string, instanceId: string) => Promise<void>;
  updateToolConfigDir: (toolId: string, instanceId: string, configDir: string) => Promise<void>;
  getSyncPreview: () => SyncPreviewItem[];
  syncTools: (items: SyncPreviewItem[]) => Promise<void>;
  notify: (message: string, type?: Notification["type"], options?: { spinner?: boolean }) => string;
  clearNotification: (id: string) => void;
  // Pi package actions
  loadPiPackages: (options?: { silent?: boolean }) => Promise<void>;
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  repairPiPackage: (pkg: PiPackage) => Promise<boolean>;
  trackPiPackageInSource: (pkg: PiPackage) => Promise<boolean>;
  removePiPackageFromGit: (pkg: PiPackage) => Promise<boolean>;
  deletePiPackageEverywhere: (pkg: PiPackage) => Promise<boolean>;
  setDetailPiPackage: (pkg: PiPackage | null) => Promise<void>;
  togglePiMarketplaceEnabled: (name: string) => Promise<void>;
  addPiMarketplace: (name: string, source: string) => Promise<void>;
  removePiMarketplace: (name: string) => Promise<void>;
  // Section navigation
  setSortBy: (by: AppState["sortBy"]) => void;
  setSortDir: (dir: AppState["sortDir"]) => void;
  setCurrentSection: (section: DiscoverSection) => void;
  setDiscoverSubView: (subView: DiscoverSubView) => void;
  toggleSyncSelection: (key: string) => void;
  setSyncArmed: (armed: boolean) => void;
  setPluginDriftMap: (map: Record<string, PluginDrift>) => void;
  // Diff view actions
  openDiffForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openMissingSummaryForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openDiffFromSyncItem: (item: SyncPreviewItem) => void;
  closeDiff: () => void;
  closeMissingSummary: () => void;

  // Pullback actions
  pullbackFileInstance: (file: FileStatus, instance: DiffInstanceRef) => Promise<boolean>;
}

export type Store = AppState & Actions;

/** Wrapped set/get passed to each slice creator. Matches zustand's StoreApi. */
export type StoreSet = StoreApi<Store>["setState"];
export type StoreGet = StoreApi<Store>["getState"];

/** A slice creator receives the (wrapped) set + get and returns its state+actions. */
export type SliceCreator<T> = (set: StoreSet, get: StoreGet) => T;
