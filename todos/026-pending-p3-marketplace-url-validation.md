---
status: pending
priority: p3
issue_id: "026"
tags: [code-review, quality, validation]
dependencies: []
---

# Missing Input Validation on Marketplace URLs

## Problem Statement

Marketplace URLs from user input are used without validation. Invalid URLs, non-HTTPS URLs, or localhost URLs could cause unexpected behavior.

**Why it matters:** Better UX with early validation. Security consideration for non-HTTPS.

## Findings

### Evidence

**File:** `tui/src/lib/store.ts`

**Line 347:** `addMarketplace` accepts any URL
```typescript
addMarketplace: (name, url) => {
  // No URL validation!
  addMarketplaceToConfig(name, url);
```

**File:** `tui/src/lib/marketplace.ts`

**Line 203:** Fetches without validation
```typescript
const res = await fetch(marketplace.url, { headers });
// What if URL is invalid? file:// ? localhost?
```

## Proposed Solutions

### Option A: URL Validation Helper (Recommended)
**Pros:** Early error, better UX
**Cons:** May reject some valid edge cases
**Effort:** Small
**Risk:** Low

```typescript
interface UrlValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

function validateMarketplaceUrl(url: string): UrlValidationResult {
  try {
    const parsed = new URL(url);

    // Must be HTTP(S)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http or https protocol' };
    }

    // Warn on HTTP (but allow for local dev)
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      // Could warn or reject
    }

    // Must end with marketplace.json (optional strictness)
    if (!parsed.pathname.endsWith('marketplace.json')) {
      return { valid: false, error: 'URL should point to a marketplace.json file' };
    }

    return { valid: true, normalized: parsed.href };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
```

## Technical Details

### Affected Files
- `tui/src/lib/store.ts` - add validation in `addMarketplace`
- `tui/src/lib/marketplace.ts` - optionally validate before fetch
- New validation helper

## Acceptance Criteria

- [ ] URL validated when adding marketplace
- [ ] Clear error message for invalid URLs
- [ ] Warn on non-HTTPS (optional)
- [ ] Local file URLs handled appropriately

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
