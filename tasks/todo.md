# Plan: Namespace-Level Skill Bulk Operations (Option A)

## Changes

### 1. Data Model
- [x] `tui/src/lib/install.ts`: Add `NamespaceGroup` interface + `groupSkillsByNamespace()`, `syncNamespaceToAllMissing()`, `resyncNamespaceDrifted()`, `deleteNamespaceEverywhere()`
- [x] `tui/src/lib/managed-item.ts`: Add `kind: "namespace"` to `ItemKind`, add `_namespace` to `ManagedItem`
- [x] `tui/src/lib/types.ts`: Add `"namespace"` to `DetailArtifact` union

### 2. Install Tab UI
- [x] `tui/src/tabs/InstalledTab.tsx`: Split skills into namespaced vs standalone, render namespace groups as first-class rows

### 3. Detail View
- [x] `tui/src/components/ItemDetail.tsx`: Add `NamespaceMetadata` component
- [x] `tui/src/App.tsx`: Wire `detailNamespace`, `detailNamespaceItem`, `setDetailNamespace`, namespace in `activeDetail`

### 4. Actions
- [x] `tui/src/lib/item-actions.ts`: Add `getNamespaceActions()` with sync missing, resync drifted, delete everywhere
- [x] `tui/src/lib/action-dispatch.ts`: Handle namespace `sync` and `delete_everywhere` actions
- [x] `tui/src/App.tsx`: Wire `syncNamespace`, `resyncNamespace`, `deleteNamespaceEverywhere` callbacks in `handleEntityAction`

### 5. Build / Test
- [x] `pnpm typecheck` → clean
- [x] `pnpm test` → 472/472 passing
- [x] `pnpm build` → clean
- [x] TUI smoke test → boots without crash

### 6. Version
- [x] Bump to `0.21.2`
- [x] Update `CHANGELOG.md`
