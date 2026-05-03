/**
 * Pi bundle ownership — figure out which on-disk artifacts belong to which pi-package.
 *
 * Pi packages live in:
 *   - <config_dir>/git/<owner>/<repo>/   (git-installed)
 *   - global npm node_modules with `pi-package` keyword (npm-installed)
 *
 * Each pi-package has a `package.json` with a `pi` key declaring contributions:
 *   {
 *     "pi": {
 *       "skills": ["./skills"],
 *       "prompts": ["./prompts"],
 *       "extensions": ["./extensions"],
 *       "themes": ["./themes"]
 *     }
 *   }
 *
 * For each package, we read the contribution arrays and enumerate skills/prompts/agents,
 * recording (artifactType, name) → packageName.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BundleOwnershipMap } from "../scanner.js";
import { ownershipKey, readJsonSafe } from "../scanner.js";
import {
  discoverMarkdownDir,
  discoverSkillsDir,
} from "../base.js";

interface PiPackageManifest {
  name?: string;
  pi?: {
    skills?: string[];
    prompts?: string[];
    agents?: string[];
    commands?: string[];
    extensions?: string[];
    themes?: string[];
  };
  keywords?: string[];
}

/**
 * Build the bundle ownership map for a Pi config dir.
 *
 * @param configDir absolute path (already home-expanded)
 */
export function buildPiOwnership(configDir: string): BundleOwnershipMap {
  const ownership: BundleOwnershipMap = new Map();

  // git-installed pi-packages live under <config_dir>/git/
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

  // Note: globally-installed npm pi-packages contribute at runtime via Pi's
  // own resolution. We do NOT enumerate them here for ownership — they don't
  // place files in <config_dir>/skills/. They contribute via Pi's package
  // resolution, not via filesystem materialization.
  //
  // If a pi-package has been "materialized" into the config_dir (e.g., by
  // copying a skill in), it will appear as standalone — that's correct: the
  // user/script copied it, so it's owned by them.

  return ownership;
}

function recordPackageContributions(packageRoot: string, ownership: BundleOwnershipMap): void {
  const manifestPath = join(packageRoot, "package.json");
  const manifest = readJsonSafe<PiPackageManifest>(manifestPath);
  if (!manifest?.name) return;
  const piMeta = manifest.pi;
  if (!piMeta) {
    // Some packages declare via keywords only; nothing to enumerate filesystem-wise.
    return;
  }

  const packageName = manifest.name;

  // Skills contributions
  for (const rel of piMeta.skills ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverSkillsDir(dir)) {
      ownership.set(ownershipKey("skill", e.name), packageName);
    }
  }
  // Prompts (Pi's term for commands)
  for (const rel of piMeta.prompts ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("command", e.name), packageName);
    }
  }
  // Some packages may use the generic "commands" key
  for (const rel of piMeta.commands ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("command", e.name), packageName);
    }
  }
  // Agents
  for (const rel of piMeta.agents ?? []) {
    const dir = resolve(packageRoot, rel);
    for (const e of discoverMarkdownDir(dir)) {
      ownership.set(ownershipKey("agent", e.name), packageName);
    }
  }
}
