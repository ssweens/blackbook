# Unified Asset and Config Path Handling

## Current State

### Configs
```toml
[sync]
config_repo = "~/src/playbook/config"

[[configs]]
name = "Pi Config"
tool_id = "pi"

[[configs.files]]
source = "pi/"           # Relative to config_repo
target = "agent"         # Relative to tool configDir
```

- ✅ Relative paths off `config_repo`
- ✅ Directory sync (trailing `/`)
- ✅ Glob patterns (`*.json`)
- ✅ Multi-file mappings
- ❌ Tool-specific (requires `tool_id`)

### Assets
```toml
[[assets]]
name = "AGENTS.md"
source = "/Users/ssweens/src/playbook/assets/AGENTS.md"  # Full path required
default_target = "AGENTS.md"

[assets.overrides]
"claude-code:default" = "CLAUDE.md"
```

- ❌ Requires absolute paths
- ❌ No directory sync support in config (code may handle it)
- ❌ No glob patterns
- ✅ Per-instance target overrides
- ✅ Syncs to ALL enabled tools (not tool-specific)

## Problems

1. **Path inconsistency**: Configs use relative paths, assets need absolute
2. **Feature gap**: Assets lack directory/glob support in config
3. **Mental model**: Two different systems for similar operations
4. **Maintenance**: Users must remember two different syntaxes

## Proposal: Unified Path Resolution

### Option A: Extend config_repo to assets

Add `assets_repo` (or reuse `config_repo`) as base for asset paths:

```toml
[sync]
config_repo = "~/src/playbook/config"
assets_repo = "~/src/playbook/assets"  # New, optional (defaults to config_repo)

[[assets]]
name = "AGENTS.md"
source = "AGENTS.md"              # Relative to assets_repo
default_target = "AGENTS.md"

[[assets]]
name = "Templates"
source = "templates/"             # Directory sync
default_target = "templates/"

[[assets]]
name = "JSON Configs"
source = "*.json"                 # Glob pattern
default_target = "."
```

**Pros:**
- Minimal config change
- Backward compatible (absolute paths still work)
- Familiar pattern from configs

**Cons:**
- Two repo settings to manage
- Doesn't fully unify the models

### Option B: Single sync_repo with subdirs

```toml
[sync]
repo = "~/src/playbook"

[[assets]]
name = "AGENTS.md"
source = "assets/AGENTS.md"       # Relative to repo
default_target = "AGENTS.md"

[[configs]]
name = "Pi Config"
tool_id = "pi"
source = "config/pi/"             # Relative to repo
target = "agent"
```

**Pros:**
- Single base path
- Cleaner mental model

**Cons:**
- Breaking change to existing configs
- May not fit all directory structures

### Option C: Merge assets into configs model (recommended)

Assets are really just "configs that sync to all tools". Unify them:

```toml
[sync]
config_repo = "~/src/playbook/config"

# Tool-specific config (existing)
[[configs]]
name = "Pi Config"
tool_id = "pi"

[[configs.files]]
source = "pi/"
target = "agent"

# All-tool sync (new: omit tool_id)
[[configs]]
name = "AGENTS.md"
# tool_id omitted = sync to ALL enabled tools

[[configs.files]]
source = "assets/AGENTS.md"
target = "AGENTS.md"

[[configs.files.overrides]]
"claude-code:default" = "CLAUDE.md"
"claude-code:claude-learning" = "CLAUDE.md"

# Directory asset
[[configs]]
name = "Templates"

[[configs.files]]
source = "assets/templates/"
target = "templates/"
```

**Pros:**
- Single unified model
- All features available to all sync types
- Per-file overrides (more granular than current assets)
- Consistent path handling

**Cons:**
- Breaking change for existing `[[assets]]` configs
- `[[configs]]` name is misleading for non-config files
- Migration needed

### Option D: Keep both, unify features (pragmatic)

Keep `[[assets]]` and `[[configs]]` separate but give assets the same features:

```toml
[sync]
config_repo = "~/src/playbook/config"
assets_repo = "~/src/playbook/assets"  # Optional, defaults to config_repo

# Assets: sync to ALL tools, relative paths
[[assets]]
name = "AGENTS.md"
source = "AGENTS.md"              # Relative to assets_repo

[[assets.files]]                  # New: multi-file support
source = "AGENTS.md"
target = "AGENTS.md"

[[assets.files.overrides]]        # Per-file overrides
"claude-code:default" = "CLAUDE.md"

# Or simple single-file syntax (backward compatible)
[[assets]]
name = "Simple Asset"
source = "simple.md"
default_target = "simple.md"

[assets.overrides]
"claude-code:default" = "SIMPLE_CLAUDE.md"
```

**Pros:**
- Backward compatible
- Clear separation (assets = all tools, configs = specific tool)
- Assets get directory/glob/multi-file features

**Cons:**
- Two systems to maintain
- Some code duplication

## Recommendation

**Option D (pragmatic)** for near-term:
1. Add `assets_repo` config (optional, defaults to `config_repo`)
2. Support relative paths in asset `source`
3. Add `[[assets.files]]` for multi-file/directory/glob support
4. Backward compatible - absolute paths and simple syntax still work

**Migration path:**
- Phase 1: Add relative path support + `assets_repo`
- Phase 2: Add `[[assets.files]]` multi-file syntax
- Phase 3: Consider Option C merge if usage patterns align

## Implementation Tasks

### Phase 1: Relative paths for assets
- [ ] Add `assets_repo` to config schema (optional)
- [ ] Update `getAssetSourceInfo()` to resolve relative paths
- [ ] Support `~` expansion in `assets_repo`
- [ ] Update README with new syntax
- [ ] Backward compatible: absolute paths still work

### Phase 2: Multi-file assets
- [ ] Add `[[assets.files]]` config parsing
- [ ] Support directory sync (trailing `/`)
- [ ] Support glob patterns
- [ ] Per-file target overrides within `[[assets.files]]`
- [ ] Update `getAssetToolStatus()` for multi-file
- [ ] Update `syncAssetInstances()` for multi-file

### Phase 3: Documentation & migration
- [ ] Migration guide for existing configs
- [ ] Update all examples in README
- [ ] Add validation warnings for deprecated patterns

## Example: Final unified syntax

```toml
[sync]
config_repo = "~/src/playbook/config"
assets_repo = "~/src/playbook/assets"

# Simple asset (backward compatible)
[[assets]]
name = "README"
source = "README.md"
default_target = "README.md"

# Asset with per-tool overrides (backward compatible)
[[assets]]
name = "AGENTS.md"
source = "AGENTS.md"
default_target = "AGENTS.md"

[assets.overrides]
"claude-code:default" = "CLAUDE.md"

# Multi-file asset (new)
[[assets]]
name = "Templates"

[[assets.files]]
source = "templates/"
target = "templates/"

[[assets.files]]
source = "prompts/*.md"
target = "prompts/"

# Config (unchanged)
[[configs]]
name = "Pi Config"
tool_id = "pi"

[[configs.files]]
source = "pi/"
target = "agent"
```
