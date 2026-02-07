# Tool Lifecycle Management (Install / Update / Uninstall)

## Overview

Enhance the Tools tab to detect whether each default tool binary is installed on the system, compare installed vs latest versions, and provide install/update/uninstall actions directly from the TUI.

Critically, tool lifecycle must remain reachable even when a tool has no configured instances yet. The Tools view should always include all default tools (Claude, OpenCode, Amp, Codex, Pi), not just configured instances.

## Decisions

- Auto-detect tools on every app launch (async, cached for session)
- Only manage tools in `DEFAULT_TOOLS` (no custom tool installs yet)
- Support npm, bun, and pnpm as package managers (user-configurable)
- Never remove config directories on uninstall
- Always fetch and compare installed version vs latest available version
- Show lifecycle rows for all default tools even if no instance exists in `config.toml`
- For tools without configured instances, synthesize a default row (`instanceId = "default"`, disabled) so install/update/uninstall is available
- Persist synthesized rows only when user takes a config-changing action (toggle enabled, edit config dir)

## Supported Tools

| Tool | ID | Binary | Package |
|---|---|---|---|
| Claude Code | `claude-code` | `claude` | `@anthropic-ai/claude-code` |
| OpenCode | `opencode` | `opencode` | `opencode` |
| Amp Code | `amp-code` | `amp` | `@anthropic-ai/amp-code` |
| OpenAI Codex | `openai-codex` | `codex` | `@openai/codex` |
| Pi | `pi` | `pi` | `@mariozechner/pi-coding-agent` |

---

## Phase 1: Tool Registry & Detection

### New file: `tui/src/lib/tool-registry.ts`

Tool lifecycle metadata for each tool.

To avoid metadata drift, build this from existing tool definitions in `tui/src/lib/config.ts` (`getToolDefinitions()`), then enrich with lifecycle-only fields (`binaryName`, `npmPackage`, `versionArgs`, `homepage`).

```typescript
interface ToolRegistryEntry {
  toolId: string;
  displayName: string;          // from existing tool definitions
  defaultConfigDir: string;     // from existing tool definitions
  binaryName: string;           // e.g., "claude", "opencode", "pi"
  npmPackage: string;           // e.g., "@anthropic-ai/claude-code"
  versionArgs: string[];        // e.g., ["--version"]
  homepage: string;
}

const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  "claude-code": {
    toolId: "claude-code",
    displayName: "Claude",
    defaultConfigDir: "~/.claude",
    binaryName: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    versionArgs: ["--version"],
    homepage: "https://docs.anthropic.com/en/docs/claude-code",
  },
  // ... etc for each tool
};
```

### New file: `tui/src/lib/tool-detect.ts`

Detection functions:

```typescript
interface ToolDetectionResult {
  toolId: string;
  installed: boolean;
  binaryPath: string | null;      // result of `which <binary>`
  installedVersion: string | null; // parsed from `<binary> --version`
  latestVersion: string | null;    // from `npm view <pkg> version`
  hasUpdate: boolean;              // true when latestVersion > installedVersion
  error: string | null;            // detection error, if any
}
```

Functions:

- `detectToolBinary(entry: ToolRegistryEntry): Promise<{ installed: boolean; version: string | null; path: string | null }>`
  - Runs `which <binary>` to find path
  - Runs `<binary> <versionArgs>` to get version string
  - Parses version with regex (handles varied formats like `v1.2.3`, `claude-code 1.2.3`, etc.)

- `fetchLatestVersion(npmPackage: string, packageManager: PackageManager): Promise<string | null>`
  - Runs:
    - npm: `npm view <pkg> version`
    - pnpm: `pnpm view <pkg> version`
    - bun: `npm view <pkg> version` (bun CLI metadata commands require a local package context)
  - Falls back gracefully if offline (returns `null`, `hasUpdate` stays `false`)

- `detectTool(entry: ToolRegistryEntry, pm: PackageManager): Promise<ToolDetectionResult>`
  - Combines binary detection + latest version fetch
  - Computes `hasUpdate` via semver comparison

- `detectAllTools(pm: PackageManager): Promise<Record<string, ToolDetectionResult>>`
  - Runs `detectTool` for all entries in `TOOL_REGISTRY` in parallel (`Promise.all`)

### New file: `tui/src/lib/tool-view.ts`

Build the Tools tab rows from registry + configured instances:

```typescript
interface ManagedToolRow {
  toolId: string;
  displayName: string;
  instanceId: string;           // real instance id or synthetic "default"
  configDir: string;            // instance dir or registry default
  enabled: boolean;
  synthetic: boolean;           // true if row is not yet persisted in config
}
```

Function:
- `getManagedToolRows(): ManagedToolRow[]`
  - Includes all default tools from registry.
  - Uses configured instances where present.
  - If a tool has no configured instances, emits one synthetic default row so install/update/uninstall remains available.

### Version comparison

Use `semver` as a direct dependency (do not rely on transitive deps), or a lightweight compare function:

```typescript
function isNewerVersion(installed: string, latest: string): boolean
```

Compare major.minor.patch numerically. If parsing fails, return `false` (don't suggest updates on bad data).

---

## Phase 2: Package Manager Configuration

### Config additions

Add to `[sync]` section in `config.toml`:

```toml
[sync]
package_manager = "npm"   # "npm" | "bun" | "pnpm", defaults to "npm"
```

### Updates to `tui/src/lib/config.ts`

Add to `SyncConfig`:

```typescript
interface SyncConfig {
  // ... existing fields
  packageManager?: "npm" | "bun" | "pnpm";
}
```

Parse `package_manager` from TOML. Default to `"npm"` if not specified.

Also update `saveConfig()` so `package_manager` round-trips correctly:
- Write `package_manager` when set.
- Ensure `[sync]` is emitted when any sync field is set (`config_repo`, `assets_repo`, disabled marketplaces, or `package_manager`), not only when `config_repo` exists.

### New type: `tui/src/lib/types.ts`

```typescript
type PackageManager = "npm" | "bun" | "pnpm";
```

Add `ToolDetectionResult` to types (as defined above).

---

## Phase 3: Tool Lifecycle Operations

### New file: `tui/src/lib/tool-lifecycle.ts`

```typescript
type ProgressEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "done"; exitCode: number }
  | { type: "timeout"; timeoutMs: number }
  | { type: "cancelled" }
  | { type: "error"; message: string };

function buildInstallCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] }
function buildUpdateCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] }
function buildUninstallCommand(pm: PackageManager, pkg: string): { cmd: string; args: string[] }
```

Commands by package manager:

| Action | npm | bun | pnpm |
|---|---|---|---|
| Install | `npm install -g <pkg>` | `bun add -g <pkg>` | `pnpm add -g <pkg>` |
| Update | `npm update -g <pkg>` | `bun update -g <pkg>` | `pnpm update -g <pkg>` |
| Uninstall | `npm uninstall -g <pkg>` | `bun remove -g <pkg>` | `pnpm remove -g <pkg>` |
| View latest | `npm view <pkg> version` | `npm view <pkg> version` | `pnpm view <pkg> version` |

Main functions:

- `installTool(toolId: string, pm: PackageManager, onProgress: (event: ProgressEvent) => void, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<boolean>`
  - Spawns child process, pipes stdout/stderr to `onProgress`
  - Enforces timeout (default 5 minutes)
  - Supports cancellation via `AbortSignal`
  - Returns `true` on exit code 0

- `updateTool(toolId: string, pm: PackageManager, onProgress: (event: ProgressEvent) => void, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<boolean>`

- `uninstallTool(toolId: string, pm: PackageManager, onProgress: (event: ProgressEvent) => void, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<boolean>`

All three:
1. Look up `TOOL_REGISTRY[toolId]`
2. Build the command for the given package manager
3. Spawn with `child_process.spawn`, stream events
4. Kill process and emit `timeout` or `cancelled` when applicable
5. Return success/failure

---

## Phase 4: State Management

### Updates to `tui/src/lib/types.ts`

Add to `AppState`:

```typescript
interface AppState {
  // ... existing fields
  managedTools: ManagedToolRow[];
  toolDetection: Record<string, ToolDetectionResult>; // keyed by toolId
  toolActionInProgress: string | null;                // toolId being installed/updated/uninstalled
  toolActionOutput: string[];                         // capped rolling buffer (e.g. 200 lines)
}
```

### Updates to `tui/src/lib/store.ts`

New actions:

```typescript
// Tool rows
refreshManagedTools: () => void
  // Calls getManagedToolRows()
  // Ensures all default tools appear, even when unconfigured

// Detection
refreshToolDetection: () => Promise<void>
  // Reads packageManager from config
  // Calls detectAllTools(pm)
  // Sets toolDetection state

// Lifecycle
installToolAction: (toolId: string) => Promise<void>
  // Sets toolActionInProgress
  // Calls installTool with progress callback
  // Appends to toolActionOutput with cap (drop oldest when > max)
  // On complete: clears action state, calls refreshToolDetection, notifies

updateToolAction: (toolId: string) => Promise<void>
  // Same pattern as install

uninstallToolAction: (toolId: string) => Promise<void>
  // Same pattern as install

cancelToolAction: () => void
  // Aborts active lifecycle process via AbortController
```

Startup: call `refreshManagedTools()` + `refreshToolDetection()` during initial load (alongside existing marketplace fetch).

On config file refresh/reload, also call `refreshManagedTools()` so newly added/removed instances are reflected.

When a row is synthetic (tool had no persisted instances), `toggleToolEnabled` and `updateToolConfigDir` must create/persist `tools.<toolId>.instances[default]` before applying updates.

---

## Phase 5: UI Components

### Updated: `tui/src/components/ToolsList.tsx`

Each tool row gains:

```
❯ Claude (claude-code:default)  Enabled  ✓ v1.0.45  → v1.0.46
  ~/.claude
```

For synthetic rows (no persisted instance yet), show a dim marker:

```
❯ Amp (amp-code:default)  Not configured  ✗ Not installed
  ~/.config/amp
```

- Status icon: `✓` (green, installed) / `✗` (red, not installed) / `⟳` (gray, checking)
- Version: `v1.0.45` (dimmed)
- Update badge: `→ v1.0.46` (yellow) — only shown when `hasUpdate` is true
- Synthetic marker: `Not configured` for rows not yet persisted in config
- When `toolActionInProgress` matches this tool, show spinner

### New: `tui/src/components/ToolDetail.tsx`

Opened by pressing `Enter` on a tool in the list. Shows:

```
┌─────────────────────────────────────────┐
│ Claude Code                             │
│                                         │
│ Status      ✓ Installed                 │
│ Binary      /usr/local/bin/claude       │
│ Version     1.0.45                      │
│ Latest      1.0.46                      │
│ Config Dir  ~/.claude                   │
│ Enabled     Yes                         │
│ Homepage    https://docs.anthropic...   │
│                                         │
│ [Update]  [Uninstall]  [Edit Config]    │
│                                         │
│ i Install · u Update · d Uninstall      │
│ e Edit config · Space Toggle · Esc Back │
└─────────────────────────────────────────┘
```

Actions are context-dependent:
- Not installed → `[Install]`
- Installed, update available → `[Update]` `[Uninstall]`
- Installed, up to date → `[Uninstall]`
- Synthetic row (not configured) → `Install`, `Edit Config`, and `Toggle` are available; first toggle/edit persists a default instance in config

### New: `tui/src/components/ToolActionModal.tsx`

Confirmation + progress modal:

**Confirm state:**
```
┌────────────────────────────────────────────┐
│ Install Claude Code?                       │
│                                            │
│ Command: npm install -g @anthropic-ai/...  │
│                                            │
│ Enter to confirm · Esc to cancel           │
└────────────────────────────────────────────┘
```

For uninstall, add warning:
```
│ ⚠ Config directory (~/.claude) will NOT    │
│   be removed.                              │
```

**Progress state:**
```
┌────────────────────────────────────────────┐
│ Installing Claude Code...                  │
│                                            │
│ > npm install -g @anthropic-ai/claude-code │
│ added 142 packages in 8s                   │
│                                            │
│ ⟳ Running... (Esc to cancel)               │
└────────────────────────────────────────────┘
```

**Done state:**
```
│ ✓ Installed successfully                   │
│                                            │
│ Press any key to close                     │
```

### Updated: `tui/src/components/HintBar.tsx`

Context-aware hints when on Tools tab:

- Tool not installed: `Enter Detail · i Install · e Edit · Space Toggle`
- Installed, update available: `Enter Detail · u Update · d Uninstall · e Edit · Space Toggle`
- Installed, up to date: `Enter Detail · d Uninstall · e Edit · Space Toggle`
- Action in progress: `(Installing... Esc Cancel)`

---

## Phase 6: Key Bindings

### Updates to `tui/src/App.tsx`

When `tab === "tools"` (using `managedTools` list, not raw enabled-instance list):

| Key | Action | Condition |
|---|---|---|
| `Enter` | Open `ToolDetail` | Always |
| `i` | Open install confirmation | Tool not installed |
| `u` | Open update confirmation | Tool installed + `hasUpdate` |
| `d` | Open uninstall confirmation | Tool installed |
| `e` | Edit config directory | Always (existing) |
| `Space` | Toggle enable/disable | Always (existing) |
| `Esc` | Close detail/modal or cancel active lifecycle action | When detail/modal open or action running |

---

## Implementation Order

| Step | Files | Depends On |
|---|---|---|
| 1 | `tui/src/lib/tool-registry.ts` + tests | — |
| 2 | `tui/src/lib/tool-view.ts` + tests (managed rows + synthetic defaults) | Step 1 |
| 3 | `tui/src/lib/tool-detect.ts` + tests | Step 1 |
| 4 | `tui/src/lib/types.ts` (add `PackageManager`, `ToolDetectionResult`, `ManagedToolRow`) | — |
| 5 | `tui/src/lib/config.ts` (parse + save `package_manager`) + config round-trip tests | Step 4 |
| 6 | `tui/src/lib/tool-lifecycle.ts` + tests (timeout/cancel included) | Steps 1, 4 |
| 7 | `tui/src/lib/store.ts` (managed rows, detection state, lifecycle actions, output cap) | Steps 2, 3, 5, 6 |
| 8 | `tui/src/components/ToolsList.tsx` (status + synthetic marker) | Step 7 |
| 9 | `tui/src/components/ToolDetail.tsx` | Step 7 |
| 10 | `tui/src/components/ToolActionModal.tsx` (confirm/progress/cancel) | Step 7 |
| 11 | `tui/src/App.tsx` (key bindings + wiring) | Steps 8–10 |
| 12 | `tui/src/components/HintBar.tsx` (context-aware hints) | Step 7 |
| 13 | Tests: unit/integration/E2E covering detect → install → update → uninstall | All |
| 14 | Docs: `README.md`, `docs/TEST_COVERAGE.md` | All |

## Files Changed/Created

| File | Action |
|---|---|
| `tui/src/lib/tool-registry.ts` | **New** — Tool metadata registry (aligned with existing tool definitions) |
| `tui/src/lib/tool-registry.test.ts` | **New** — Registry tests |
| `tui/src/lib/tool-view.ts` | **New** — Managed tool rows (including synthetic defaults) |
| `tui/src/lib/tool-view.test.ts` | **New** — Managed row tests |
| `tui/src/lib/tool-detect.ts` | **New** — Binary detection + latest version fetching |
| `tui/src/lib/tool-detect.test.ts` | **New** — Detection tests (mocked child_process) |
| `tui/src/lib/tool-lifecycle.ts` | **New** — Install/update/uninstall via npm/bun/pnpm with timeout/cancel |
| `tui/src/lib/tool-lifecycle.test.ts` | **New** — Lifecycle tests (mocked child_process) |
| `tui/src/lib/types.ts` | **Edit** — Add `PackageManager`, `ToolDetectionResult`, `ManagedToolRow`, extend `AppState` |
| `tui/src/lib/config.ts` | **Edit** — Parse + save `package_manager` in `[sync]` |
| `tui/src/lib/config.test.ts` (or `asset-paths.test.ts`) | **Edit** — Add `package_manager` config round-trip tests |
| `tui/src/lib/store.ts` | **Edit** — Add managed tool rows, detection state, lifecycle actions, capped output buffer |
| `tui/src/components/ToolsList.tsx` | **Edit** — Show install status, version, synthetic marker, update badge |
| `tui/src/components/ToolDetail.tsx` | **New** — Detail panel with tool info + actions |
| `tui/src/components/ToolActionModal.tsx` | **New** — Confirm + progress + cancel + done modal |
| `tui/src/components/HintBar.tsx` | **Edit** — Context-aware tool hints |
| `tui/src/App.tsx` | **Edit** — Wire key bindings, detail view, modal state |
| `docs/TEST_COVERAGE.md` | **Edit** — Add tool lifecycle coverage entries |
| `README.md` | **Edit** — Document tool management feature |

## Edge Cases

| Case | Handling |
|---|---|
| Package manager not installed | Detect with `which npm/bun/pnpm` before running; show actionable error |
| npm permission errors (EACCES) | Detect in stderr, surface "Permission denied — try running with sudo or fix npm permissions" |
| Network offline | `fetchLatestVersion` returns `null`; `hasUpdate` stays `false`; show "Latest: unknown" |
| Version parse failure | `installedVersion` stays `null`; show "Installed (unknown version)" |
| Tool has no configured instances | Show synthetic default row so lifecycle actions remain available |
| Synthetic row is edited/toggled | Persist `tools.<toolId>.instances[default]` before applying update |
| Install interrupted | Re-detect on next launch; partial state is just "not installed" |
| Lifecycle command hangs | Enforce timeout, kill process, emit timeout error to modal + notification |
| User cancels running action | Abort process and preserve captured output for troubleshooting |
| Very noisy command output | Keep a capped rolling buffer (e.g. last 200 lines) to prevent memory growth |
| Multiple binaries in PATH | `which` returns the first; that's fine — it's what the user would run |
| Tool binary exists but not from npm | Still detected as installed; uninstall via selected PM may fail — show the error |
| bun selected for version checks | Use `npm view <pkg> version` (works outside project context) |

## Testing Strategy

### Unit tests (mocked)
- `tool-registry.test.ts`: Registry has all expected tools, entries have required fields, and aligns with existing tool definitions
- `tool-view.test.ts`: `getManagedToolRows()` always includes all default tools and creates synthetic defaults for unconfigured tools
- `tool-detect.test.ts`: Mock `child_process.execFile` for `which`, version commands, `npm view`; test installed/not-installed/error/offline paths; test version parsing with varied formats
- `tool-lifecycle.test.ts`: Mock `child_process.spawn` for install/update/uninstall; test progress events, success, failure, permission errors, timeout, cancellation; test command building for each package manager
- `config.test.ts`: verify `package_manager` parse/save round-trip (including `[sync]` emitted without `config_repo`)

### Integration tests
- Full detect → install → re-detect → update → uninstall → re-detect cycle (mocked at child_process boundary)
- Synthetic tool row → toggle/edit persists default instance in config

### E2E tests
- Tools tab shows detection status for configured and unconfigured default tools
- Enter opens detail with correct info
- Key shortcuts trigger correct modals
- Cancel in progress modal stops action and surfaces cancellation state
