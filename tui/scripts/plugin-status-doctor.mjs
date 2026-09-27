#!/usr/bin/env node
/**
 * Plugin status doctor — mechanized "audit everything".
 *
 * Loads EVERY installed plugin from the real manifest + filesystem and checks
 * the invariants that plugin status/drift computation must satisfy. This exists
 * because eyeballing one plugin's detail screen repeatedly missed the same class
 * of bug (a green "In sync" row while the plugin was actually incomplete, a
 * skill counted present when a per-instance overlay was missing, a manifest
 * dest still pointing at a legacy per-tool dir). A program checks all of them,
 * every time, and prints exactly what is inconsistent.
 *
 * Usage:  node scripts/plugin-status-doctor.mjs            # human report
 *         node scripts/plugin-status-doctor.mjs --json     # machine output
 * Exit 0 = all invariants hold. Exit 1 = at least one violation (used as a gate).
 */
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const lib = (p) => join(ROOT, "src", "lib", p);

const { getAllInstalledPlugins } = await import(lib("install.ts"));
const { buildPluginActions } = await import(lib("item-actions.ts"));
const { getPluginToolStatus, invalidatePluginToolStatusCache } = await import(lib("plugin-status.ts"));
const { getInstallStatus } = await import(lib("plugin-merge.ts"));
const { computePluginDrift } = await import(lib("plugin-drift.ts"));
const { getToolInstances } = await import(lib("config.ts"));
const { loadManifest } = await import(lib("manifest.ts"));

const jsonMode = process.argv.includes("--json");
const AGENTS_ROOT = join(homedir(), ".agents");

/** Legacy per-tool locations commands/agents must NOT resolve to anymore. */
const LEGACY_DEST_MARKERS = [
  "/.config/opencode/commands",
  "/.config/opencode/agents",
  "/.config/amp/commands",
  "/.config/amp/agents",
  "/.claude/commands",
  "/.claude/agents",
  "/.claude-learning/commands",
  "/.claude-learning/agents",
  "/.pi/agent/prompts",
];

/** @returns {{plugin:string, invariant:string, detail:string}[]} */
function checkPlugin(plugin, manifest) {
  const violations = [];
  const add = (invariant, detail) => violations.push({ plugin: plugin.name, invariant, detail });

  invalidatePluginToolStatusCache();
  const statuses = getPluginToolStatus(plugin);
  const supportedEnabled = statuses.filter((s) => s.enabled && s.supported);
  // Use the SAME function the app uses to decide incomplete — not a local
  // re-derivation, which would let the doctor and the app disagree (the exact
  // bug class this doctor exists to catch).
  const isIncomplete = getInstallStatus(plugin, true).incomplete;

  const actions = buildPluginActions(plugin, statuses, isIncomplete, plugin._drift);
  const rows = actions.filter((a) => a.id.startsWith("status_"));
  const missingRows = rows.filter((r) => r.statusLabel && String(r.statusLabel).startsWith("Missing"));
  const inSyncRows = rows.filter((r) => r.statusLabel === "In sync");

  // Invariant 1: a "Missing" component row and a not-incomplete plugin contradict.
  if (missingRows.length > 0 && !isIncomplete) {
    add("missing-row-but-not-incomplete",
      `rows Missing=[${missingRows.map((r) => r.label).join(", ")}] but isIncomplete=false`);
  }
  // Invariant 2: an incomplete plugin with ALL rows green is a phantom incomplete.
  if (isIncomplete && missingRows.length === 0 && inSyncRows.length === rows.length && rows.length > 0) {
    const missingInstances = supportedEnabled.filter((s) => !s.installed).map((s) => `${s.toolId}:${s.instanceId}`);
    add("incomplete-but-all-rows-green",
      `isIncomplete=true (missing on ${missingInstances.join(", ")}) yet every component row is In sync`);
  }

  // Invariant 3: no manifest dest for a command/agent may point at a legacy per-tool dir.
  for (const [ikey, tool] of Object.entries(manifest.tools)) {
    for (const [itemKey, item] of Object.entries(tool.items)) {
      if (item.owner !== plugin.name) continue;
      if (item.kind !== "command" && item.kind !== "agent") continue;
      const dest = item.dest || "";
      const legacy = LEGACY_DEST_MARKERS.find((m) => dest.includes(m));
      if (legacy) {
        add("command-agent-dest-in-legacy-dir",
          `${ikey} ${itemKey} dest=${dest} (should live under ~/.agents/${item.kind}s/)`);
      } else if (!dest.startsWith(AGENTS_ROOT + "/")) {
        add("command-agent-dest-outside-agents-store",
          `${ikey} ${itemKey} dest=${dest} (not under ${AGENTS_ROOT})`);
      }
    }
  }

  return { violations, isIncomplete, rows: rows.map((r) => `${r.label}:${r.statusLabel}`) };
}

const { plugins } = getAllInstalledPlugins();
const manifest = loadManifest();

// Attach real drift to each plugin the same way the app does before rendering.
for (const p of plugins) {
  try {
    p._drift = await computePluginDrift(p);
  } catch {
    p._drift = {};
  }
}

const allViolations = [];
const perPlugin = [];
for (const p of plugins) {
  const r = checkPlugin(p, manifest);
  allViolations.push(...r.violations);
  perPlugin.push({ name: p.name, isIncomplete: r.isIncomplete, rows: r.rows, driftKeys: Object.entries(p._drift || {}).filter(([, v]) => v !== "in-sync") });
}

if (jsonMode) {
  console.log(JSON.stringify({ pluginCount: plugins.length, violations: allViolations }, null, 2));
} else {
  console.log(`Checked ${plugins.length} installed plugins.\n`);
  // Show the drift breakdown for anything not fully in-sync (diagnostic).
  for (const pp of perPlugin) {
    if (pp.driftKeys.length > 0 || pp.isIncomplete) {
      console.log(`• ${pp.name}  incomplete=${pp.isIncomplete}`);
      console.log(`    rows: ${pp.rows.join(" | ")}`);
      if (pp.driftKeys.length > 0) {
        console.log(`    drift: ${pp.driftKeys.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    }
  }
  console.log("");
  if (allViolations.length === 0) {
    console.log("✓ No invariant violations.");
  } else {
    console.log(`✗ ${allViolations.length} invariant violation(s):\n`);
    for (const v of allViolations) {
      console.log(`  [${v.invariant}] ${v.plugin}`);
      console.log(`     ${v.detail}`);
    }
  }
}

process.exit(allViolations.length === 0 ? 0 : 1);
