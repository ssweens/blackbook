import type { DetectionResult } from "../../playbook/index.js";
import { findBinary, getVersion } from "../base.js";
import { CLAUDE_DEFAULTS } from "./defaults.js";

export async function detectClaude(): Promise<DetectionResult> {
  const binary = findBinary(CLAUDE_DEFAULTS.binary);
  const installed = !!binary;
  return {
    toolId: CLAUDE_DEFAULTS.toolId,
    installed,
    version: binary ? getVersion(binary) : undefined,
    binaryPath: binary,
    configDir: CLAUDE_DEFAULTS.defaultConfigDir,
  };
}
