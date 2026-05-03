import { registerAdapter } from "../registry.js";
import { opencodeAdapter } from "./adapter.js";

export * from "./adapter.js";
export * from "./defaults.js";
export * from "./detect.js";
export * from "./bundle-ownership.js";
export * from "./mcp.js";

export function registerOpenCodeAdapter(): void {
  registerAdapter(opencodeAdapter);
}
