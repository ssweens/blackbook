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
  incomplete?: boolean;
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
  incomplete?: boolean;
  drifted?: boolean;
  scope: "user" | "project";
  sourceExists?: boolean;
  sourceError?: string | null;
}

export interface ConfigMapping {
  source: string;  // relative to config_repo; can be file, dir (trailing /), or glob
  target: string;  // relative to tool's configDir; destination file or directory
}

export interface ConfigSyncConfig {
  name: string;
  toolId: string;
  // Legacy single-file support
  sourcePath?: string;  // relative to config_repo
  targetPath?: string;  // relative to tool's configDir
  // New multi-file support
  mappings?: ConfigMapping[];
}

export interface ConfigFile extends ConfigSyncConfig {
  installed: boolean;
  incomplete?: boolean;
  drifted?: boolean;
  scope: "user";
  sourceExists?: boolean;
  sourceError?: string | null;
  // Expanded source info for multi-file configs
  sourceFiles?: ConfigSourceFile[];
}

export interface ConfigSourceFile {
  sourcePath: string;
  targetPath: string;
  hash: string;
  isDirectory: boolean;
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
    }
  | {
      kind: "config";
      config: ConfigFile;
      drifted: boolean;
      missing: boolean;
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
  type: "info" | "success" | "warning" | "error";
  timestamp: number;
}

export interface AppState {
  tab: Tab;
  marketplaces: Marketplace[];
  installedPlugins: Plugin[];
  assets: Asset[];
  configs: ConfigFile[];
  tools: ToolInstance[];
  search: string;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  detailPlugin: Plugin | null;
  detailAsset: Asset | null;
  detailConfig: ConfigFile | null;
  detailMarketplace: Marketplace | null;
  notifications: Notification[];
}
