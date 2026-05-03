/**
 * Lightweight performance profiler for Blackbook TUI.
 *
 * Enabled via BLACKBOOK_PERF=1 environment variable.
 * Measures render counts, store updates, filesystem calls, and key function invocations.
 */

import { existsSync as originalExistsSync } from "fs";

let enabled = process.env.BLACKBOOK_PERF === "1";

interface PerfCounters {
  appRenderCount: number;
  appRenderTimeTotal: number;
  storeUpdateCount: number;
  existsSyncCallCount: number;
  getPluginToolStatusCallCount: number;
  pluginToManagedItemCallCount: number;
  startupTimeMs: number | null;
}

const counters: PerfCounters = {
  appRenderCount: 0,
  appRenderTimeTotal: 0,
  storeUpdateCount: 0,
  existsSyncCallCount: 0,
  getPluginToolStatusCallCount: 0,
  pluginToManagedItemCallCount: 0,
  startupTimeMs: null,
};

const marks: Map<string, number> = new Map();

export function isPerfEnabled(): boolean {
  return enabled;
}

export function enablePerf(): void {
  enabled = true;
}

export function mark(name: string): void {
  if (!enabled) return;
  marks.set(name, performance.now());
}

export function measure(name: string): number | null {
  if (!enabled) return null;
  const start = marks.get(name);
  if (start === undefined) return null;
  const duration = performance.now() - start;
  marks.delete(name);
  return duration;
}

export function countAppRender(): void {
  if (!enabled) return;
  counters.appRenderCount++;
}

export function countStoreUpdate(): void {
  if (!enabled) return;
  counters.storeUpdateCount++;
}

export function countExistsSync(): void {
  if (!enabled) return;
  counters.existsSyncCallCount++;
}

export function countGetPluginToolStatus(): void {
  if (!enabled) return;
  counters.getPluginToolStatusCallCount++;
}

export function countPluginToManagedItem(): void {
  if (!enabled) return;
  counters.pluginToManagedItemCallCount++;
}

export function setStartupTime(ms: number): void {
  if (!enabled) return;
  counters.startupTimeMs = ms;
}

/** Monkey-patch fs.existsSync to count calls. Call once at startup. */
export function patchExistsSync(): void {
  if (!enabled) return;
  const fs = require("fs");
  const orig = fs.existsSync;
  fs.existsSync = function (...args: Parameters<typeof originalExistsSync>) {
    countExistsSync();
    return orig.apply(this, args);
  };
}

export function getReport(): PerfCounters & {
  avgRenderTimeMs: number;
  summary: string;
} {
  const avgRenderTimeMs =
    counters.appRenderCount > 0
      ? counters.appRenderTimeTotal / counters.appRenderCount
      : 0;

  const summary = [
    "═══ Blackbook Performance Report ═══",
    `Startup time:          ${counters.startupTimeMs?.toFixed(1) ?? "N/A"} ms`,
    `App re-renders:        ${counters.appRenderCount}`,
    `Store updates:         ${counters.storeUpdateCount}`,
    `existsSync calls:      ${counters.existsSyncCallCount}`,
    `getPluginToolStatus:   ${counters.getPluginToolStatusCallCount}`,
    `pluginToManagedItem:   ${counters.pluginToManagedItemCallCount}`,
    `Avg render time:       ${avgRenderTimeMs.toFixed(2)} ms`,
    "═══════════════════════════════════════",
  ].join("\n");

  return { ...counters, avgRenderTimeMs, summary };
}

export function logReport(): void {
  if (!enabled) return;
  const report = getReport();
  // Use setTimeout to log after current render cycle completes
  setTimeout(() => {
    console.error(report.summary);
  }, 100);
}
