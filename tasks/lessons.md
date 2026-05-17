# Lessons

- Do not reduce flicker by removing boot hydration; users should not have to press refresh on startup. Preserve automatic initial data load and eliminate repeated/navigation-triggered reloads instead.
- Tab components must be presentational only; loader/detection effects in tab component mounts will re-run on every navigation because inactive tabs unmount.
- Before launching external UI verification or screenshot automation, say exactly what will open, what will be captured, and why; otherwise normal verification can look like unexplained side effects.
- Mutation actions that refresh store data must also refresh any open detail view inside the store action; do not rely solely on caller-side UI shims after install/update/uninstall.
- After deleting stale plugin caches/manifests, verify both marketplace rows and `installedPlugins`; Installed tab renders `installedPlugins`, so marketplace `installed: true` alone is not enough.
- For TUI list navigation bugs, test row marker, preview metadata, store index, and Enter-opened detail together; a fixed container height can clip rows independently from previews and create apparent skipped/repeated selections.
- When fixing a user-reported unavailable action, trace every UI entry point (list shortcut, detail view action builder, action dispatcher, backend effect) before claiming it works; stale detail presenters can keep showing disabled/read-only behavior even after shortcut paths are fixed.
- Do not turn a third-party plugin's private installer behavior (prefixes, ad-hoc manifests, generated layout) into a Blackbook convention or generic standard. First inspect the plugin's actual source, then decide whether Blackbook should rely only on declared marketplace metadata / Blackbook-owned install records, or explicitly model the artifact as externally managed.
- When a user says an action "did nothing," verify the exact UI action path and result handling before assuming a backend install path mismatch.
- For Installed-tab per-tool plugin syncs, handle standalone component sources (e.g., a direct skill directory with `SKILL.md`) in addition to package-root layouts.
- Never emit success notifications for install/sync operations without checking linked item counts and surfaced errors.
- When a user asks for an action that "isn't there," inspect conditional UI visibility rules first; features may exist but be hidden by state predicates.
- For git pull actions in UI, always account for dirty working tree constraints; provide guardrails and explicit upstream/branch state instead of optimistic execution.
- For package updates, don't stop at warning users; provide a first-class repair action when install-method mismatch is detectable.
- If tab navigation still feels laggy after render optimizations, assume hidden background work is the culprit: remove startup auto-loads and expensive global effects before tuning smaller re-render details.
- Treat marketplace manifest metadata as untrusted shape-wise: normalize path-like entries (e.g. `./.claude/skills/foo`) before validation to avoid throw/catch hot paths and repeated error noise.
