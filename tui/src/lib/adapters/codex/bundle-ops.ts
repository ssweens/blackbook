/**
 * Codex bundle operations.
 *
 * Codex plugin management goes via its app-server JSON-RPC protocol
 * (PluginInstallParams, plugin_install.rs), NOT a simple CLI command.
 * The server must be running and authenticated, making this unsuitable
 * for a background CLI operation.
 *
 * v1 status: NOT IMPLEMENTED — defer to v2.
 *
 * Consequence: when a Codex plugins.yaml contains bundles, the engine
 * will log a per-instance error via the "adapter has no installBundle"
 * path (since we don't set installBundle on the adapter), which surfaces
 * as a graceful skip rather than a crash.
 *
 * When Codex adds a CLI install command or we implement JSON-RPC session
 * management, wire it here.
 */

export const CODEX_BUNDLES_DEFERRED = true;
export const CODEX_BUNDLES_REASON =
  "Codex plugin management requires the Codex app-server JSON-RPC protocol; " +
  "not available as a standalone CLI command in v1. Defer to v2.";
