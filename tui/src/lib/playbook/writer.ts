/**
 * Playbook writer — serializes parts of a playbook to disk.
 *
 * Used by:
 *   - blackbook init (cold-start reverse scaffolding)
 *   - migration (one-time tooling)
 *   - tests
 *
 * Not used by `apply` — that pushes from playbook to tool config dirs, not the other way.
 *
 * Writes are atomic (write-to-tmp + rename) to avoid corruption on interrupt.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  PackagesManifestSchema,
  PlaybookSchema,
  PluginsManifestSchema,
  ToolConfigSchema,
  type McpServer,
  type PackagesManifest,
  type PlaybookManifest,
  type PluginsManifest,
  type ToolConfig,
  type ToolId,
} from "./schema.js";

export class PlaybookWriteError extends Error {
  constructor(
    message: string,
    public readonly target: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlaybookWriteError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level
// ─────────────────────────────────────────────────────────────────────────────

export function writePlaybookManifest(rootPath: string, manifest: PlaybookManifest): void {
  const validated = PlaybookSchema.parse(manifest);
  ensureDir(rootPath);
  atomicWriteYaml(join(rootPath, "playbook.yaml"), validated);
}

export function writeToolConfig(rootPath: string, toolId: ToolId, config: ToolConfig): void {
  if (config.tool !== toolId) {
    throw new PlaybookWriteError(
      `tool field "${config.tool}" does not match destination "${toolId}"`,
      `tools/${toolId}/tool.yaml`,
    );
  }
  const validated = ToolConfigSchema.parse(config);
  const toolDir = join(rootPath, "tools", toolId);
  ensureDir(toolDir);
  atomicWriteYaml(join(toolDir, "tool.yaml"), validated);
}

export function writePluginsManifest(
  rootPath: string,
  toolId: ToolId,
  manifest: PluginsManifest,
  filename = "plugins.yaml",
): void {
  const validated = PluginsManifestSchema.parse(manifest);
  const toolDir = join(rootPath, "tools", toolId);
  ensureDir(toolDir);
  atomicWriteYaml(join(toolDir, filename), validated);
}

export function writePackagesManifest(
  rootPath: string,
  toolId: ToolId,
  manifest: PackagesManifest,
  filename = "packages.yaml",
): void {
  const validated = PackagesManifestSchema.parse(manifest);
  const toolDir = join(rootPath, "tools", toolId);
  ensureDir(toolDir);
  atomicWriteYaml(join(toolDir, filename), validated);
}

export function writeMcpServer(rootPath: string, server: McpServer): void {
  const dir = join(rootPath, "shared", "mcp");
  ensureDir(dir);
  atomicWriteYaml(join(dir, `${server.name}.yaml`), server);
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton scaffolding (for `blackbook init`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the directory skeleton for a fresh playbook. Idempotent.
 * Does not write any YAML files; caller does that via writePlaybookManifest et al.
 */
export function scaffoldSkeleton(rootPath: string, toolsEnabled: ToolId[]): void {
  ensureDir(resolve(rootPath));
  ensureDir(join(rootPath, "shared"));
  ensureDir(join(rootPath, "shared", "skills"));
  ensureDir(join(rootPath, "shared", "commands"));
  ensureDir(join(rootPath, "shared", "agents"));
  ensureDir(join(rootPath, "shared", "mcp"));
  ensureDir(join(rootPath, "tools"));
  for (const toolId of toolsEnabled) {
    ensureDir(join(rootPath, "tools", toolId));
  }
  ensureDir(join(rootPath, "machines"));   // reserved for v2
  writeDefaultGitignore(rootPath);
}

const DEFAULT_GITIGNORE = `# Blackbook playbook — secrets safety
# These patterns prevent accidental secret commits.

# Local-only env files
.env
.env.local
.env.*.local

# Editor / OS noise
.DS_Store
*.swp
*.swo

# Local secret manager exports (if user dumps something here)
secrets/
secrets.yaml
*.secret.yaml

# Optional machine-local override (v2; reserved)
# machines/*.local.yaml
`;

function writeDefaultGitignore(rootPath: string): void {
  const path = join(rootPath, ".gitignore");
  if (existsSync(path)) {
    // Don't clobber an existing one; user may have customized it.
    return;
  }
  writeFileSync(path, DEFAULT_GITIGNORE);
}

// ─────────────────────────────────────────────────────────────────────────────
// File-copy helpers (for moving artifacts into the playbook)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copy or update an artifact file inside the playbook.
 * Caller is responsible for choosing the right destination path.
 * Atomic; preserves no metadata beyond contents.
 */
export function placeArtifactFile(destPath: string, contents: string | Buffer): void {
  ensureDir(dirname(destPath));
  atomicWriteRaw(destPath, contents);
}

/**
 * Copy a file from one location to another inside the playbook (or into it).
 */
export function copyArtifactFile(srcPath: string, destPath: string): void {
  const data = readFileSync(srcPath);
  placeArtifactFile(destPath, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function atomicWriteYaml(targetPath: string, value: unknown): void {
  const yaml = stringifyYaml(value, {
    // Stable, readable output
    lineWidth: 0,
    minContentWidth: 0,
  });
  atomicWriteRaw(targetPath, yaml);
}

function atomicWriteRaw(targetPath: string, contents: string | Buffer): void {
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, contents);
    renameSync(tmp, targetPath);
  } catch (err) {
    throw new PlaybookWriteError(`Failed to write ${targetPath}`, targetPath, err);
  }
}
