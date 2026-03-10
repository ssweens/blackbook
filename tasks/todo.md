# Blackbook TUI Architecture Refactor

## Problem Statement

The codebase has grown organically with each new entity type (Plugin, File, PiPackage, Config, Asset, Marketplace, PiMarketplace) getting its own bespoke List, Detail, Action handler, and store logic. This creates:

- **App.tsx: 2131 lines, 245 if-branches, 28 useState hooks** — a god component that handles every entity type's navigation, input, and actions
- **5 nearly-identical list components** (PluginList, ConfigList, AssetList, FileList, PiPackageList) with the same windowing/scrolling logic copy-pasted
- **6 detail components** with their own Action interfaces, each with different shapes but fundamentally doing the same thing (show metadata + status + selectable actions)
- **5 separate action handlers** in App.tsx (`handleFileAction`, `handlePluginAction`, `handlePiPackageAction`, `handleMarketplaceAction`, `handlePiMarketplaceAction`)
- **Drift detection reimplemented 3 times** — hash-based in modules/, git-based in plugin-drift.ts, and hash functions duplicated between install.ts and modules/hash.ts
- **2 parallel marketplace systems** (Marketplace + PiMarketplace) with separate fetch, list, detail, and store flows
- **Source path resolution duplicated** in marketplace.ts, plugin-drift.ts, install.ts, and store.ts

Every new feature requires touching 5+ files because there's no shared abstraction.

---

## Refactor Plan

### Phase 1: Unified Item Model
**Goal:** One type hierarchy for all manageable things.

```typescript
// Base for anything Blackbook manages
interface ManagedItem {
  name: string;
  kind: "plugin" | "file" | "config" | "asset" | "pi-package";
  marketplace: string;          // source marketplace name
  description: string;
  installed: boolean;
  incomplete: boolean;
  scope: "user" | "project";
  // Per-instance status (replaces separate ToolInstallStatus, FileInstanceStatus)
  instances: ItemInstanceStatus[];
}

interface ItemInstanceStatus {
  toolId: string;
  instanceId: string;
  instanceName: string;
  configDir: string;
  status: "synced" | "changed" | "missing" | "failed" | "not-supported";
  driftKind?: DriftKind;
  sourcePath: string | null;
  targetPath: string | null;
  linesAdded: number;
  linesRemoved: number;
}
```

**Tasks:**
- [x] Define `ManagedItem` and `ItemInstanceStatus` in `lib/managed-item.ts`
- [x] Adapter functions: `pluginToManagedItem()`, `fileToManagedItem()`, `piPackageToManagedItem()`
- [x] Batch converters: `pluginsToManagedItems()`, `filesToManagedItems()`, `piPackagesToManagedItems()`
- [x] Tests: 24 tests covering all adapters, status mapping, line count extraction, batch conversion
- [x] Migrate store to maintain canonical `managedItems` (`ManagedItem[]`) alongside legacy arrays for compatibility
- [x] Add single `computeItemDrift()` entrypoint for all item kinds (`lib/item-drift.ts`) and route plugin drift through it in App

### Phase 2: Generic List Component
**Goal:** One list component for all entity types.

Replace PluginList, ConfigList, AssetList, FileList, PiPackageList with:

```tsx
interface ItemListProps {
  items: ManagedItem[];
  selectedIndex: number;
  maxHeight?: number;
  columns: ColumnDef[];       // configurable columns per tab
}

function ItemList({ items, selectedIndex, maxHeight, columns }: ItemListProps) {
  // Single windowing implementation
  // Single status badge rendering (installed, incomplete, changed, source missing)
  // Column widths computed from data
}
```

**Tasks:**
- [x] Build `ItemList` with configurable columns and windowing (`components/ItemList.tsx`)
- [x] Define column presets: `PLUGIN_COLUMNS` (name/type/marketplace) and `FILE_COLUMNS` (name/scope)
- [x] Auto-select columns from item kinds; shared `computeItemFlags` for status badges
- [x] Tests: 20 tests covering rendering, windowing, selection, badges, column auto-selection
- [x] Wire `ItemList` into App.tsx — replaced all PluginList, FileList, PiPackageList usages
- [x] Delete orphaned PluginList, ConfigList, AssetList, FileList, PiPackageList, PiPackageDetail (-756 lines)

### Phase 3: Generic Detail Component
**Goal:** One detail view pattern for all entity types.

Replace PluginDetail, FileDetail, PiPackageDetail with:

```tsx
interface ItemDetailProps {
  item: ManagedItem;
  actions: ItemAction[];
  selectedAction: number;
}

interface ItemAction {
  id: string;
  label: string;
  type: "diff" | "sync" | "install" | "uninstall" | "update" | "pullback" | "status" | "back";
  instance?: ItemInstanceSummary;
  statusColor?: string;
  statusLabel?: string;
}
```

**Tasks:**
- [x] Build `ItemDetail` with: header, metadata slot, instance list (with drift +/-), action list (`components/ItemDetail.tsx`)
- [x] Unified `ItemAction` type replacing `PluginAction` + `FileAction`
- [x] Kind-specific metadata components: `PluginMetadata`, `FileMetadata`, `PiPackageMetadata`
- [x] Shared `ActionRow` rendering for status/diff/action items
- [x] Tests: 26 tests covering rendering, selection, badges, metadata, action types
- [x] Wire `ItemDetail` into App.tsx — replaced PluginDetail, FileDetail, PiPackageDetail rendering
- [x] `buildItemActions(item: ManagedItem): ItemAction[]` unified builder (absorbs `buildPluginActions` + `getFileActions`)
- [x] Delete PluginDetail.tsx, FileDetail.tsx after migrating their exported functions

### Phase 4: Unified Action Dispatch
**Goal:** One action handler instead of five.

```typescript
async function handleItemAction(item: ManagedItem, action: ItemAction) {
  switch (action.type) {
    case "diff":     return openDiffForItem(item, action.instance);
    case "sync":     return syncItem(item);
    case "install":  return installItem(item, action.instance);
    case "uninstall": return uninstallItem(item, action.instance);
    case "update":   return updateItem(item);
    case "pullback": return pullbackItem(item, action.instance);
    case "back":     return closeDetail();
  }
}
```

**Tasks:**
- [x] Extract `handleItemAction` in `lib/action-dispatch.ts` with `DispatchCallbacks` interface
- [x] Single dispatch handles: back, status, diff, missing, sync, install, uninstall, update, install_tool, uninstall_tool, pullback
- [x] Kind-specific routing via `_plugin`/`_file`/`_piPackage` on ManagedItem
- [x] Tests: 16 tests covering every action type and edge cases
- [x] Wire into App.tsx — replaced handleFileAction, handlePluginAction, handlePiPackageAction with single handleEntityAction

### Phase 5: Input Router
**Goal:** Tame the 245-branch input handler.

```typescript
// Replace the single 500-line useInput callback with:
const inputRouter = useInputRouter({
  global: globalKeys,           // tab switch, quit
  list: listNavigation,         // up/down/enter/escape on lists
  detail: detailNavigation,     // up/down/enter/escape on detail views
  diff: diffNavigation,         // diff-specific keys
});
```

**Tasks:**
- [x] Extract input handling into composable hooks per view state (`input-hooks.ts`)
- [x] `useListInput(items, onSelect, onBack)` — shared list/sub-view input behavior
- [x] `useDetailInput(actions, onAction, onBack)` — shared detail/action input behavior
- [x] `useDiffInput()` — diff/missing overlay key handling
- [x] App.tsx now composes view input hooks (`handleDiffInput` → `handleDetailInput` → `handleListInput`)

### Phase 6: Unified Marketplace
**Goal:** One marketplace system, not two.

Currently `Marketplace` (blackbook plugins) and `PiMarketplace` (pi packages) have completely separate fetch, list, detail, and store flows. They should be one:

```typescript
interface Marketplace {
  name: string;
  url: string;
  isLocal: boolean;
  items: ManagedItem[];      // plugins AND packages, unified
  source: "blackbook" | "pi";
}
```

**Tasks:**
- [x] Merge `fetchMarketplace` and Pi marketplace fetching into one module flow (`marketplace.ts` now exports both plugin + pi marketplace loaders)
- [x] MarketplaceList shows all marketplaces (both sources) via unified row model (`buildMarketplaceRows`)
- [x] MarketplaceDetail works for both (`MarketplaceDetailView` + unified action model)
- [x] Delete PiMarketplaceList, PiMarketplaceDetail
- [x] Merge `pi-marketplace.ts` into `marketplace.ts`

### Phase 7: Deduplicate Infrastructure
**Goal:** Remove copy-pasted utilities.

**Tasks:**
- [x] Delete hash functions from install.ts, import from modules/hash.ts (removed ~60 lines of duplication)
- [x] Consolidate `expandTilde` — extracted to `path-utils.ts`, applied to marketplace.ts, plugin-drift.ts, install.ts (3 sites → 1)
- [x] Single `scanPluginContents(dir)` in path-utils.ts used by marketplace.ts and install.ts (removed ~115 lines of duplication)

---

## Expected Outcome

| Metric | Before | Current | Target |
|--------|--------|---------|--------|
| App.tsx lines | 2131 | **1792 (−339)** | ~1200 |
| App.tsx if-branches | 245 | **201 (−44)** | ~100 |
| App.tsx useState hooks | 28 | **20 (−8)** | ~15 |
| useInput callback | 604 lines | **102 lines (−83%)** ✅ | ~200 |
| List components | 5 (copy-pasted) | **1 (generic)** ✅ | 1 |
| Detail components | 6 | **1 (ItemDetail)** ✅ | 1 |
| Action handlers | 5 | **1 (handleEntityAction)** ✅ | 1 |
| Action builders | 3 (one per type) | **1 (buildItemActions)** ✅ | 1 |
| Drift detection | 3 implementations | 3 | 1 |
| Hash function copies | 2 | **1** ✅ | 1 |
| expandTilde copies | 3 | **1 (path-utils.ts)** ✅ | 1 |
| scanPluginContents copies | 2 | **1 (path-utils.ts)** ✅ | 1 |
| spinner/loading boilerplate | 8+ sites | **withSpinner helper** ✅ | 1 |
| **Deleted component files** | — | **11 files** ✅ | — |
| **New generic components** | — | **3 (ItemList + ItemDetail + MarketplaceDetailView)** ✅ | — |
| **New modules** | — | **9 (managed-item, action-dispatch, item-actions, path-utils, marketplace-detail, marketplace-row, input-hooks, item-drift + store helper)** ✅ | — |
| **New test count** | 346 | **441 (+95)** ✅ | — |
| **Net from main** | — | **+5097 / -3715** | — |

## Execution Order

Phase 1 → 2 → 3 → 4 (these build on each other)
Phase 5 can run in parallel with 3-4
Phase 6 can run after 1
Phase 7 can run anytime

Each phase is independently shippable and testable.

## Review Notes (latest)

- Update checks are now startup-only plus manual triggers (`R`), not tab-navigation driven.
- Source repo status is primed at startup and cached; Settings uses cached status on first render.
- Settings manual refresh (`R`) now explicitly refreshes source repo status with remote fetch.
- Fixed Installed-tab per-tool plugin actions after unified dispatch migration: `install_tool` / `uninstall_tool` now resolve target instance from either `action.instance` or `action.toolStatus`.
- Installed-tab section loading placeholders now reset correctly on refresh by toggling `installedPluginsLoaded` / `piPackagesLoaded` to `false` at load start.
- Fixed local marketplace plugin source resolution in install flow: when marketplace URL is `.claude-plugin/marketplace.json`, relative plugin `source` now resolves from repo root (not `.claude-plugin/`), restoring `Install to Pi` for playbook plugins like `eval-model`.
- Fixed update semantics: `updatePlugin` now updates only instances where the plugin is already installed (no implicit install to other enabled tools).
- Added plugin pullback actions in Installed detail for drifted instances (e.g. `Pull to source from Pi`) and wired dispatch/callback flow to copy changed plugin components from tool instance back into source repo.
- Extended pullback UX consistency: `p` shortcut now works for plugin detail (not just file detail), and Diff overlay now wires `p` pullback callback for file/plugin contexts.

