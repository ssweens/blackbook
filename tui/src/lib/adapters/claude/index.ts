import { registerAdapter } from "../registry.js";
import { claudeAdapter } from "./adapter.js";

export * from "./adapter.js";
export * from "./defaults.js";
export * from "./detect.js";
export * from "./bundle-ownership.js";
export * from "./mcp.js";

let registered = false;
export function registerClaudeAdapter(): void {
  if (registered) return;
  registerAdapter(claudeAdapter);
  registered = true;
}
