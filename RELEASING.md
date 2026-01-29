# Releasing Blackbook

## Prerequisites

### NPM Trusted Publisher (OIDC)

Trusted publishing is configured for secure, token-free publishing from GitHub Actions:

1. Visit https://www.npmjs.com/package/@ssweens/blackbook/access
2. Under "Trusted publishers", verify GitHub Actions is configured:
   - Organization: `ssweens`
   - Repository: `blackbook`
   - Workflow: `release.yml`
3. No npm tokens needed - authentication uses OpenID Connect (OIDC)

## Release Process

### 1. Update Version

```bash
cd tui
npm version patch  # or minor, major
```

This updates `package.json` and creates a git commit.

### 2. Create and Push Tag

```bash
git push origin main
git push --tags
```

The `release.yml` workflow triggers on `v*` tags and publishes to npm automatically.

### 3. Verify

- Check GitHub Actions for workflow status
- Verify package at https://www.npmjs.com/package/@ssweens/blackbook

## Manual Publish (Alternative)

If you need to publish without GitHub Actions:

```bash
cd tui
pnpm build
npm publish --access public
```

Requires `npm login` first.

## Version Guidelines

- **patch** (0.4.0 → 0.4.1): Bug fixes, minor improvements
- **minor** (0.4.0 → 0.5.0): New features, backward compatible
- **major** (0.4.0 → 1.0.0): Breaking changes
