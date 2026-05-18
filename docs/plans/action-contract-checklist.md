# Universal Action Contract Checklist

This is the **master contract** for every user-facing action in Blackbook. Every implementation of an action (install, sync, uninstall, pullback, delete-everywhere, track, update, etc.) **must** satisfy **all** items in its row for its artifact type.

**Goal**: Consistent, predictable, bug-free UX across Files, Skills, Plugins, Pi Packages, Namespaces, and Tools.

## Core Principles (Apply to ALL actions)

- **Single source of truth**: All views pull from the centralized store (`standaloneSkills`, `installedPlugins`, `files`, `piPackages`, etc.).
- **Refresh after mutation**: Every action that changes disk/config/git state **must** call the appropriate `load*()` + `refreshAll()` or targeted refresh.
- **Detail preservation**: If a detail view is open for the mutated item, it must be refreshed in place (do not close unless user chose "Back" or destructive action).
- **UI state**: Expanded tree nodes, selected indices, open tabs should survive non-destructive refreshes where possible.
- **Notifications**: Always use `withSpinner()` + success/error notification with counts (`3 installed, 1 failed`).
- **Error resilience**: Partial failures must be reported. Never leave UI in inconsistent state.
- **Unique React keys**: All list/tree items must have stable, globally unique keys (include `instanceId` for multi-instance tools).
- **No ghost lines**: Fixed-height viewports + ANSI clear + full-width padding on every row.

## Action Contract by Artifact Type

### Skills (Standalone + Namespace)

| Action | Must Do | Refresh | UI After Action |
|--------|---------|---------|-----------------|
| **Sync / Install to Tool** | `installSkillToInstance(skill, toolId, instanceId)` | `loadInstalledPlugins()` → rebuild `NamespaceGroup`/`StandaloneSkill` → `setDetail()` if open | Stay in detail/tree. Status row updates from "Missing" to "Synced". Counts update. |
| **Re-sync (drifted)** | Same as above (overwrites) | Same | Status changes "Drifted" → "Synced". Drift badge cleared. |
| **Sync all missing** (namespace) | `syncNamespaceToAllMissing(ns)` | Same | Namespace detail refreshes with new counts. Per-tool rows update. |
| **Re-sync all drifted** (namespace) | `resyncNamespaceDrifted(ns)` | Same | Same |
| **Pull to source from Tool** | `pullbackSkillToSource(skill, toolId, instanceId)` + auto-commit/push | Same | "not in git" badge → "in git". Source path appears. |
| **Track in source repo** (not-in-git) | Same as pullback using first install | Same | Same |
| **Uninstall from Tool** | `uninstallSkillFromInstance(skill, toolId, instanceId)` | Same | Status row disappears or becomes "Missing". |
| **Uninstall from all tools** | `uninstallSkillAllInstances(skill)` | Same | All per-tool rows gone. |
| **Uninstall namespace from Tool** | `uninstallNamespaceFromInstance(ns, toolId, instanceId)` | Same | All skills in namespace lose that tool's status row. |
| **Delete everywhere** | `deleteSkillEverywhere(skill)` or `deleteNamespaceEverywhere(ns)` | `loadInstalledPlugins()` + close detail | Item disappears from Installed tab. Namespace row gone if empty. |

### Plugins

| Action | Must Do | Refresh | UI After Action |
|--------|---------|---------|-----------------|
| **Install to all / to Tool** | `syncPluginInstances()` or per-instance | `refreshAll()` or `loadInstalledPlugins()` | Detail stays open. Status rows update from "Missing" to "Installed". Version shown. |
| **Update** | `updatePlugin()` via Claude CLI | Same | Version badge updates. "Update available" cleared. |
| **Uninstall from Tool** | `uninstallPluginFromInstance()` | Same | Status changes to "Not installed". |
| **Pull to source** | Pull all components from tool disk to source repo + commit | Same | Source path appears. |
| **Delete everywhere** | `deletePluginEverywhere()` (tools + cache + config) | `refreshAll()` + close detail | Plugin gone from Installed and Discover. |

### Files / Configs / Assets

| Action | Must Do | Refresh | UI After Action |
|--------|---------|---------|-----------------|
| **Sync** | Copy from source → target | `loadFiles()` | Status from "drifted/missing" → "installed (synced)". |
| **Pullback** | Copy from target → source + commit | Same | Source updated. Drift cleared. |
| **Delete everywhere** | Delete from all targets + source + config.yaml entry | `loadFiles()` + close detail | Item disappears from lists. |

### Pi Packages

| Action | Must Do | Refresh | UI After Action |
|--------|---------|---------|-----------------|
| **Install** | `pi install <source>` (local/global) | `loadPiPackages()` | Status "not installed" → "installed · in git". |
| **Uninstall** | `pi remove` + cleanup global manager | Same | Status "installed" → "not installed". |
| **Delete everywhere** | Uninstall + remove from `pi_packages` in config + source repo | `refreshAll()` + close detail | Package gone from Installed. |

### Tools

| Action | Must Do | Refresh | UI After Action |
|--------|---------|---------|-----------------|
| **Install / Update / Uninstall** | Use native lifecycle commands (`claude install`, `brew install`, etc.) | `refreshAll()` | Version/status updates in Tools tab and detail. |

## Technical Implementation Requirements

### 1. Refresh Pattern (Universal)
```ts
const store = useStore.getState();
await withSpinner("Doing X...", async () => { mutation(); }, store.notify, store.clearNotification);
await store.loadInstalledPlugins({ silent: true });   // or loadFiles(), refreshAll(), etc.
if (detail?.kind === "namespace" && nsName) {
  const updated = groupSkillsByNamespace(store.standaloneSkills).find(n => n.name === nsName);
  if (updated) setDetail({ kind: "namespace", data: updated });
} else if (detailItem) {
  refreshDetail(detailItem);  // unified refreshDetail()
}
```

### 2. State Management Rules
- Never mutate local closure copies of data
- Always re-query store after mutation
- `setDetail()` with fresh data from `groupSkillsByNamespace()` or equivalent
- `expandedSkills` cleared only on full close (`closeDetail()`)
- Cursor index clamped after tree mutations

### 3. Testing Matrix (Run after ANY change to actions)
- [ ] Install from namespace bulk action → UI updates immediately (no "still missing")
- [ ] Install from per-skill action → namespace counts + individual status both update
- [ ] Multi-instance tools (Claude + Claude Learning) show independent status
- [ ] Expand/collapse during/after action → no ghost lines, cursor valid
- [ ] Tab switch while detail open → returns to same detail on return
- [ ] Delete everywhere → item fully removed from all views
- [ ] Pullback/track → "not in git" → "in git" badge updates
- [ ] Mixed state (some tools have skill, some don't) → accurate counts per instance
- [ ] Large namespace (>28 items) → viewport scrolling works with indicators

### 4. Common Pitfalls (Avoid These)
- Using stale `ns` or `skill` object from render closure
- Forgetting to await `loadInstalledPlugins()` before rebuilding `NamespaceGroup`
- Using only `toolId` instead of `(toolId, instanceId)` for multi-instance tools
- Not calling `refreshDetail()` or equivalent after mutation
- Closing detail view on every action (breaks "stay in place" UX)
- Missing `instanceId` in React `key` props → Ink errors + ghost lines

**Status**: This checklist is the source of truth. Update it when new artifact types or actions are added.
**Owner**: Blackbook TUI team
**Last updated**: 2026-05-18
