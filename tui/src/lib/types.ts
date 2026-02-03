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

export interface AssetMapping {
  source: string;  // relative to assets_repo; can be file, dir (trailing /), or glob
  target: string;  // relative to tool's configDir; destination file or directory
  overrides?: Record<string, string>;  // per-instance target overrides
}

export interface AssetConfig {
  name: string;
  // Simple single-source syntax (backward compatible)
  source?: string;
  defaultTarget?: string;
  overrides?: Record<string, string>;
  // Multi-file syntax (new)
  mappings?: AssetMapping[];
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
  detailPiPackage: PiPackage | null;
  notifications: Notification[];
  // Diff view state
  diffTarget: DiffTarget | null;
  diffSourceAsset: Asset | null;
  diffSourceConfig: ConfigFile | null;
  missingSummary: MissingSummary | null;
  missingSummarySourceAsset: Asset | null;
  missingSummarySourceConfig: ConfigFile | null;
  // Pi packages state
  piPackages: PiPackage[];
  piMarketplaces: PiMarketplace[];
  // Section navigation
  currentSection: DiscoverSection;
  discoverSubView: DiscoverSubView;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff View Types
// ─────────────────────────────────────────────────────────────────────────────

export type DiffItemKind = "asset" | "config";

export interface DiffInstanceRef {
  toolId: string;
  instanceId: string;
  instanceName: string;
  configDir: string;
}

export interface DiffInstanceSummary extends DiffInstanceRef {
  totalAdded: number;
  totalRemoved: number;
}

export type DiffFileStatus = "modified" | "missing" | "extra" | "binary";

export interface DiffFileSummary {
  id: string;              // stable key (e.g., relativePath)
  displayPath: string;     // shown in list (e.g., themes/dark.json)
  sourcePath: string | null;
  targetPath: string | null;
  status: DiffFileStatus;
  linesAdded: number;
  linesRemoved: number;
}

export interface DiffTarget {
  kind: DiffItemKind;
  title: string;           // e.g. "AGENTS.md" or "Pi Config"
  instance: DiffInstanceRef;
  files: DiffFileSummary[];
}

// Full render payload for DiffDetail
export interface DiffFileDetail extends DiffFileSummary {
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing Summary Types (for missing-only items, no drift)
// ─────────────────────────────────────────────────────────────────────────────

export interface MissingSummary {
  kind: DiffItemKind;
  title: string;
  instance: DiffInstanceRef;
  missingFiles: string[];   // relative paths
  extraFiles: string[];     // relative paths (for directory assets)
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Package Types
// ─────────────────────────────────────────────────────────────────────────────

export type PiPackageSourceType = "npm" | "git" | "local";

export interface PiPackage {
  name: string;
  description: string;
  version: string;
  source: string;           // e.g., "npm:@foo/bar", "git:github.com/user/repo", "/local/path"
  sourceType: PiPackageSourceType;
  marketplace: string;      // marketplace name (e.g., "npm", "playbook")
  installed: boolean;
  installedVersion?: string;
  hasUpdate?: boolean;
  // Package contents
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  // Metadata
  homepage?: string;
  repository?: string;
  author?: string;
  license?: string;
  // Popularity (npm only)
  weeklyDownloads?: number;
  monthlyDownloads?: number;
  popularity?: number;      // 0-1 score from npm
}

export interface PiMarketplace {
  name: string;
  source: string;           // URL or local path
  sourceType: PiPackageSourceType;
  packages: PiPackage[];
}

export interface PiSettings {
  packages: string[];       // installed package sources
}

// Section navigation for Discover/Installed tabs
export type DiscoverSection = "configs" | "assets" | "plugins" | "piPackages";

// Sub-view state for drilling into Plugins or Pi Packages
export type DiscoverSubView = "plugins" | "piPackages" | null;
