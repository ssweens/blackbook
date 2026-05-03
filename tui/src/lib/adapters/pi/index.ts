import { registerAdapter } from "../registry.js";
import { piAdapter } from "./adapter.js";

export * from "./adapter.js";
export * from "./defaults.js";
export * from "./detect.js";
export * from "./bundle-ownership.js";
export * from "./mcp.js";

let registered = false;

/** Register the Pi adapter with the global registry. Idempotent. */
export function registerPiAdapter(): void {
  if (registered) return;
  registerAdapter(piAdapter);
  registered = true;
}
