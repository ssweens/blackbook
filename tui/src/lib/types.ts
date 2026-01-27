export interface ToolTarget {
  id: string;
  name: string;
  configDir: string;
  skillsSubdir: string | null;
  commandsSubdir: string | null;
  agentsSubdir: string | null;
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
  scope: "user" | "project";
  updatedAt?: Date;
}

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
  kind: "skill" | "command" | "agent" | "hook" | "mcp";
  name: string;
  source: string;
  dest: string;
  backup: string | null;
}

export type Tab = "discover" | "installed" | "marketplaces";

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
  search: string;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  detailPlugin: Plugin | null;
  detailMarketplace: Marketplace | null;
  notifications: Notification[];
}
