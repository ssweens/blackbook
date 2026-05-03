/**
 * Shared utilities used by every adapter.
 *
 * Keep these pure where possible; effects (file I/O, env access) are explicit.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { McpServer, ToolInstance } from "../playbook/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Expand `~` to home dir; pass through absolute and relative paths unchanged. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** Resolve a tool instance's config dir to an absolute path with `~` expanded. */
export function resolveConfigDir(instance: ToolInstance): string {
  return resolve(expandHome(instance.config_dir));
}

// ─────────────────────────────────────────────────────────────────────────────
// File ops (atomic where it matters)
// ─────────────────────────────────────────────────────────────────────────────

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/** Atomic file write: tmp + rename. */
export function atomicWriteFile(target: string, contents: string | Buffer): void {
  ensureDir(dirname(target));
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, contents);
  // Use rename to make the swap atomic on the same filesystem.
  // node's fs.renameSync is the right primitive here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  fs.renameSync(tmp, target);
}

/** Copy file with atomic write semantics. */
export function atomicCopyFile(src: string, dest: string): void {
  const data = readFileSync(src);
  atomicWriteFile(dest, data);
}

/** Recursively copy a directory atomically (write to staging, then rename). */
export function atomicCopyDir(srcDir: string, destDir: string): void {
  ensureDir(dirname(destDir));
  const staging = `${destDir}.staging.${process.pid}.${Date.now()}`;
  copyDirSync(srcDir, staging);
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  fs.renameSync(staging, destDir);
}

function copyDirSync(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
    // symlinks/devices intentionally skipped
  }
}

/** Remove a path (file or dir). Idempotent. */
export function removePath(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Hash a directory's contents recursively, sorted by relative path for determinism. */
export function hashDir(dir: string): string {
  const hasher = createHash("sha256");
  for (const file of walkFilesSorted(dir)) {
    hasher.update(file.relPath);
    hasher.update("\0");
    hasher.update(readFileSync(file.absPath));
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

interface FileEntry {
  relPath: string;
  absPath: string;
}

function walkFilesSorted(root: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) out.push({ relPath: r, absPath: abs });
    }
  };
  walk(root, "");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-var indirection (the secrets pattern from playbook-schema.md)
// ─────────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /^\$env:([A-Z_][A-Z0-9_]*)$/;

/**
 * Extract the env var name from a value if it's an indirection ref, otherwise undefined.
 * Accepts: "$env:NAME" or { from_env: "NAME" }.
 */
export function extractEnvRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    const m = value.match(PLACEHOLDER_RE);
    return m?.[1];
  }
  if (typeof value === "object" && value !== null && "from_env" in value) {
    const v = (value as { from_env: unknown }).from_env;
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/**
 * Resolve a value: if it's an env-var reference, read the actual env var;
 * otherwise return the literal value as-is.
 *
 * If the env var is referenced but unset, returns undefined (caller decides
 * whether that's an error).
 */
export function resolveEnvValue(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const ref = extractEnvRef(value);
  if (ref) return env[ref];
  if (typeof value === "string") return value;
  return undefined;
}

/**
 * Collect every env var name an MCP server references.
 */
export function collectMcpEnvRefs(server: McpServer): string[] {
  const refs: string[] = [];
  if (server.type === "remote" && server.bearerTokenEnv) {
    refs.push(server.bearerTokenEnv);
  }
  if (server.type === "local") {
    for (const v of Object.values(server.env ?? {})) {
      const ref = extractEnvRef(v);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a binary on PATH. Returns the absolute path or undefined.
 * Uses `which` / `where` synchronously.
 */
export function findBinary(name: string): string | undefined {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!out) return undefined;
    return out.split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get a binary's `--version` output. Returns undefined if the binary fails.
 */
export function getVersion(binary: string, flag = "--version"): string | undefined {
  try {
    const out = execSync(`${binary} ${flag}`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).toString().trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk discovery
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredEntry {
  /** Logical name (basename without extension for files; dir name for dirs). */
  name: string;
  /** Absolute disk path. */
  path: string;
  /** True if this is a directory (skill folder), false if it's a file. */
  isDirectory: boolean;
}

/**
 * Discover skill folders (each containing SKILL.md) under a directory.
 */
export function discoverSkillsDir(dir: string): DiscoveredEntry[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: DiscoveredEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Skip dot-prefixed (e.g. Codex's .system)
    if (entry.name.startsWith(".")) continue;
    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    out.push({ name: entry.name, path: join(dir, entry.name), isDirectory: true });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Discover .md files in a directory (commands or agents).
 */
export function discoverMarkdownDir(dir: string): DiscoveredEntry[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: DiscoveredEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (extname(entry.name) !== ".md") continue;
    out.push({
      name: basename(entry.name, ".md"),
      path: join(dir, entry.name),
      isDirectory: false,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Required-env validation (used before apply)
// ─────────────────────────────────────────────────────────────────────────────

export interface RequiredEnvCheckResult {
  ok: boolean;
  missing: string[];
}

export function checkRequiredEnv(
  names: string[],
  env: NodeJS.ProcessEnv = process.env,
): RequiredEnvCheckResult {
  const missing = names.filter((n) => !env[n]);
  return { ok: missing.length === 0, missing };
}
