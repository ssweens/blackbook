/**
 * OpenCode bundle ownership.
 *
 * OpenCode plugins are JS/TS modules with runtime hooks. They don't typically
 * "own" filesystem artifacts like skills/commands/agents — those live in
 * standard config dirs. So ownership map for OpenCode is usually empty;
 * everything on disk is `standalone`.
 *
 * The exception: an npm-installed plugin package may colocate skills/agents/
 * commands as resource bundles. We can detect those by reading
 * <config_dir>/package.json + walking <config_dir>/node_modules/<plugin>/ for
 * a `pi`-style or `opencode` field — but this is rare in practice and we don't
 * implement it for v1.
 */

import type { BundleOwnershipMap } from "../scanner.js";

export function buildOpenCodeOwnership(_configDir: string): BundleOwnershipMap {
  return new Map();
}
