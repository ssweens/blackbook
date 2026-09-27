#!/usr/bin/env node
/**
 * One-shot migration: reinstall every installed plugin from source through the
 * current install path, so any dest still stranded in a legacy per-tool dir
 * (.config/opencode, .claude, .pi/agent/prompts, …) moves to the shared
 * ~/.agents store and the manifest is refreshed. Idempotent (installPlugin
 * backs up + overwrites). Skips plugins with no resolvable marketplace source.
 */
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const lib = (p) => join(ROOT, "src", "lib", p);

const { getAllInstalledPlugins, installPlugin } = await import(lib("install.ts"));
const { parseMarketplaces } = await import(lib("config.ts"));
const { invalidatePluginToolStatusCache } = await import(lib("plugin-status.ts"));

const { plugins } = getAllInstalledPlugins();
const marketplaces = parseMarketplaces();

const fileComponentPlugins = plugins.filter(
  (p) => p.skills.length + p.commands.length + p.agents.length > 0,
);

console.log(`${plugins.length} installed; ${fileComponentPlugins.length} have file components to migrate.\n`);

for (const p of fileComponentPlugins) {
  const mkt = marketplaces.find((m) => m.name === p.marketplace);
  if (!mkt) {
    console.log(`SKIP  ${p.name}  (marketplace "${p.marketplace}" not resolvable)`);
    continue;
  }
  invalidatePluginToolStatusCache();
  try {
    const r = await installPlugin(p, mkt.url);
    const total = Object.values(r.linkedInstances).reduce((s, n) => s + n, 0);
    console.log(`${r.success ? "OK  " : "FAIL"}  ${p.name}  linked=${total}  errors=${r.errors.length}`);
    if (r.errors.length) for (const e of r.errors) console.log(`        ${e}`);
  } catch (e) {
    console.log(`ERR   ${p.name}  ${e instanceof Error ? e.message : String(e)}`);
  }
}
