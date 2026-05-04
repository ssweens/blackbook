import type { DetectionResult } from "../../playbook/index.js";
import { findBinary, getVersion } from "../base.js";
import { CODEX_DEFAULTS } from "./defaults.js";

export async function detectCodex(): Promise<DetectionResult> {
  const binary = await findBinary(CODEX_DEFAULTS.binary);
  return {
    toolId: CODEX_DEFAULTS.toolId,
    installed: !!binary,
    version: binary ? await getVersion(binary) : undefined,
    binaryPath: binary,
    configDir: CODEX_DEFAULTS.defaultConfigDir,
  };
}
