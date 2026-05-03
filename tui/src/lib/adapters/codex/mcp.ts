/**
 * Codex MCP emission — merges into <config_dir>/config.toml at table [mcp_servers.<name>].
 *
 * Critically, config.toml may contain unrelated user settings. Adapter:
 *   1. Reads existing config.toml (if present)
 *   2. Replaces only the `mcp_servers` table
 *   3. Writes back atomically
 *
 * Codex supports `bearerTokenEnv` natively (per its config schema), so we
 * emit env-var indirection cleanly. Local server env goes into [mcp_servers.<n>.env].
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { McpServer, ToolInstance } from "../../playbook/index.js";
import { atomicWriteFile, hashString, resolveConfigDir } from "../base.js";
import type { EmitResult } from "../types.js";
import { CODEX_DEFAULTS } from "./defaults.js";

export async function emitCodexMcp(
  servers: McpServer[],
  instance: ToolInstance,
): Promise<EmitResult> {
  const configDir = resolveConfigDir(instance);
  if (!CODEX_DEFAULTS.paths.mcp) return { written: [], unchanged: [] };
  const target = join(configDir, CODEX_DEFAULTS.paths.mcp);

  // Load existing config (preserve everything outside mcp_servers)
  let parsed: Record<string, unknown> = {};
  if (existsSync(target)) {
    try {
      parsed = parseToml(readFileSync(target, "utf-8")) as Record<string, unknown>;
    } catch {
      // If the existing TOML is malformed, refuse to overwrite — emit error path.
      throw new Error(
        `Codex config.toml at ${target} is not valid TOML; refusing to overwrite. Fix or remove first.`,
      );
    }
  }

  // Build mcp_servers table
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    if (s.type === "local") {
      const [cmd, ...args] = s.command;
      mcpServers[s.name] = {
        command: cmd,
        ...(args.length ? { args } : {}),
        ...(Object.keys(s.env ?? {}).length
          ? { env: stringifyEnvForCodex(s.env ?? {}) }
          : {}),
        ...(s.timeout_ms ? { startup_timeout_ms: s.timeout_ms } : {}),
      };
    } else {
      mcpServers[s.name] = {
        url: s.url,
        ...(s.bearerTokenEnv ? { bearerTokenEnv: s.bearerTokenEnv } : {}),
        ...(Object.keys(s.headers).length ? { headers: s.headers } : {}),
        ...(s.timeout_ms ? { startup_timeout_ms: s.timeout_ms } : {}),
      };
    }
  }
  parsed.mcp_servers = mcpServers;

  const newToml = stringifyToml(parsed) + "\n";
  const newHash = hashString(newToml);

  if (existsSync(target)) {
    const currentHash = hashString(readFileSync(target, "utf-8"));
    if (currentHash === newHash) {
      return { written: [], unchanged: [target] };
    }
  }
  atomicWriteFile(target, newToml);
  return { written: [target], unchanged: [] };
}

function stringifyEnvForCodex(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") {
      out[k] = v;
    } else if (typeof v === "object" && v !== null && "from_env" in v) {
      out[k] = `$env:${(v as { from_env: string }).from_env}`;
    }
  }
  return out;
}
