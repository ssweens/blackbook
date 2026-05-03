/**
 * Claude bundle operations — shell out to `claude plugin`.
 *
 * Claude supports: install, uninstall, enable, disable, update
 * The CLAUDE_CONFIG_DIR env var controls which config dir is targeted,
 * allowing multi-instance operations without config file mutation.
 */

import type { BundleEntry, ToolInstance } from "../../playbook/index.js";
import { resolveConfigDir } from "../base.js";
import { runOrThrow } from "../shell.js";

function claudeEnv(instance: ToolInstance): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: resolveConfigDir(instance),
  };
}

export async function installClaudeBundle(
  ref: BundleEntry,
  instance: ToolInstance,
): Promise<void> {
  // Claude plugin install takes the plugin name from the marketplace.
  // If the source is a marketplace reference, use the plugin name.
  // If local path, Claude can't install it via CLI — fall through to error.
  if (ref.source.type === "local") {
    throw new Error(
      `Claude CLI cannot install local-path plugin "${ref.name}"; place it manually in <config_dir>/plugins/`,
    );
  }
  await runOrThrow("claude", ["plugin", "install", ref.name], {
    env: claudeEnv(instance),
  });
}

export async function updateClaudeBundle(
  name: string,
  instance: ToolInstance,
): Promise<void> {
  await runOrThrow("claude", ["plugin", "update", name], {
    env: claudeEnv(instance),
  });
}

export async function uninstallClaudeBundle(
  name: string,
  instance: ToolInstance,
): Promise<void> {
  await runOrThrow("claude", ["plugin", "uninstall", name], {
    env: claudeEnv(instance),
  });
}
