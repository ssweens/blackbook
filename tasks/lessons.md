# Lessons

- When a user says an action "did nothing," verify the exact UI action path and result handling before assuming a backend install path mismatch.
- For Installed-tab per-tool plugin syncs, handle standalone component sources (e.g., a direct skill directory with `SKILL.md`) in addition to package-root layouts.
- Never emit success notifications for install/sync operations without checking linked item counts and surfaced errors.
- When a user asks for an action that "isn't there," inspect conditional UI visibility rules first; features may exist but be hidden by state predicates.
- For git pull actions in UI, always account for dirty working tree constraints; provide guardrails and explicit upstream/branch state instead of optimistic execution.
- For package updates, don't stop at warning users; provide a first-class repair action when install-method mismatch is detectable.
- If tab navigation still feels laggy after render optimizations, assume hidden background work is the culprit: remove startup auto-loads and expensive global effects before tuning smaller re-render details.
- Treat marketplace manifest metadata as untrusted shape-wise: normalize path-like entries (e.g. `./.claude/skills/foo`) before validation to avoid throw/catch hot paths and repeated error noise.
