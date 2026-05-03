/**
 * Pi MCP emission — works only if `pi-mcp-adapter` is in the playbook.
 *
 * Standard MCP location: <config_dir>/.mcp.json
 *
 * Format follows the pi-mcp-adapter convention which mirrors the standard MCP
 * server config used by other tools.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, ToolInstance, LoadedToolConfig } from "../../playbook/index.js";
import { atomicWriteFile, hashString, resolveConfigDir } from "../base.js";
import type { EmitResult } from "../types.js";
import { PI_DEFAULTS } from "./defaults.js";

/**
 * Decide whether MCP emission should run for this Pi instance.
 * True iff `pi-mcp-adapter` (the package name from PI_DEFAULTS.capabilities)
 * is listed in the tool's packages.yaml.
 */
export function piMcpEnabled(toolConfig: LoadedToolConfig): boolean {
  const adapterName = PI_DEFAULTS.capabilities.mcpViaPackage?.packageName;
  if (!adapterName) return false;
  const pkgs = toolConfig.packagesManifest?.packages ?? [];
  return pkgs.some(
    (p) => p.enabled && (p.name === adapterName || pkgIsAdapter(p, adapterName)),
  );
}

function pkgIsAdapter(
  p: { source: { type: string; package?: string } },
  adapterName: string,
): boolean {
  return p.source.type === "npm" && p.source.package === adapterName;
}

/**
 * Emit MCP servers in the standard location read by pi-mcp-adapter.
 *
 * Format (JSON):
 *   {
 *     "mcpServers": {
 *       "<name>": {
 *         "type": "local" | "remote",
 *         "command"?: [...],     // local
 *         "args"?: [...],        // local (split out for compatibility)
 *         "env"?: { NAME: "value" or "$env:NAME" },
 *         "url"?: "...",         // remote
 *         "bearerTokenEnv"?: "ENV_NAME"  // remote
 *       }
 *     }
 *   }
 *
 * Env-var indirection is preserved verbatim — pi-mcp-adapter resolves at runtime.
 */
export async function emitPiMcp(
  servers: McpServer[],
  instance: ToolInstance,
): Promise<EmitResult> {
  const configDir = resolveConfigDir(instance);
  if (!PI_DEFAULTS.paths.mcp) return { written: [], unchanged: [] };
  const target = join(configDir, PI_DEFAULTS.paths.mcp);

  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (!s.enabled) continue;
    if (s.type === "local") {
      mcpServers[s.name] = {
        type: "local",
        command: s.command,
        env: s.env ?? {},
        ...(s.timeout_ms ? { timeout_ms: s.timeout_ms } : {}),
      };
    } else {
      mcpServers[s.name] = {
        type: "remote",
        url: s.url,
        ...(s.bearerTokenEnv ? { bearerTokenEnv: s.bearerTokenEnv } : {}),
        ...(Object.keys(s.headers).length ? { headers: s.headers } : {}),
        ...(s.timeout_ms ? { timeout_ms: s.timeout_ms } : {}),
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
