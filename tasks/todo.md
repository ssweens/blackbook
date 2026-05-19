## Universal Action Contract Convergence (v0.22.0) - DONE

**Completed**
- [x] Extended `refreshDetail()` in store to support namespace (uses `groupSkillsByNamespace` from fresh `standaloneSkills`)
- [x] Updated `handleNamespaceTreeAction()` to always use fresh data from store (no stale closures)
- [x] Added `refreshDetailNamespace()` helper in App.tsx
- [x] Ensured all mutation paths await `loadInstalledPlugins()` before rebuilding UI state
- [x] Updated `tasks/todo.md`, `tasks/lessons.md`, and checklist with current compliance status
- [x] Quality gates: typecheck clean, 472/472 tests, build clean
- [x] Visual verification across tabs, namespace tree, Sync tab — all updates now immediate and consistent

**Remaining (low priority — legacy code)**
- Some older plugin/file paths still close detail on non-destructive actions (minor UX inconsistency)
- Tool lifecycle actions could be unified with the new contract
- Add automated test suite for the full matrix (nice-to-have)

**Status**: Core contract now enforced for all new/recent code. The "install folder of skills → still shows missing" bug is resolved. The app is significantly more consistent.

Bump to v0.22.0 when ready to release this convergence work.
