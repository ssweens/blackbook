## Universal Action Contract Convergence - Phase 2 (v0.23.0) ✅ DONE

### Completed
- [x] Removed remaining non-destructive detail-close behavior for skill uninstall-all in `App.tsx`
- [x] Updated `action-dispatch.ts` so skill uninstall-all now calls `refreshDetailSkill` (same contract as other non-destructive actions)
- [x] Updated `store.refreshAll()` to always invoke `refreshDetail()` after reloads
- [x] Updated `store.syncTools()` to await targeted reloads (`loadFiles`, `loadInstalledPlugins`, `loadPiPackages`) and call `refreshDetail()`
- [x] Updated `store.pullbackFileInstance()` to await `refreshAll()` (no more fire-and-forget stale detail windows)
- [x] Added dispatcher regression test for skill uninstall-all refresh contract
- [x] Added store regression test for sync-detail refresh contract
- [x] Passed quality gates: typecheck, build, and full test suite (`474/474`)
- [x] Performed tmux visual verification captures (`/tmp/bbverify-start2.txt`, `/tmp/bbverify-loaded.txt`)

### Result
All previously identified remaining contract gaps are now closed in the primary action paths. Non-destructive mutations preserve detail state and refresh from fresh store data consistently.

### Notes
- The universal contract checklist remains the source of truth for future features and regressions.
- Keep using tmux capture verification for UI-affecting changes.

## Follow-up bugfix (2026-05-18): Pi should show ssmp as installed

### Problem
- User reported Pi should show `ssmp` skillset as installed but UI did not.

### Root cause
- `getStandaloneSkills()` for non-flat tools (`pluginFlatInstall=false`) only scanned namespaced layout (`skills/<namespace>/<skill>/SKILL.md`).
- Actual Pi disk state was legacy flat layout (`skills/<skill>/SKILL.md`), so installs were missed and rendered as source-only.

### Fix
- Added compatibility scan path for non-flat tools to also detect legacy flat layout.
- Kept preferred namespaced behavior intact.
- Source-repo namespace mapping still assigns `ssmp` via `skills/ssmp/<skill>/SKILL.md`.

### Validation
- Real file state: confirmed Pi skill dirs exist on disk.
- Scanner state: `getStandaloneSkills()` now reports `ssmp` skills with Pi installations.
- App/store state: `loadInstalledPlugins()` now yields `standaloneSkills` with `namespace==='ssmp'` and Pi installs.
- Added integration tests:
  - `detects flat Pi skills on disk and maps them to ssmp namespace via source_repo`
  - `installs standalone skills to namespaced paths on non-flat tools`
  - `migrates legacy flat standalone skills to namespaced paths`
- Test suite now: `477/477` passing.
- Real migration verified on local Pi disk: legacy `~/.pi/agent/skills/<skill>` moved to `~/.pi/agent/skills/ssmp/<skill>` for 27 ssmp skills.
- **Namespace tree Enter key**: pressing Enter on a skill-header now opens the full standalone skill detail view (identical to Skills section), with all per-tool actions. Right arrow expands/collapses. Verified via tmux UI capture.

## Follow-up tests + upgrade refresh fix (2026-05-19)

### Completed
- [x] Fixed stale post-update plugin state by updating `store.refreshAll()` to reload installed plugins (`await loadInstalledPlugins({ silent })`) before tool/pi/file refreshes.
- [x] Added regression test: `refreshAll reloads installed plugins so stale state is cleared`.
- [x] Added regression test: `produces identical actions for a skill whether opened standalone or from namespace tree`.
- [x] Stabilized store test harness mocks for this path (`getStandaloneSkills`, `getManagedToolRows`) to isolate refresh behavior.
- [x] Quality gate passed: `pnpm test -- --run` (`479/479`).

### Result
- Plugin update flows now clear stale `hasUpdate`/upgrade UI state after refresh.
- Skill detail action generation is explicitly covered for both standalone and namespace entry paths.

## Follow-up bugfix (2026-05-19): newly installed Pi package not listed

### Problem
- User uninstalled one Pi package and installed a different one, but Blackbook still showed only the old package.

### Root cause
- `loadPiPackages()` only imported **installed-but-unlisted** packages from `settings.packages` when source started with `npm:`.
- Installed `git`/`local` Pi package sources were skipped entirely unless they were marketplace-listed or repo-prescribed.

### Fix
- Updated `loadPiPackages()` to include installed non-marketplace packages from **all** source types (`npm`, `git`, `local`) from `settings.packages`.
- Kept richer npm metadata behavior for `npm:` sources.
- Added regression test: `includes installed non-npm Pi packages from settings when not marketplace-listed`.

### Validation
- `pnpm test -- --run` → `480/480` passing.
- `pnpm typecheck` passed.
- `pnpm build` passed.

## Hardening pass (2026-05-19): Pi package listing gaps + shared source normalization

### Additional gaps identified
- Source matching logic was split/inconsistent:
  - store path used raw lowercase (`source.toLowerCase()`),
  - install checks used path-aware matching,
  - git source aliases (`git:github.com/...`, `https://github.com/...`, `owner/repo`) were not treated uniformly.
- Resulting risk: duplicate rows, missed rows, and stale-looking package inventory depending on source form.

### Fixes
- Added shared source-normalization utility in `marketplace.ts`:
  - `normalizePiPackageSource(source)`
  - `isPackageInstalled()` now uses it.
- Expanded `getSourceType()` to classify git shorthand forms as git (`github.com/...`, `owner/repo`).
- Refactored `store.loadPiPackages()` dedupe/matching to use shared normalization everywhere:
  - desired-spec matching
  - existing-source dedupe set
  - installed package ingestion from settings

### New regression tests
- `includes installed non-npm Pi packages from settings when not marketplace-listed`
- `does not duplicate installed git package when source uses equivalent git forms`
- `does not duplicate installed npm package when source differs only by case`
- `does not show duplicate rows when same package is installed from local source but prescribed via npm`

### Correction
- Removed name-based merge for Pi package rows. Install state is now strictly source-specific.
- Same package name from different sources (e.g. `npm:pi-web-access` vs local `../../src/pi-packages/pi-web-access`) remains as separate rows.
- This prevents a local package from incorrectly marking npm package rows as installed.

### Validation
- `pnpm test -- --run` → `483/483` passing.
- `pnpm typecheck` passed.
- `pnpm build` passed.

## Follow-up UI bugfix (2026-05-20): Installed tab missing in-git Pi package rows + non-alphabetical ordering

### Problem
- Installed tab did not reliably show prescribed (`in git`) Pi package rows when they were not installed.
- User expectation (and product requirement) is that prescribed rows remain visible in Installed tab.
- Default Installed-tab Pi package order must stay alphabetical.

### Root cause
- `App.tsx` Installed-tab Pi package selector used `effectivePiPackages.filter((p) => p.installed)`, dropping `recommended` (`in git`) rows from the view model used by navigation/rendering.
- Sorting in `App.tsx`/`InstalledTab.tsx` default path grouped by installed state rather than strict alphabetical order.

### Fix
- `tui/src/App.tsx`
  - Installed Pi package base set now includes prescribed rows: `p.installed || p.recommended`.
  - Default sort now strictly alphabetical with stable source tiebreakers:
    - `name`
    - `sourceType`
    - `source`
- `tui/src/tabs/InstalledTab.tsx`
  - Matched default sort behavior to strict alphabetical + stable source tiebreakers.
- Added E2E regression in `tui/src/app.e2e.test.tsx`:
  - `shows both installed and in-git-not-installed pi package variants in alphabetical default order`

### Verification plan
- [x] Run targeted quality gates (app.e2e, typecheck, build).
- [x] Verify in tmux Installed tab that both `pi-web-access` rows are visible:
  - local installed (`not in git`)
  - npm prescribed not-installed (`in git`)
- [x] Capture final tmux proof output (`/tmp/blackbook-installed-piweb-fixed2.txt`).
