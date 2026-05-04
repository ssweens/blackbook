import type { DetectionResult } from "../../playbook/index.js";
import { findBinary, getVersion } from "../base.js";
import { PI_DEFAULTS } from "./defaults.js";

export async function detectPi(): Promise<DetectionResult> {
  const binary = await findBinary(PI_DEFAULTS.binary);
  const installed = !!binary;
  return {
    toolId: PI_DEFAULTS.toolId,
    installed,
    version: binary ? await getVersion(binary) : undefined,
    binaryPath: binary,
    configDir: PI_DEFAULTS.defaultConfigDir,
  };
}
