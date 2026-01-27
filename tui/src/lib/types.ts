export interface ToolTarget {
  id: string;
  name: string;
  configDir: string;
  skillsSubdir: string | null;
  commandsSubdir: string | null;
  agentsSubdir: string | null;
}

export interface ToolInstance {
  toolId: string;
  instanceId: string;
  name: string;
  configDir: string;
  skillsSubdir: string | null;
  commandsSubdir: string | null;
  agentsSubdir: string | null;
  enabled: boolean;
}

export interface ItemStatus {
  linked: boolean;
  missing: boolean;
  conflict: boolean;
  notSupported: boolean;
}

export interface Plugin {
  name: string;
  marketplace: string;
  description: string;
  source: string | { source: string; url?: string; repo?: string; ref?: string };
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: string[];
  hasMcp: boolean;
  hasLsp: boolean;
  homepage: string;
  installed: boolean;
  partial?: boolean;
  scope: "user" | "project";
  updatedAt?: Date;
}

export interface AssetConfig {
  name: string;
  source: string;
  defaultTarget?: string;
  overrides?: Record<string, string>;
}

export interface Asset extends AssetConfig {
  installed: boolean;
  partial?: boolean;
  drifted?: boolean;
  scope: "user" | "project";
  sourceExists?: boolean;
  sourceError?: string | null;
}

export type SyncPreviewItem =
  | {
      kind: "plugin";
      plugin: Plugin;
      missingInstances: string[];
    }
  | {
      kind: "asset";
      asset: Asset;
      missingInstances: string[];
      driftedInstances: string[];
    };

export interface Marketplace {
  name: string;
  url: string;
  isLocal: boolean;
  plugins: Plugin[];
  availableCount: number;
  installedCount: number;
  updatedAt?: Date;
  autoUpdate: boolean;
  source: "blackbook" | "claude";
}

export interface InstalledItem {
  kind: "skill" | "command" | "agent" | "hook" | "mcp" | "asset";
  name: string;
  source: string;
  dest: string;
  backup: string | null;
  owner?: string;
  previous?: InstalledItem | null;
}

export type Tab = "discover" | "installed" | "marketplaces" | "tools" | "sync";

export interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "error";
  timestamp: number;
}

export interface AppState {
  tab: Tab;
  marketplaces: Marketplace[];
  installedPlugins: Plugin[];
  assets: Asset[];
  tools: ToolInstance[];
  search: string;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  detailPlugin: Plugin | null;
  detailAsset: Asset | null;
  detailMarketplace: Marketplace | null;
  notifications: Notification[];
}
