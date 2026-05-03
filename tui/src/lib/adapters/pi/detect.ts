import type { DetectionResult } from "../../playbook/index.js";
import { findBinary, getVersion } from "../base.js";
import { PI_DEFAULTS } from "./defaults.js";

export async function detectPi(): Promise<DetectionResult> {
  const binary = findBinary(PI_DEFAULTS.binary);
  const installed = !!binary;
  return {
    toolId: PI_DEFAULTS.toolId,
    installed,
    version: binary ? getVersion(binary) : undefined,
    binaryPath: binary,
    configDir: PI_DEFAULTS.defaultConfigDir,
  };
}
