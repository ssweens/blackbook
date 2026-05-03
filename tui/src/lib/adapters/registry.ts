/**
 * Adapter registry — lookup of toolId → adapter implementation.
 *
 * Adapters self-register here; the engine and CLI consume the registry.
 */

import type { ToolId } from "../playbook/index.js";
import type { ToolAdapter } from "./types.js";

const REGISTRY = new Map<ToolId, ToolAdapter>();

/**
 * Register an adapter. Idempotent for same-instance re-registration; throws if
 * a *different* adapter is already registered for the same toolId (which would
 * indicate a programmer error).
 */
export function registerAdapter(adapter: ToolAdapter): void {
  const id = adapter.defaults.toolId;
  const existing = REGISTRY.get(id);
  if (existing && existing !== adapter) {
    throw new Error(`A different adapter is already registered for toolId="${id}"`);
  }
  REGISTRY.set(id, adapter);
}

export function getAdapter(toolId: ToolId): ToolAdapter | undefined {
  return REGISTRY.get(toolId);
}

export function requireAdapter(toolId: ToolId): ToolAdapter {
  const a = REGISTRY.get(toolId);
  if (!a) throw new Error(`No adapter registered for toolId="${toolId}"`);
  return a;
}

export function listAdapters(): ToolAdapter[] {
  return Array.from(REGISTRY.values());
}

export function listRegisteredToolIds(): ToolId[] {
  return Array.from(REGISTRY.keys());
}

/** Test helper — clears the registry. */
export function __resetRegistryForTests(): void {
  REGISTRY.clear();
}
