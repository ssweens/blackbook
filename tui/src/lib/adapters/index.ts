/**
 * Adapters — public entry points used by the engine, init, and UI.
 *
 * Individual tool adapters live in subdirectories and self-register via
 * `registerAdapter()`.
 */

export * from "./types.js";
export * from "./base.js";
export {
  applyCommonSpine,
} from "./applier.js";
export {
  buildCommonSpineDiff,
} from "./diff-builder.js";
export {
  scanCommonSpine,
  addAgentsMdVariants,
  ownershipKey,
  readJsonSafe,
  type BundleOwnershipMap,
} from "./scanner.js";
export {
  registerAdapter,
  getAdapter,
  requireAdapter,
  listAdapters,
  listRegisteredToolIds,
  __resetRegistryForTests,
} from "./registry.js";
