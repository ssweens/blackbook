/**
 * Claude MCP emission — writes `<config_dir>/.mcp.json`.
 *
 * Claude's native MCP format (project-level `.mcp.json` and plugin-level inside
 * plugin manifests). This adapter targets the user-scoped `.mcp.json` at the
 * config_dir root. Plugin-contributed MCP servers are owned by their plugin
 * and not duplicated here.
 *
 * Format (JSON):
 *   {
 *     "mcpServers": {
 *       "<name>": {
 *         "type": "stdio" | "sse" | "http",     -- claude type names
 *         "command"?, "args"?, "env"?,           -- stdio (local)
 *         "url"?, "headers"?                     -- sse/http (remote)
 *       }
 *     }
 *   }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, ToolInstance } from "../../playbook/index.js";
import { atomicWriteFile, hashString, resolveConfigDir } from "../base.js";
import type { EmitResult } from "../types.js";
import { CLAUDE_DEFAULTS } from "./defaults.js";

export async function emitClaudeMcp(
  servers: McpServer[],
  instance: ToolInstance,
): Promise<EmitResult> {
  const configDir = resolveConfigDir(instance);
  if (!CLAUDE_DEFAULTS.paths.mcp) return { written: [], unchanged: [] };
  const target = join(configDir, CLAUDE_DEFAULTS.paths.mcp);

  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    if (s.type === "local") {
      // Claude stdio servers: command + args (split first vs rest)
      const [cmd, ...args] = s.command;
      mcpServers[s.name] = {
        type: "stdio",
        command: cmd,
        args,
        env: stringifyEnvForClaude(s.env ?? {}),
      };
    } else {
      // Remote: claude supports url + optional headers; bearer comes through headers.
      const headers: Record<string, string> = { ...s.headers };
      if (s.bearerTokenEnv) {
        // Claude does not natively support bearerTokenEnv; we leave a placeholder
        // header that the user (or a wrapper) resolves. Documented in inventory.
        headers["Authorization"] = `$env:${s.bearerTokenEnv}`;
      }
      mcpServers[s.name] = {
        type: "http",
        url: s.url,
        headers,
      };
    }
  }
  const newJson = JSON.stringify({ mcpServers }, null, 2) + "\n";
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

function stringifyEnvForClaude(env: Record<string, unknown>): Record<string, string> {
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
