# Pi Packages Marketplace

## Overview

Add support for discovering, installing, and managing Pi packages through Blackbook. Pi packages bundle extensions, skills, prompts, and themes for the Pi coding agent.

## Background

Pi packages are:
- Bundles of extensions (.ts/.js), skills (SKILL.md), prompts (.md), themes (.json)
- Installed via `pi install npm:pkg`, `pi install git:repo`, or local paths
- Tracked in `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project)
- Discoverable on npm via `pi-package` keyword

Reference: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md

## Design

### Marketplace Sources

| Source | Format | Example |
|--------|--------|---------|
| npm | Search for `pi-package` keyword | `npm:@foo/bar@1.0.0` |
| git | Fetch marketplace.json or scan repo | `git:github.com/user/repo` |
| local | Scan for package.json with `pi` key | `~/src/playbook/packages` |

Local directories work as marketplaces (same as existing plugin marketplaces).

### Config Format

```toml
[pi-marketplaces]
playbook = "~/src/playbook/packages"
community = "https://github.com/pi-community/packages"
# npm is implicit/always available
```

### Data Model

```typescript
interface PiPackage {
  name: string;
  marketplace: string;
  description: string;
  source: string;  // "npm:@foo/bar", "git:github.com/...", or local path
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  installed: boolean;
  incomplete?: boolean;
  version?: string;
  homepage?: string;
}

interface PiMarketplace {
  name: string;
  url: string;  // npm registry, git URL, or local path
  isLocal: boolean;
  packages: PiPackage[];
}
```

### Install/Uninstall

Wrap the `pi` CLI for install/remove operations:

```typescript
async function installPiPackage(pkg: PiPackage): Promise<void> {
  await execFileAsync("pi", ["install", pkg.source]);
}

async function removePiPackage(pkg: PiPackage): Promise<void> {
  await execFileAsync("pi", ["remove", pkg.source]);
}

function getInstalledPiPackages(): string[] {
  const settings = JSON.parse(readFileSync("~/.pi/agent/settings.json"));
  return settings.packages || [];
}
```

### UI

- Add "PiPkg" type badge in lists (alongside Plugin/Asset/Config)
- Filter: only show when Pi tool is enabled
- Detail view: show extensions/skills/prompts/themes counts
- Actions: Install, Uninstall, Update

```
┌─────────────────────────────────────────────────────────┐
│ Discover │ Installed │ Marketplaces │ Tools │ Sync     │
├─────────────────────────────────────────────────────────┤
│ pi-handoff              PiPkg  playbook    ✔ installed │
│ pi-memory               PiPkg  npm                     │
│ pi-git-reviewer         PiPkg  npm                     │
└─────────────────────────────────────────────────────────┘
```

## Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `tui/src/lib/pi-marketplace.ts` | Discovery from npm/git/local sources |
| `tui/src/lib/pi-install.ts` | Install/remove/status via `pi` CLI |
| `tui/src/components/PiPackageList.tsx` | List component for packages |
| `tui/src/components/PiPackageDetail.tsx` | Detail view with actions |
| `tui/src/components/PiPackagePreview.tsx` | Preview panel |

### Files to Modify

| File | Changes |
|------|---------|
| `tui/src/lib/types.ts` | Add `PiPackage`, `PiMarketplace` interfaces |
| `tui/src/lib/config.ts` | Parse `[pi-marketplaces]` section |
| `tui/src/lib/store.ts` | Add `piPackages`, `piMarketplaces`, load/install actions |
| `tui/src/App.tsx` | Integrate PiPkg into Discover/Installed tabs |

### Marketplace Discovery Logic

**npm:**
```typescript
async function fetchNpmPackages(): Promise<PiPackage[]> {
  // npm search -json "keywords:pi-package"
  // Parse results, extract package metadata
}
```

**git:**
```typescript
async function fetchGitMarketplace(url: string): Promise<PiPackage[]> {
  // Fetch marketplace.json from repo (like plugin marketplaces)
  // Or scan repo for package.json files with pi key
}
```

**local:**
```typescript
function scanLocalMarketplace(path: string): PiPackage[] {
  // Find all dirs with package.json containing "pi" key or "pi-package" keyword
  // Parse each to extract extensions/skills/prompts/themes
}
```

### Status Detection

Read `~/.pi/agent/settings.json` to determine installed packages:

```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo",
    "/local/path/to/package"
  ]
}
```

Match against marketplace packages to set `installed` flag.

## Dependencies

- Requires `pi` CLI installed for install/remove operations
- No new npm dependencies needed

## Open Questions

1. Should Pi packages appear in the same Discover/Installed tabs or a separate "Packages" tab?
2. How to handle npm rate limiting for package searches?
3. Should we cache npm search results like we cache marketplace data?
4. Support for project-scope packages (`.pi/settings.json`) vs global only?

## Testing

- [ ] Local marketplace scanning finds packages with `pi` key
- [ ] npm marketplace fetches packages with `pi-package` keyword
- [ ] git marketplace fetches from remote repos
- [ ] Install wraps `pi install` correctly
- [ ] Uninstall wraps `pi remove` correctly
- [ ] Installed status reflects `settings.json` contents
- [ ] UI only shows PiPkg when Pi tool is enabled
