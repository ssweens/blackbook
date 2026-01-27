import { create } from "zustand";
import type { Tab, Marketplace, Plugin, AppState, Notification } from "./types.js";
import { parseMarketplaces, addMarketplace as addMarketplaceToConfig, removeMarketplace as removeMarketplaceFromConfig, ensureConfigExists } from "./config.js";
import { fetchMarketplace } from "./marketplace.js";

// Ensure config file exists on module load
ensureConfigExists();
import {
  getAllInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
} from "./install.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: () => void;
  refreshAll: () => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  setDetailPlugin: (plugin: Plugin | null) => void;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => void;
  updateMarketplace: (name: string) => Promise<void>;
  notify: (message: string, type?: Notification["type"]) => void;
  clearNotification: (id: string) => void;
}

export type Store = AppState & Actions;

export const useStore = create<Store>((set, get) => ({
  tab: "discover",
  marketplaces: [],
  installedPlugins: [],
  search: "",
  selectedIndex: 0,
  loading: false,
  error: null,
  detailPlugin: null,
  detailMarketplace: null,
  notifications: [],

  setTab: (tab) => set({ tab, selectedIndex: 0, search: "", detailPlugin: null, detailMarketplace: null }),
  setSearch: (search) => set({ search, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  setDetailPlugin: (plugin) => set({ detailPlugin: plugin }),
  setDetailMarketplace: (marketplace) => set({ detailMarketplace: marketplace }),

  notify: (message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const notification: Notification = { id, message, type, timestamp: Date.now() };
    set((state) => ({ notifications: [...state.notifications, notification] }));
  },

  clearNotification: (id) => {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }));
  },

  loadMarketplaces: async () => {
    set({ loading: true, error: null });

    try {
      const marketplaces = parseMarketplaces();
      const { plugins: installedPlugins } = getAllInstalledPlugins();

      const enrichedMarketplaces: Marketplace[] = await Promise.all(
        marketplaces.map(async (m) => {
          const plugins = await fetchMarketplace(m);
          const installedCount = plugins.filter((p) =>
            installedPlugins.some((ip) => ip.name === p.name)
          ).length;

          return {
            ...m,
            plugins: plugins.map((p) => ({
              ...p,
              installed: installedPlugins.some((ip) => ip.name === p.name),
            })),
            availableCount: plugins.length,
            installedCount,
            updatedAt: new Date(),
          };
        })
      );

      set({
        marketplaces: enrichedMarketplaces,
        installedPlugins,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadInstalledPlugins: () => {
    const { plugins: installed } = getAllInstalledPlugins();
    const marketplaces = get().marketplaces.map((m) => ({
      ...m,
      plugins: m.plugins.map((p) => ({
        ...p,
        installed: installed.some((ip) => ip.name === p.name),
      })),
    }));
    set({ installedPlugins: installed, marketplaces });
  },

  refreshAll: async () => {
    await get().loadMarketplaces();
  },

  installPlugin: async (plugin) => {
    const { notify } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    notify(`Installing ${plugin.name}...`, "info");
    const result = await installPlugin(plugin, marketplace.url);
    
    if (result.success) {
      await get().refreshAll();
      
      const parts: string[] = [];
      if (result.claudeInstalled) parts.push("Claude");
      for (const [toolId, count] of Object.entries(result.linkedTools)) {
        if (count > 0) {
          const toolName = toolId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        notify(`✓ Installed ${plugin.name} → ${parts.join(", ")}`, "success");
      } else {
        notify(`⚠ Install ran but no items linked for ${plugin.name}`, "error");
      }
    } else {
      notify(`✗ Failed to install ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  uninstallPlugin: async (plugin) => {
    const { notify } = get();
    notify(`Uninstalling ${plugin.name}...`, "info");
    const success = await uninstallPlugin(plugin);
    await get().refreshAll();
    if (success) {
      notify(`✓ Uninstalled ${plugin.name}`, "success");
    } else {
      notify(`✓ Removed ${plugin.name} from other tools`, "success");
    }
    return success;
  },

  updatePlugin: async (plugin) => {
    const { notify } = get();
    const marketplace = get().marketplaces.find(
      (m) => m.name === plugin.marketplace
    );
    if (!marketplace) {
      notify(`Marketplace not found for ${plugin.name}`, "error");
      return false;
    }

    notify(`Updating ${plugin.name}...`, "info");
    const result = await updatePlugin(plugin, marketplace.url);
    
    if (result.success) {
      await get().refreshAll();
      
      const parts: string[] = [];
      if (result.claudeEnabled) parts.push("Claude");
      for (const [toolId, count] of Object.entries(result.linkedTools)) {
        if (count > 0) {
          const toolName = toolId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        notify(`✓ Updated ${plugin.name} → ${parts.join(", ")}`, "success");
      } else {
        notify(`✓ Updated ${plugin.name}`, "success");
      }
    } else {
      notify(`✗ Failed to update ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  addMarketplace: (name, url) => {
    const { notify } = get();
    const marketplaces = get().marketplaces;
    if (marketplaces.some((m) => m.name === name)) {
      notify(`Marketplace "${name}" already exists`, "error");
      return;
    }

    // Save to config file
    addMarketplaceToConfig(name, url);

    // Update state
    set({
      marketplaces: [
        ...marketplaces,
        {
          name,
          url,
          isLocal: url.startsWith("/"),
          plugins: [],
          availableCount: 0,
          installedCount: 0,
          autoUpdate: false,
          source: "blackbook",
        },
      ],
    });
    
    notify(`Added marketplace "${name}"`, "success");
    
    // Fetch plugins for the new marketplace
    get().updateMarketplace(name);
  },

  removeMarketplace: (name) => {
    const { notify } = get();
    
    // Remove from config file
    removeMarketplaceFromConfig(name);
    
    // Update state
    set({
      marketplaces: get().marketplaces.filter((m) => m.name !== name),
    });
    
    notify(`Removed marketplace "${name}"`, "success");
  },

  updateMarketplace: async (name) => {
    const marketplace = get().marketplaces.find((m) => m.name === name);
    if (!marketplace) return;

    const plugins = await fetchMarketplace(marketplace);
    const installedPlugins = get().installedPlugins;

    set({
      marketplaces: get().marketplaces.map((m) =>
        m.name === name
          ? {
              ...m,
              plugins: plugins.map((p) => ({
                ...p,
                installed: installedPlugins.some((ip) => ip.name === p.name),
              })),
              availableCount: plugins.length,
              installedCount: plugins.filter((p) =>
                installedPlugins.some((ip) => ip.name === p.name)
              ).length,
              updatedAt: new Date(),
            }
          : m
      ),
    });
  },
}));
