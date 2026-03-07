# TODO

- [x] Reproduce why Installed -> "Install to Pi" reports success but does not place skill files.
- [x] Fix plugin sync path handling for standalone installed components (e.g., Claude-scanned local skills).
- [x] Fix per-tool install notifications to reflect actual sync result/errors.
- [x] Add regression test coverage for standalone-source sync behavior.
- [x] Run quality gates (tests, typecheck, build) and document results.

## Review
- Investigated code paths used by Installed tab per-tool action.
- Found two root causes:
  1. `syncPluginInstances` assumed a package-root layout (`skills/`, `commands/`, `agents/`) and could not sync standalone component sources.
  2. `App.tsx` per-tool install action always reported success and ignored sync result.
- Implemented standalone-source fallback staging in `syncPluginInstances` so Installed-tab local/standalone components can sync to Pi.
- Updated per-tool install notification logic in `App.tsx` to show success only when items were actually linked.
- Added regression test: `src/lib/install.integration.test.ts` (`syncPluginInstances` standalone source case).
- Quality gates run:
  - `cd tui && pnpm test` ✅ (321 tests)
  - `cd tui && pnpm typecheck` ✅
  - `cd tui && pnpm build` ✅
