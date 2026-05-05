/**
 * Pi bundle ownership.
 *
 * Pi packages can come from THREE places:
 *   1. ~/.pi/agent/git/<owner>/<repo>/ — git-installed (legacy method)
 *   2. ~/.pi/agent/settings.json `packages[]` — declared, may be:
 *      - "npm:<pkg>" → installed via npm (global node_modules)
 *      - "/abs/path" or "rel/path" → local directory
 *      - { source: "npm:<pkg>", ... } → object form
 *   3. globally-installed npm packages with `pi-package` keyword
 *
 * Each package's filesystem location has a package.json with a `pi` key
 * declaring contributions: skills, prompts, extensions, themes, agents.
 *
 * We walk each known package and map its contributed artifact names to the
 * package name in the ownership map. The diff/inventory layer then knows
 * which on-disk skills/prompts/extensions came from which package.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { discoverMarkdownDir, discoverSkillsDir } from "../base.js";
import type { BundleOwnershipMap } from "../scanner.js";
import { ownershipKey, readJsonSafe } from "../scanner.js";

interface PiPackageManifest {
  name?: string;
  pi?: {
    skills?: string[];
    prompts?: string[];
    commands?: string[];
    agents?: string[];
    extensions?: string[];
    themes?: string[];
  };
  keywords?: string[];
}

interface PiSettings {
  packages?: Array<string | { source?: string }>;
}

export function buildPiOwnership(configDir: string): BundleOwnershipMap {
  const ownership: BundleOwnershipMap = new Map();

  // ── 1. git-installed packages (legacy path) ─────────────────────────────
  const gitRoot = join(configDir, "git");
  if (existsSync(gitRoot) && statSync(gitRoot).isDirectory()) {
    for (const ownerDir of readdirSync(gitRoot, { withFileTypes: true })) {
      if (!ownerDir.isDirectory()) continue;
      const ownerPath = join(gitRoot, ownerDir.name);
      for (const repoDir of readdirSync(ownerPath, { withFileTypes: true })) {
        if (!repoDir.isDirectory()) continue;
        recordPackageContributions(join(ownerPath, repoDir.name), ownership);
      }
    }
  }

  // ── 2. Packages declared in settings.json (npm + local paths) ──────────
  const settings = readJsonSafe<PiSettings>(join(configDir, "settings.json"));
  if (settings?.packages) {
    for (const entry of settings.packages) {
      const ref = typeof entry === "string" ? entry : entry?.source;
      if (!ref) continue;
      const path = resolvePiPackagePath(ref);
      if (path) recordPackageContributions(path, ownership);
    }
  }

  return ownership;
}

/**
 * Resolve a package reference from settings.json `packages[]` to a filesystem path.
 * Returns null if the package can't be located.
 */
function resolvePiPackagePath(ref: string): string | null {
  if (ref.startsWith("npm:")) {
    return locateNpmPackage(ref.slice("npm:".length).split("@")[0]);
  }
  if (ref.startsWith("git:") || ref.startsWith("ssh://") || ref.startsWith("https://")) {
    // Git-installed; already handled in step 1 above
    return null;
  }
  // Plain path — absolute or relative
  const expanded = ref.startsWith("~/")
    ? join(homedir(), ref.slice(2))
    : ref;
  const abs = isAbsolute(expanded) ? expanded : resolve(homedir(), expanded);
  return existsSync(abs) ? abs : null;
}

/**
 * Try to find an npm-installed package's directory by walking common global
 * install locations.
 */
function locateNpmPackage(packageName: string): string | null {
  const candidates = [
    // Bun global
    join(homedir(), ".bun", "install", "global", "node_modules", ...packageName.split("/")),
    // pnpm global
    join(homedir(), ".local", "share", "pnpm", "global", "5", "node_modules", ...packageName.split("/")),
    // npm global - common locations
    "/usr/local/lib/node_modules/" + packageName,
    "/opt/homebrew/lib/node_modules/" + packageName,
    join(homedir(), ".npm-global", "lib", "node_modules", ...packageName.split("/")),
    // nvm
    ...findNvmGlobalPaths(packageName),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

function findNvmGlobalPaths(packageName: string): string[] {
  const nvmDir = join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(nvmDir)) return [];
  const paths: string[] = [];
  try {
    for (const version of readdirSync(nvmDir)) {
      paths.push(join(nvmDir, version, "lib", "node_modules", ...packageName.split("/")));
    }
  } catch { /* ignore */ }
  return paths;
}

function recordPackageContributions(packageRoot: string, ownership: BundleOwnershipMap): void {
  const manifestPath = join(packageRoot, "package.json");
  const manifest = readJsonSafe<PiPackageManifest>(manifestPath);
  if (!manifest?.name) return;

  const piMeta = manifest.pi;
  if (!piMeta) {
    // Some packages declare via keywords only — nothing to enumerate filesystem-wise.
    return;
  }

  const packageName = manifest.name;

  for (const rel of piMeta.skills ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverSkillsDir(dir)) {
      ownership.set(ownershipKey("skill", e.name), packageName);
    }
  }
  for (const rel of piMeta.prompts ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("command", e.name), packageName);
    }
  }
  for (const rel of piMeta.commands ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("command", e.name), packageName);
    }
  }
  for (const rel of piMeta.agents ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("agent", e.name), packageName);
    }
  }
}

// Suppress unused
void readFileSync;

/**
 * List the names of all currently-installed Pi packages by reading
 * settings.json + git/ — regardless of whether they contribute artifacts.
 */
export function listInstalledPiPackages(configDir: string): string[] {
  const names = new Set<string>();

  // git-installed: each <owner>/<repo>/package.json gives a name
  const gitRoot = join(configDir, "git");
  if (existsSync(gitRoot) && statSync(gitRoot).isDirectory()) {
    for (const ownerDir of readdirSync(gitRoot, { withFileTypes: true })) {
      if (!ownerDir.isDirectory()) continue;
      const ownerPath = join(gitRoot, ownerDir.name);
      for (const repoDir of readdirSync(ownerPath, { withFileTypes: true })) {
        if (!repoDir.isDirectory()) continue;
        const m = readJsonSafe<PiPackageManifest>(
          join(ownerPath, repoDir.name, "package.json"),
        );
        if (m?.name) names.add(m.name);
      }
    }
  }

  // settings.json packages
  const settings = readJsonSafe<PiSettings>(join(configDir, "settings.json"));
  if (settings?.packages) {
    for (const entry of settings.packages) {
      const ref = typeof entry === "string" ? entry : entry?.source;
      if (!ref) continue;
      const path = resolvePiPackagePath(ref);
      if (!path) {
        // Couldn't locate — fall back to the ref name (best-effort display)
        names.add(ref.replace(/^npm:/, ""));
        continue;
      }
      const m = readJsonSafe<PiPackageManifest>(join(path, "package.json"));
      if (m?.name) names.add(m.name);
    }
  }

  return Array.from(names).sort();
}
