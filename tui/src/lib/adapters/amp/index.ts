import { registerAdapter } from "../registry.js";
import { ampAdapter } from "./adapter.js";

export * from "./adapter.js";
export * from "./defaults.js";

export function registerAmpAdapter(): void {
  registerAdapter(ampAdapter);
}
