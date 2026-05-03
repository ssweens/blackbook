/**
 * Convenience entry — register all bundled adapters.
 *
 * Engines/CLIs that want every adapter active call registerAllAdapters() once
 * at startup. Tests and embedders can register a subset instead.
 */

import { registerAmpAdapter } from "./amp/index.js";
import { registerClaudeAdapter } from "./claude/index.js";
import { registerCodexAdapter } from "./codex/index.js";
import { registerOpenCodeAdapter } from "./opencode/index.js";
import { registerPiAdapter } from "./pi/index.js";

export function registerAllAdapters(): void {
  registerClaudeAdapter();
  registerCodexAdapter();
  registerOpenCodeAdapter();
  registerAmpAdapter();
  registerPiAdapter();
}

export {
  registerClaudeAdapter,
  registerCodexAdapter,
  registerOpenCodeAdapter,
  registerAmpAdapter,
  registerPiAdapter,
};
