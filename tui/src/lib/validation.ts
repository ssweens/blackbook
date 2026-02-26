import { resolve, relative } from "path";
import type { Plugin } from "./types.js";

const SAFE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const SAFE_GIT_REF_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${message}`);
}

export function validatePluginName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name) || name.includes("..") || name === ".") {
    throw new Error(`Invalid plugin name: ${name}`);
  }
}

export function validateMarketplaceName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name) || name.includes("..") || name === ".") {
    throw new Error(`Invalid marketplace name: ${name}`);
  }
}

export function validateItemName(kind: string, name: string): void {
  if (!SAFE_NAME_PATTERN.test(name) || name.includes("..") || name === ".") {
    throw new Error(`Invalid ${kind} name: ${name}`);
  }
}

export function validateGitRef(ref: string): void {
  if (!SAFE_GIT_REF_PATTERN.test(ref) || ref.includes("..")) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}

export function validateRepoUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid repository URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Unsupported repository URL protocol: ${parsed.protocol}`);
  }
}

export function validateRelativeSubPath(path: string): void {
  if (!path) return;
  const normalized = path.replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.startsWith("~")) {
    throw new Error(`Invalid subpath: ${path}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part.includes("\0"))) {
    throw new Error(`Invalid subpath: ${path}`);
  }
}

export function safePath(base: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (!segment || segment === "." || segment.includes("..") || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      throw new Error(`Invalid path segment: ${segment}`);
    }
  }

  const resolved = resolve(base, ...segments);
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Path traversal detected: ${resolved} escapes ${base}`);
  }

  return resolved;
}

export function validatePluginMetadata(plugin: Plugin): void {
  validateMarketplaceName(plugin.marketplace);
  validatePluginName(plugin.name);
  for (const skill of plugin.skills) {
    validateItemName("skill", skill);
  }
  for (const cmd of plugin.commands) {
    validateItemName("command", cmd);
  }
  for (const agent of plugin.agents) {
    validateItemName("agent", agent);
  }
}
