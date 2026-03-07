# Lessons

- When a user says an action "did nothing," verify the exact UI action path and result handling before assuming a backend install path mismatch.
- For Installed-tab per-tool plugin syncs, handle standalone component sources (e.g., a direct skill directory with `SKILL.md`) in addition to package-root layouts.
- Never emit success notifications for install/sync operations without checking linked item counts and surfaced errors.
- When a user asks for an action that "isn't there," inspect conditional UI visibility rules first; features may exist but be hidden by state predicates.
- For git pull actions in UI, always account for dirty working tree constraints; provide guardrails and explicit upstream/branch state instead of optimistic execution.
