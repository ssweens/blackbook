import { create } from "zustand";
import type { Tab, Marketplace, Plugin, AppState, Notification, SyncPreviewItem } from "./types.js";
import {
  parseMarketplaces,
  addMarketplace as addMarketplaceToConfig,
  removeMarketplace as removeMarketplaceFromConfig,
  ensureConfigExists,
  getToolInstances,
  updateToolInstanceConfig,
  getEnabledToolInstances,
} from "./config.js";
import { fetchMarketplace } from "./marketplace.js";

// Ensure config file exists on module load
ensureConfigExists();
import {
  getAllInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  getPluginToolStatus,
  syncPluginInstances,
} from "./install.js";

interface Actions {
  setTab: (tab: Tab) => void;
  setSearch: (search: string) => void;
  setSelectedIndex: (index: number) => void;
  loadMarketplaces: () => Promise<void>;
  loadInstalledPlugins: () => void;
  loadTools: () => void;
  refreshAll: () => Promise<void>;
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  setDetailPlugin: (plugin: Plugin | null) => void;
  setDetailMarketplace: (marketplace: Marketplace | null) => void;
  addMarketplace: (name: string, url: string) => void;
  removeMarketplace: (name: string) => void;
  updateMarketplace: (name: string) => Promise<void>;
  toggleToolEnabled: (toolId: string, instanceId: string) => Promise<void>;
  updateToolConfigDir: (toolId: string, instanceId: string, configDir: string) => Promise<void>;
  getSyncPreview: () => SyncPreviewItem[];
  syncTools: (items: SyncPreviewItem[]) => Promise<void>;
  notify: (message: string, type?: Notification["type"]) => void;
  clearNotification: (id: string) => void;
}

export type Store = AppState & Actions;

function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
}

function getInstallStatus(plugin: Plugin, installedAny: boolean): { installed: boolean; partial: boolean } {
  if (!installedAny) return { installed: false, partial: false };

  const statuses = getPluginToolStatus(plugin);
  const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
  if (supportedEnabled.length === 0) return { installed: true, partial: false };

  const partial = supportedEnabled.some((status) => !status.installed);
  return { installed: true, partial };
}

function buildSyncPreview(plugins: Plugin[]): SyncPreviewItem[] {
  const preview: SyncPreviewItem[] = [];
  for (const plugin of plugins) {
    const statuses = getPluginToolStatus(plugin);
    const supportedEnabled = statuses.filter((status) => status.enabled && status.supported);
    if (supportedEnabled.length === 0) continue;
    const installedAny = supportedEnabled.some((status) => status.installed);
    if (!installedAny) continue;
    const missingInstances = supportedEnabled
      .filter((status) => !status.installed)
      .map((status) => status.name);
    if (missingInstances.length === 0) continue;

    preview.push({ plugin, missingInstances });
  }
  return preview;
}

export const useStore = create<Store>((set, get) => ({
  tab: "discover",
  marketplaces: [],
  installedPlugins: [],
  tools: getToolInstances(),
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

  loadTools: () => {
    set({ tools: getToolInstances() });
  },

  loadMarketplaces: async () => {
    set({ loading: true, error: null });

    try {
      const marketplaces = parseMarketplaces();
      const { plugins: installedPlugins } = getAllInstalledPlugins();
      const tools = getToolInstances();

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
              ...getInstallStatus(p, installedPlugins.some((ip) => ip.name === p.name)),
            })),
            availableCount: plugins.length,
            installedCount,
            updatedAt: new Date(),
          };
        })
      );

      const installedWithStatus = installedPlugins.map((plugin) =>
        ({ ...plugin, ...getInstallStatus(plugin, true) })
      );

      set({
        marketplaces: enrichedMarketplaces,
        installedPlugins: installedWithStatus,
        tools,
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
        ...getInstallStatus(p, installed.some((ip) => ip.name === p.name)),
      })),
    }));
    const installedWithStatus = installed.map((plugin) =>
      ({ ...plugin, ...getInstallStatus(plugin, true) })
    );
    set({ installedPlugins: installedWithStatus, marketplaces, tools: getToolInstances() });
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
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Installed ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
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
    const enabledInstances = getEnabledToolInstances();
    if (enabledInstances.length === 0) {
      notify("No tools enabled in config.", "error");
      return false;
    }
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
      const toolList = get().tools;
      const nameByKey = new Map(
        toolList.map((tool) => [instanceKey(tool.toolId, tool.instanceId), tool.name])
      );
      for (const [key, count] of Object.entries(result.linkedInstances)) {
        if (count > 0) {
          const toolName = nameByKey.get(key) || key;
          parts.push(`${toolName} (${count})`);
        }
      }
      
      if (parts.length > 0) {
        const skipped = result.skippedInstances.length > 0
          ? ` (skipped: ${result.skippedInstances.map((key) => nameByKey.get(key) || key).join(", ")})`
          : "";
        notify(`✓ Updated ${plugin.name} → ${parts.join(", ")}${skipped}`, "success");
      } else {
        notify(`✓ Updated ${plugin.name}`, "success");
      }
    } else {
      notify(`✗ Failed to update ${plugin.name}: ${result.errors.join("; ")}`, "error");
    }
    return result.success;
  },

  toggleToolEnabled: async (toolId, instanceId) => {
    const { notify } = get();
    const tools = getToolInstances();
    const tool = tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    if (!tool) {
      notify(`Unknown tool instance: ${toolId}:${instanceId}`, "error");
      return;
    }

    updateToolInstanceConfig(toolId, instanceId, { enabled: !tool.enabled });
    await get().refreshAll();
    notify(`${tool.name} ${tool.enabled ? "disabled" : "enabled"}`, "success");
  },

  updateToolConfigDir: async (toolId, instanceId, configDir) => {
    const { notify } = get();
    const trimmed = configDir.trim();
    if (!trimmed) {
      notify("Config directory cannot be empty.", "error");
      return;
    }
    updateToolInstanceConfig(toolId, instanceId, { configDir: trimmed });
    await get().refreshAll();
    const tool = get().tools.find((t) => t.toolId === toolId && t.instanceId === instanceId);
    notify(`Updated ${tool?.name ?? `${toolId}:${instanceId}`} config_dir`, "success");
  },

  getSyncPreview: () => {
    const { plugins } = getAllInstalledPlugins();
    return buildSyncPreview(plugins);
  },

  syncTools: async (items) => {
    const { notify } = get();
    if (items.length === 0) {
      notify("All enabled instances are in sync.", "success");
      return;
    }

    const marketplaces = get().marketplaces;
    notify(`Syncing ${items.length} plugins...`, "info");

    const errors: string[] = [];
    let syncedPlugins = 0;

    for (const item of items) {
      const marketplaceUrl = marketplaces.find((m) => m.name === item.plugin.marketplace)?.url;
      const statuses = getPluginToolStatus(item.plugin)
        .filter((status) => status.enabled && status.supported && !status.installed);
      if (statuses.length === 0) continue;

      const result = await syncPluginInstances(item.plugin, marketplaceUrl, statuses);
      if (result.success) syncedPlugins += 1;
      errors.push(...result.errors);
    }

    await get().refreshAll();

    if (syncedPlugins > 0) {
      notify(`✓ Synced ${syncedPlugins} plugins`, errors.length ? "success" : "success");
    }
    if (errors.length > 0) {
      notify(`⚠ Sync completed with errors: ${errors.slice(0, 3).join("; ")}`, "error");
    }
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
