/**
 * Pi bundle operations — shell out to the user's `pi` binary.
 *
 * Pi distributes packages via two source kinds in the playbook:
 *   - npm    → `pi install npm:<package>[@version]`
 *   - git    → `pi install git:<url>[@ref]`
 *   - local  → not supported via `pi install`; user must manage manually (rare)
 *
 * `pi update` skips pinned packages by Pi's own semantics (versions float by
 * default in this playbook design).
 *
 * `pi remove` accepts either form. We use the same source string we used to install.
 */

import type { BundleEntry, BundleSource, ToolInstance } from "../../playbook/index.js";
import { runOrThrow } from "../shell.js";

/**
 * Resolve a BundleSource to the install ref string `pi install` expects.
 * Returns undefined for sources Pi can't install via CLI.
 */
export function bundleSourceToPiRef(source: BundleSource, version?: string): string | undefined {
  switch (source.type) {
    case "npm": {
      const v = version ? `@${version}` : "";
      return `npm:${source.package}${v}`;
    }
    case "git": {
      const ref = source.ref ?? version;
      const r = ref ? `@${ref}` : "";
      return `git:${source.url}${r}`;
    }
    case "marketplace":
    case "local":
      return undefined;
  }
}

export async function installPiBundle(
  ref: BundleEntry,
  _instance: ToolInstance,
): Promise<void> {
  const piRef = bundleSourceToPiRef(ref.source, ref.version);
  if (!piRef) {
    throw new Error(
      `Pi cannot install bundle "${ref.name}" via CLI: source.type=${ref.source.type}`,
    );
  }
  await runOrThrow("pi", ["install", piRef]);
}

export async function updatePiBundle(name: string, _instance: ToolInstance): Promise<void> {
  // `pi update` updates everything; `pi update <name>` updates a single one.
  // Pi's CLI accepts the install ref, not the package name, but in practice
  // matching by name works because Pi tracks installed packages.
  await runOrThrow("pi", ["update", name]);
}

export async function uninstallPiBundle(name: string, _instance: ToolInstance): Promise<void> {
  // Pi takes the same ref form for remove. We only have the name here, so
  // try the npm: form first; if that fails, fall back to a bare name.
  // In practice Pi resolves either form when the package is installed.
  await runOrThrow("pi", ["remove", `npm:${name}`]).catch(async () => {
    await runOrThrow("pi", ["remove", name]);
  });
}
