---
status: pending
priority: p2
issue_id: "028"
tags: [tests, e2e, tui]
dependencies: []
---

# Add E2E coverage for remaining TUI user flows

## Problem Statement

Only a subset of critical TUI user journeys are covered by end-to-end tests. The coverage checklist in `docs/TEST_COVERAGE.md` lists multiple happy and problem paths that still lack automated E2E verification.

## Scope

- Discover flow variants (install single tool, update plugin)
- Installed tab uninstall and asset sync
- Sync tab multi-item selection and success summary
- Marketplace add/update flows
- Tools tab enable/disable
- Error paths (update failure, no enabled tools, invalid marketplace URL, asset source missing)

## Acceptance Criteria

- Each checklist item in `docs/TEST_COVERAGE.md` has a matching E2E test.
- Tests use outcome-focused assertions against visible TUI output.
