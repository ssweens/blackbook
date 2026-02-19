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

export type PackageManager = "npm" | "bun" | "pnpm";

export interface ToolDetectionResult {
  toolId: string;
  installed: boolean;
  binaryPath: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  error: string | null;
}

export interface ManagedToolRow {
  toolId: string;
  displayName: string;
  instanceId: string;
  configDir: string;
  enabled: boolean;
  synthetic: boolean;
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


// ─────────────────────────────────────────────────────────────────────────────
// Unified File Status (from declarative config + orchestrator check)
// ─────────────────────────────────────────────────────────────────────────────

export type FileCheckStatus = "ok" | "missing" | "drifted" | "failed";

export type DriftKind = "in-sync" | "source-changed" | "target-changed" | "both-changed" | "never-synced";

export interface FileInstanceStatus {
  toolId: string;
  instanceId: string;
  instanceName: string;
  configDir: string;
  status: FileCheckStatus;
  message: string;
  diff?: string;
  driftKind?: DriftKind;
}

export interface FileStatus {
  name: string;
  source: string;
  target: string;
  pullback: boolean;
  tools?: string[];
  instances: FileInstanceStatus[];
}

export type SyncPreviewItem =
  | {
      kind: "plugin";
      plugin: Plugin;
      missingInstances: string[];
    }
  | {
      kind: "tool";
      toolId: string;
      name: string;
      installedVersion: string;
      latestVersion: string;
    }
  | {
      kind: "file";
      file: FileStatus;
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
  enabled: boolean;
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

export interface PluginComponentConfig {
  disabledSkills: string[];
  disabledCommands: string[];
  disabledAgents: string[];
}

export type Tab = "discover" | "installed" | "marketplaces" | "tools" | "sync";

export interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  timestamp: number;
  spinner?: boolean;
}

export interface AppState {
  tab: Tab;
  marketplaces: Marketplace[];
  installedPlugins: Plugin[];
  files: FileStatus[];
  tools: ToolInstance[];
  managedTools: ManagedToolRow[];
  toolDetection: Record<string, ToolDetectionResult>;
  toolDetectionPending: Record<string, boolean>;
  toolActionInProgress: string | null;
  toolActionOutput: string[];
  search: string;
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  detailPlugin: Plugin | null;
  detailMarketplace: Marketplace | null;
  detailPiPackage: PiPackage | null;
  notifications: Notification[];
  // Diff view state
  diffTarget: DiffTarget | null;
  missingSummary: MissingSummary | null;
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

export type DiffItemKind = "file";

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
  sourceMtime: number | null;  // ms since epoch
  targetMtime: number | null;  // ms since epoch
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
  enabled: boolean;
  builtIn: boolean;         // true for npm (can't be deleted)
}

export interface PiSettings {
  packages: string[];       // installed package sources
}

// Section navigation for Discover/Installed tabs
export type DiscoverSection = "plugins" | "piPackages";

// Sub-view state for drilling into Plugins or Pi Packages
export type DiscoverSubView = "plugins" | "piPackages" | null;
