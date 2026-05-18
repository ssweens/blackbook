# Plan: Namespaced Plugin Component Install for Non-Claude Tools

## Context
Claude is the exception: it handles plugins natively via `plugin.json` and its own plugin cache. All other tools (Pi, OpenCode, Codex, Amp) support recursive skill discovery, so plugin-owned skills/commands/agents should be installed under a plugin namespace directory:
- **Before (flat):** `~/.pi/agent/skills/midi-drum-production/SKILL.md`
- **After (namespaced):** `~/.pi/agent/skills/music-production/midi-drum-production/SKILL.md`

## Changes Required

### 1. Playbook Schema
- [x] Add `plugin_flat_install: z.boolean().default(false)` to `PlaybookSchema`
- [x] Set `plugin_flat_install: true` in `claude-code.yaml`

### 2. Type Definitions
- [x] Add `pluginFlatInstall: boolean` to `ToolTarget` interface
- [x] Add `pluginFlatInstall: boolean` to `ToolInstance` interface

### 3. Config Builder
- [x] `buildToolDefinitions()`: read `pb.plugin_flat_install` into `pluginFlatInstall`
- [x] `getToolInstances()`: pass `pluginFlatInstall` through to instances

### 4. Install Logic (`tui/src/lib/install.ts`)
- [x] `installPluginItemsToInstance()`: for `!pluginFlatInstall`, install to `<skillsDir>/<pluginName>/<skill>/`
- [x] `togglePluginComponent()`: use namespaced dest for non-flat tools
- [x] `getStandaloneSkills()`: recursively scan skills dir for non-flat tools
- [x] Component scanning (~line 1440): recursively scan for non-flat tools
- [x] `linkPluginToInstance()`: use namespaced dest for non-flat tools

### 5. Plugin Status (`tui/src/lib/plugin-status.ts`)
- [x] `getPluginToolStatus()`: check both flat and namespaced paths for installed detection
- [x] `togglePluginComponent()`: use namespaced dest for non-flat tools

### 6. Tests
- [x] Update `install.integration.test.ts` for namespaced paths
- [x] Update `install.test.ts` mock tools
- [x] Update `store.test.ts` mock tools
- [x] Update `app.e2e.test.tsx` mock tools
- [x] Update `managed-item.test.ts` mock tools
- [x] Run full test suite: `pnpm test` → 472/472, `pnpm typecheck`, `pnpm build`

### 7. Verification
- [x] TUI smoke test with tmux capture — boots correctly

## Version
- [x] Bump to `0.21.0`
- [x] Update `CHANGELOG.md`
