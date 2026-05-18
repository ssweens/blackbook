## Current Work (2026-05-18)

**New Bug Report**: After installing a folder of skills via namespace bulk action ("Sync all to <Tool>") or per-skill install, the UI still shows the skills as "uninstalled/missing" in the Installed tab and namespace detail view.

**Root Cause Analysis**: The namespace-level `install_tool` handler in `App.tsx:handleNamespaceTreeAction()` captures a stale `ns` closure. `installSkillToInstance()` updates disk but the in-memory `standaloneSkills` array and resulting `NamespaceGroup` are not refreshed before the tree re-renders.

**Action Taken**: Created comprehensive **universal action contract** in `docs/plans/action-contract-checklist.md` that defines what **every** action (for Files, Skills, Plugins, Pi Packages, Namespaces, Tools) must do consistently:
- Refresh local view (`loadInstalledPlugins()` + rebuild data)
- Update per-tool install lists and counts accurately (using `(toolId, instanceId)`)
- Preserve detail view state where possible
- Show accurate notifications with counts
- Handle errors gracefully
- Avoid stale closures and React key collisions

### Immediate Fixes Needed
- [ ] Fix refresh pattern after all namespace skill mutations (ensure `loadInstalledPlugins()` is awaited before `groupSkillsByNamespace()` and `setDetail()`)
- [ ] Add `refreshDetailNamespace()` helper that always uses fresh store data
- [ ] Audit all `handleNamespaceTreeAction` paths against the new checklist
- [ ] Add regression test for "install folder of skills → UI updates immediately"

### Checklist Created
- [x] `docs/plans/action-contract-checklist.md` — master contract for ALL artifacts and ALL actions
- [x] Updated `tasks/lessons.md` with stale-closure and refresh-pattern lessons
- [x] Updated `tasks/todo.md` with new testing matrix and bug report

**Next**: Implement the fixes from the checklist, run full verification, bump version, update changelog.

See `docs/plans/action-contract-checklist.md` for the complete matrix.
