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
- [ ] Migrate store to use `ManagedItem[]` instead of separate `installedPlugins`, `files`, `piPackages` (deferred — blocked on Phase 2-3)
- [ ] Single `computeItemDrift()` that handles all item kinds (deferred — absorbs plugin-drift.ts, file-copy check, directory-sync check)

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
- [ ] Wire `ItemList` into App.tsx (replace bespoke lists one-by-one)
- [ ] Delete PluginList, ConfigList, AssetList, FileList, PiPackageList after migration

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
- [ ] Build `ItemDetail` with: header, metadata, instance list (with drift +/-), action list
- [ ] Single `buildItemActions(item: ManagedItem): ItemAction[]` function
- [ ] Delete PluginDetail, FileDetail, PiPackageDetail (keep MarketplaceDetail, ToolDetail as-is — they're different enough)
- [ ] Update App.tsx to use single detail state: `detailItem: ManagedItem | null`

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
- [ ] Extract `handleItemAction` from App.tsx
- [ ] Merge `handleFileAction`, `handlePluginAction`, `handlePiPackageAction` into it
- [ ] Each `case` delegates to a kind-specific function when needed (e.g., `installPlugin` vs `installPiPackage`)
- [ ] Remove 200+ lines of branching from App.tsx

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
- [ ] Extract input handling into composable hooks per view state
- [ ] `useListInput(items, onSelect, onBack)` — shared by all list views
- [ ] `useDetailInput(actions, onAction, onBack)` — shared by all detail views
- [ ] `useDiffInput()` — diff view keys
- [ ] App.tsx becomes: render current view, attach current view's input hook

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
- [ ] Merge `fetchMarketplace` and Pi marketplace fetching into one flow
- [ ] MarketplaceList shows all marketplaces (both sources)
- [ ] MarketplaceDetail works for both
- [ ] Delete PiMarketplaceList, PiMarketplaceDetail
- [ ] Merge `pi-marketplace.ts` into `marketplace.ts`

### Phase 7: Deduplicate Infrastructure
**Goal:** Remove copy-pasted utilities.

**Tasks:**
- [ ] Delete hash functions from install.ts, use modules/hash.ts everywhere
- [ ] Consolidate source path resolution (marketplace.ts `resolveLocalMarketplacePath`, plugin-drift.ts `resolvePluginSource`, install.ts marketplace base resolution) into one `resolveMarketplaceSourceDir(marketplace)` function
- [ ] Single `scanPluginContents(dir)` used by both marketplace.ts and install.ts

---

## Expected Outcome

| Metric | Before | After |
|--------|--------|-------|
| App.tsx lines | 2131 | ~800 |
| App.tsx if-branches | 245 | ~60 |
| App.tsx useState hooks | 28 | ~10 |
| List components | 5 (copy-pasted) | 1 (generic) |
| Detail components | 6 | 2 (ItemDetail + MarketplaceDetail) |
| Action handlers | 5 | 1 |
| Drift detection | 3 implementations | 1 |
| Hash function copies | 2 | 1 |
| Source resolution | 4 places | 1 |

## Execution Order

Phase 1 → 2 → 3 → 4 (these build on each other)
Phase 5 can run in parallel with 3-4
Phase 6 can run after 1
Phase 7 can run anytime

Each phase is independently shippable and testable.
