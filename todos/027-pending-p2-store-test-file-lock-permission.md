---
status: closed
priority: p2
issue_id: "027"
tags: [tests, vitest, file-lock]
dependencies: []
---

# Store sync preview test fails due to file lock permissions

## Problem Statement

`pnpm test` fails in `tui/src/lib/store.test.ts` on "builds a sync preview for partial plugins" with `EACCES` when creating the config lock file.

## Evidence

- Command: `cd tui && pnpm test`
- Failure:
  - `EACCES: permission denied, open .../config.lock`
  - Stack: `withFileLockSync` → `loadConfig` → `loadAssets` → `getSyncPreview`

## Notes

The test appears to use a default config path that is not writable in the current test environment. The lock file creation (`openSync` with `wx`) is failing.

## Resolution

Avoided invoking `loadAssets()` in the sync preview test by seeding assets and mocking asset status/source helpers, preventing filesystem lock access during the test run.
