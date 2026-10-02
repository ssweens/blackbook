# Vendored: vercel-labs/skills

- Upstream: https://github.com/vercel-labs/skills (MIT, see `LICENSE`)
- Version: 1.7.0, commit `7407f3893ad4dceab546ac002c3ef806e4000c73` (2026-09-17)
- Upstream tests are not vendored. Blackbook's patch tests are in `src/store.test.ts`.

Blackbook bundles this CLI (`build.mjs` → `dist/vendor/skills`) and runs it as
`blackbook skills …` and from the Projects tab. Behavior matches upstream `npx skills`
except for one change: where project-scope skills are stored.

## The patch (`blackbook-store.patch`)

Upstream copies skills into `<project>/.agents/skills/<name>` (or `~/.agents/skills/<name>`
with `-g`). The vendored copy puts one shared copy in a central store and symlinks every
project, and the global dirs, to it:

```
~/.local/share/blackbook/skills/            ($SKILLS_STORE_DIR, default $XDG_DATA_HOME/blackbook/skills)
  github.com/<owner>/<repo>/<skill>
  gitlab.com/<group>/<repo>/<skill>
  <host>/<path>/<skill>                     generic git, well-known endpoints, direct downloads
  local/<absolute source path>/<skill>
  node_modules/<package>/<skill>            `skills experimental_sync`

<project>/.agents/skills/<skill>  -> store   (universal agents: Codex, OpenCode, Amp, Pi, …)
<project>/.claude/skills/<skill>  -> store   (each non-universal agent)
~/.agents/skills/<skill>          -> store   (-g, universal agents)
~/.claude/skills/<skill>          -> store   (-g, Claude Code and other non-universal agents)
```

- The store key comes from the source. Refs and branches are not part of the key, so
  each (source, skill) has exactly one copy, shared by every project.
- Store symlinks are absolute, so a project keeps working after it is moved.
- Installs always create symlinks. Upstream copies when every target shares one directory.
  Only `--copy` opts out.
- Only skills with a link are active. A skill can sit in the store and be linked only into
  the projects that list it, or also globally.
- `remove` removes the links and the lockfile entry. It leaves the store copy, because other
  projects may use it.
- `remove` and `update` also detect skills that exist only as symlinks.
- Telemetry and the skills.sh audit lookup are always off (`src/telemetry.ts`).
- **Workspace profile meta.** Blackbook records the profiles assigned to a workspace as a
  top-level `"profiles": [...]` array in that workspace's `skills-lock.json`. Upstream's
  `writeLocalLock` rebuilds the file as `{ version, skills }`, which would drop it on every
  `add`/`remove`; the vendored writer (`src/local-lock.ts`) carries the key through, sorted.
  The CLI never interprets it, and plain `npx skills` drops it (re-apply from Blackbook).
- **Dev shortcuts.** `SKILLS_DEV_SHORTCUTS` is a JSON map from a repo to a local checkout,
  for example `{"github.com/ssweens/playbook": "~/src/playbook"}`. Blackbook fills it from
  `settings.dev_shortcuts`. When a git source's store key matches a key exactly, skills are
  found in the checkout instead of fetched, and the store entry becomes a symlink into it.
  Edits then show up in every tool at once, with no push or update. Lockfiles and store keys
  still record the repo. A missing checkout falls back to the normal fetch.

Files changed: `src/store.ts` (new), `src/installer.ts`, `src/add.ts`, `src/sync.ts`, `src/remove.ts`,
`src/update.ts`, `src/telemetry.ts`, `src/local-lock.ts`.
Every changed spot is marked `BLACKBOOK PATCH`. (`blackbook-store.patch` predates the
`src/local-lock.ts` hunk — regenerate it against upstream on the next upgrade so step 3 below
re-applies the `profiles` carry-through too.)

## Upgrading

1. Check out the new upstream commit somewhere else.
2. Copy its `src/` (without `*.test.ts` and `test-utils.ts`), `bin/`, `package.json`,
   `tsconfig.json`, `LICENSE`, `ThirdPartyNoticeText.txt`, and `README.md` over this directory.
3. Re-apply the patch from `tui/` with `git apply --directory=vendor/skills --reject vendor/skills/blackbook-store.patch`.
   Resolve any `.rej` hunks by hand at the `BLACKBOOK PATCH` markers.
   Then regenerate the patch file against the new upstream.
4. Update the version and commit above. Then run `pnpm typecheck && pnpm test && pnpm build`.
