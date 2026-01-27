---
status: completed
priority: p1
issue_id: "006"
tags: [code-review, security, critical]
dependencies: []
---

# GitHub Token Sent to Lookalike Domains

## Problem Statement

The code sends the user's GitHub token to any URL that contains the string "github", not just actual GitHub domains. An attacker could create a domain like `github-fake.attacker.com` or `not-github.com/github/` and receive the user's GitHub token.

**Why it matters:** GitHub tokens can have extensive permissions - repo access, workflow triggers, package publishing. Token theft could compromise all the user's repositories.

## Findings

### Evidence

**File:** `tui/src/lib/marketplace.ts`

**Lines 199-201:**
```typescript
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (token && marketplace.url.includes("github")) {  // VULNERABLE CHECK
  headers["Authorization"] = `token ${token}`;
}
```

**Lines 83-84:** Same pattern in `fetchGitHubTree`
```typescript
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (token) {
  headers["Authorization"] = `token ${token}`;
}
```

### Attack Vector

1. Attacker creates marketplace at `https://github-mirrors.attacker.com/marketplace.json`
2. User adds this marketplace to blackbook
3. URL contains "github" so token is sent
4. Attacker receives user's GitHub token

Or more subtly:
- `https://my-github-proxy.com/...`
- `https://enterprise.corp.com/github-mirror/...`

## Proposed Solutions

### Option A: Strict Domain Allowlist (Recommended)
**Pros:** Simple, secure, covers all GitHub domains
**Cons:** May miss enterprise GitHub instances
**Effort:** Small
**Risk:** Low

```typescript
function isGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const validHosts = [
      'github.com',
      'raw.githubusercontent.com',
      'api.github.com',
      'gist.github.com',
      'gist.githubusercontent.com',
    ];
    return validHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

// Usage
if (token && isGitHubUrl(marketplace.url)) {
  headers["Authorization"] = `token ${token}`;
}
```

### Option B: Enterprise GitHub Support
**Pros:** Supports GitHub Enterprise
**Cons:** More complex configuration
**Effort:** Medium
**Risk:** Low

```typescript
// In config.toml:
// [github]
// enterprise_hosts = ["github.corp.com"]

function isGitHubUrl(url: string): boolean {
  const parsed = new URL(url);
  const defaultHosts = ['github.com', 'raw.githubusercontent.com', 'api.github.com'];
  const enterpriseHosts = loadConfig().github?.enterprise_hosts || [];
  return [...defaultHosts, ...enterpriseHosts].includes(parsed.hostname);
}
```

### Option C: Per-Marketplace Token Config
**Pros:** Maximum flexibility
**Cons:** Complex UX
**Effort:** Large
**Risk:** Medium

## Recommended Action

Token is now only sent to known GitHub hostnames.

## Technical Details

### Affected Files
- `tui/src/lib/marketplace.ts` - lines 83-84, 199-201

### Components Affected
- Marketplace fetching
- GitHub tree fetching for plugin contents

## Acceptance Criteria

- [x] `isGitHubUrl()` helper created with strict hostname checking
- [x] Token only sent to verified GitHub hostnames
- [x] Unit tests for various URL patterns (including attack URLs)
- [ ] Consider: log when token would be sent (for debugging)
- [ ] Documentation updated about which domains receive token

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during security review |

## Resources

- [GitHub token security](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation)
