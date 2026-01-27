---
status: completed
priority: p2
issue_id: "010"
tags: [code-review, resource-cleanup, quality]
dependencies: []
---

# Temp Directory Leaks on Error Paths

## Problem Statement

The `downloadPlugin()` function creates temporary directories in `/tmp` but doesn't clean them up on all error paths. Over time, this can fill up the temp directory.

**Why it matters:** Disk space exhaustion, especially on systems with small `/tmp` partitions. Also leaves potentially sensitive repository data in world-readable temp directories.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 93-112:**
```typescript
const tempDir = join(tmpdir(), `blackbook-clone-${Date.now()}`);
await execAsync(`git clone --depth 1 --branch "${ref}" "${repoUrl}" "${tempDir}"`);

const sourceDir = subPath ? join(tempDir, subPath) : tempDir;

if (!existsSync(sourceDir)) {
  rmSync(tempDir, { recursive: true, force: true });  // Cleaned here
  rmSync(pluginDir, { recursive: true, force: true });
  return null;
}

cpSync(sourceDir, pluginDir, { recursive: true });

rmSync(tempDir, { recursive: true, force: true });  // Cleaned on success

return pluginDir;
} catch {
  rmSync(pluginDir, { recursive: true, force: true });  // pluginDir cleaned
  return null;
  // BUT tempDir IS NOT CLEANED!
}
```

### Additional Location

**Lines 194-206:** `createSymlink()` temp file
```typescript
const tmpPath = join(tmpdir(), `.tmp_${Date.now()}`);
try {
  symlinkSync(source, tmpPath);
  renameSync(tmpPath, target);
  return true;
} catch {
  try {
    unlinkSync(tmpPath);  // Attempts cleanup but failure is ignored
  } catch {
    // Temp file may remain
  }
  return false;
}
```

## Proposed Solutions

### Option A: try/finally Pattern (Recommended)
**Pros:** Guarantees cleanup, simple
**Cons:** Slightly more verbose
**Effort:** Small
**Risk:** Low

```typescript
const tempDir = join(tmpdir(), `blackbook-clone-${Date.now()}`);
try {
  await execAsync(`git clone ...`);
  // ... operations ...
  return pluginDir;
} catch (e) {
  rmSync(pluginDir, { recursive: true, force: true });
  throw e;  // or return null
} finally {
  // Always clean up temp dir
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
```

### Option B: Cleanup Helper
**Pros:** Reusable, consistent
**Cons:** Slight overhead
**Effort:** Small
**Risk:** Low

```typescript
async function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const tempDir = join(tmpdir(), `${prefix}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    return await fn(tempDir);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

// Usage
return await withTempDir('blackbook-clone', async (tempDir) => {
  await execAsync(`git clone ... "${tempDir}"`);
  // ...
});
```

### Option C: Startup Cleanup
**Pros:** Catches any leaked temps
**Cons:** Doesn't prevent leaks
**Effort:** Small
**Risk:** Low

```typescript
// On startup, clean old blackbook temp dirs
function cleanupOldTempDirs(): void {
  const tempBase = tmpdir();
  const maxAge = 24 * 60 * 60 * 1000;  // 24 hours

  for (const entry of readdirSync(tempBase)) {
    if (entry.startsWith('blackbook-')) {
      const fullPath = join(tempBase, entry);
      const stat = statSync(fullPath);
      if (Date.now() - stat.mtimeMs > maxAge) {
        rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }
}
```

## Recommended Action

Wrapped temp dir usage in a `withTempDir` helper with cleanup in `finally`.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `downloadPlugin()`, `createSymlink()`

### Components Affected
- Plugin download
- Symlink creation

## Acceptance Criteria

- [x] All temp directories cleaned up on error paths
- [x] Use try/finally or withTempDir helper consistently
- [ ] Unit test: verify temp cleanup on simulated failure
- [ ] Consider: startup cleanup of old temp dirs

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during pattern review |

## Resources

- [Node.js tmp package](https://www.npmjs.com/package/tmp) (handles cleanup automatically)
