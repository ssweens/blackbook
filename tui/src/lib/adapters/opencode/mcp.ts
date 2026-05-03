/**
 * OpenCode MCP emission — merges into <config_dir>/opencode.json `mcp` key.
 *
 * OpenCode supports `local` and `remote` types natively. `environment` for local
 * env vars; `headers` for remote (bearer indirection: literal-only or env-ref placeholder).
 *
 * Like Codex with config.toml, opencode.json may carry unrelated settings.
 * Adapter reads, replaces only the `mcp` key, writes back atomically.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, ToolInstance } from "../../playbook/index.js";
import { atomicWriteFile, hashString, resolveConfigDir } from "../base.js";
import type { EmitResult } from "../types.js";
import { OPENCODE_DEFAULTS } from "./defaults.js";

export async function emitOpenCodeMcp(
  servers: McpServer[],
  instance: ToolInstance,
): Promise<EmitResult> {
  const configDir = resolveConfigDir(instance);
  if (!OPENCODE_DEFAULTS.paths.mcp) return { written: [], unchanged: [] };
  const target = join(configDir, OPENCODE_DEFAULTS.paths.mcp);

  let parsed: Record<string, unknown> = { $schema: "https://opencode.ai/config.json" };
  if (existsSync(target)) {
    try {
      parsed = JSON.parse(readFileSync(target, "utf-8"));
    } catch {
      throw new Error(
        `OpenCode opencode.json at ${target} is not valid JSON; refusing to overwrite.`,
      );
    }
  }

  const mcp: Record<string, unknown> = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    if (s.type === "local") {
      mcp[s.name] = {
        type: "local",
        command: s.command,
        ...(Object.keys(s.env ?? {}).length
          ? { environment: stringifyEnvForOpenCode(s.env ?? {}) }
          : {}),
        enabled: true,
        ...(s.timeout_ms ? { timeout: s.timeout_ms } : {}),
      };
    } else {
      const headers: Record<string, string> = { ...s.headers };
      if (s.bearerTokenEnv) {
        headers["Authorization"] = `$env:${s.bearerTokenEnv}`;
      }
      mcp[s.name] = {
        type: "remote",
        url: s.url,
        ...(Object.keys(headers).length ? { headers } : {}),
        enabled: true,
        ...(s.timeout_ms ? { timeout: s.timeout_ms } : {}),
      };
    }
  }
  parsed.mcp = mcp;

  const newJson = JSON.stringify(parsed, null, 2) + "\n";
  const newHash = hashString(newJson);

  if (existsSync(target)) {
    const currentHash = hashString(readFileSync(target, "utf-8"));
    if (currentHash === newHash) {
      return { written: [], unchanged: [target] };
    }
  }
  atomicWriteFile(target, newJson);
  return { written: [target], unchanged: [] };
}

function stringifyEnvForOpenCode(env: Record<string, unknown>): Record<string, string> {
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
