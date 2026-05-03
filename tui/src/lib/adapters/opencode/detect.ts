import type { DetectionResult } from "../../playbook/index.js";
import { findBinary, getVersion } from "../base.js";
import { OPENCODE_DEFAULTS } from "./defaults.js";

export async function detectOpenCode(): Promise<DetectionResult> {
  const binary = findBinary(OPENCODE_DEFAULTS.binary);
  return {
    toolId: OPENCODE_DEFAULTS.toolId,
    installed: !!binary,
    version: binary ? getVersion(binary) : undefined,
    binaryPath: binary,
    configDir: OPENCODE_DEFAULTS.defaultConfigDir,
  };
}
