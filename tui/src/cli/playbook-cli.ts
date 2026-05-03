/**
 * Playbook CLI subcommands.
 *
 * Entry: blackbook <subcommand> [args]
 *
 * Subcommands:
 *   init      — cold-start scaffold from machine state
 *   preview   — dry-run apply
 *   apply     — apply playbook to local tools
 *   status    — per-tool detection + brief drift summary
 *   validate  — schema + cross-file consistency
 *
 * Exit codes:
 *   0 — success
 *   1 — recoverable error (invalid playbook, missing env, etc.)
 *   2 — usage error
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { registerAllAdapters } from "../lib/adapters/all.js";
import { listAdapters, listRegisteredToolIds } from "../lib/adapters/registry.js";
import { loadPlaybook, validatePlaybook } from "../lib/playbook/index.js";
import { engineApply, enginePreview, type EngineSyncResult } from "../lib/sync/index.js";
import { blackbookInit } from "../lib/migration/index.js";

/** Resolve config paths fresh on every call so tests can override HOME. */
function blackbookConfigPaths() {
  const dir = resolve(homedir(), ".config", "blackbook");
  return { dir, path: resolve(dir, "config.yaml") };
}

interface MinimalConfig {
  playbook_path?: string;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────────────────────

export async function runPlaybookCli(argv: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const log = (s = "") => out.push(s);
  const elog = (s: string) => err.push(s);
  const finish = (exitCode: number) => ({
    exitCode,
    stdout: out.join("\n"),
    stderr: err.join("\n"),
  });

  if (argv.length === 0) {
    err.push(usage());
    return finish(2);
  }

  // Tests/embedders may pre-register adapters; only auto-register when nothing
  // is registered yet.
  if (listRegisteredToolIds().length === 0) {
    registerAllAdapters();
  }

  const [sub, ...rest] = argv;

  try {
    let exit = 0;
    switch (sub) {
      case "init":
        exit = await cmdInit(rest, log, elog);
        break;
      case "preview":
        exit = await cmdPreview(rest, log, elog);
        break;
      case "apply":
        exit = await cmdApply(rest, log, elog);
        break;
      case "status":
        exit = await cmdStatus(rest, log, elog);
        break;
      case "validate":
        exit = await cmdValidate(rest, log, elog);
        break;
      case "--help":
      case "-h":
      case "help":
        log(usage());
        break;
      default:
        elog(`Unknown subcommand: ${sub}\n\n${usage()}`);
        return finish(2);
    }
    return finish(exit);
  } catch (e) {
    elog(errorMessage(e));
    return finish(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────

async function cmdInit(
  argv: string[],
  log: (s?: string) => void,
  elog: (s: string) => void,
): Promise<number> {
  const args = parseArgs(argv, {
    string: ["target"],
    bool: ["auto-share", "no-auto-share", "from"],
  });

  // `--from <path>` mode — playbook already exists in git; just write
  // ~/.config/blackbook/config.yaml to point at it.
  if (args.bool["from"]) {
    const path = args.positional[0];
    if (!path) {
      elog("init --from requires a path");
      return 2;
    }
    return handleInitFrom(resolve(path), log, elog);
  }

  const target = resolve(args.string["target"] ?? "~/playbook".replace("~", homedir()));
  const autoShare = args.bool["no-auto-share"] ? false : true;

  log(`Scaffolding playbook at ${target} ...`);
  const result = await blackbookInit({
    targetPath: target,
    autoShare,
  });

  log("");
  log("Tools detected:");
  for (const t of result.toolsScanned) log(`  ✓ ${t}`);
  for (const s of result.toolsSkipped) log(`  ✗ ${s.toolId}: ${s.reason}`);

  if (result.sharedArtifacts.skills.length || result.sharedArtifacts.commands.length || result.sharedArtifacts.agents.length) {
    log("");
    log("Auto-shared (cross-tool, byte-identical):");
    if (result.sharedArtifacts.skills.length) log(`  skills: ${result.sharedArtifacts.skills.join(", ")}`);
    if (result.sharedArtifacts.commands.length) log(`  commands: ${result.sharedArtifacts.commands.join(", ")}`);
    if (result.sharedArtifacts.agents.length) log(`  agents: ${result.sharedArtifacts.agents.join(", ")}`);
  }

  if (result.warnings.length > 0) {
    log("");
    log("Warnings:");
    for (const w of result.warnings) log(`  ! ${w}`);
  }

  // Write minimal config pointing at the new playbook
  writeBlackbookConfig({ playbook_path: target });
  log("");
  log(`Wrote ${blackbookConfigPaths().path}`);
  log(`Playbook ready: ${target}`);
  log("Next: `blackbook preview` to see what would change, then `blackbook apply`.");

  return 0;
}

function handleInitFrom(
  path: string,
  log: (s?: string) => void,
  elog: (s: string) => void,
): number {
  if (!existsSync(path)) {
    elog(`path does not exist: ${path}`);
    return 1;
  }
  const playbook = loadPlaybook(path);
  const report = validatePlaybook(playbook);
  if (!report.ok) {
    const messages = report.issues
      .filter((i) => i.severity === "error")
      .map((i) => `[${i.severity}] ${i.source}: ${i.message}`)
      .join("\n");
    elog(`Playbook invalid:\n${messages}`);
    return 1;
  }
  writeBlackbookConfig({ playbook_path: path });
  log(`Configured to use playbook at ${path}`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// preview / apply
// ─────────────────────────────────────────────────────────────────────────────

async function cmdPreview(
  argv: string[],
  log: (s?: string) => void,
  elog: (s: string) => void,
): Promise<number> {
  const path = resolvePlaybookPath(argv);
  const playbook = loadPlaybook(path);
  const report = validatePlaybook(playbook);
  if (!report.ok) return reportInvalid(report, elog);
  const result = await enginePreview(playbook, { confirmRemovals: false });
  printSyncResult(result, true, log, elog);
  return result.envCheck.ok ? 0 : 1;
}

async function cmdApply(
  argv: string[],
  log: (s?: string) => void,
  elog: (s: string) => void,
): Promise<number> {
  const args = parseArgs(argv, { bool: ["confirm-removals"], string: [] });
  const path = resolvePlaybookPath(args.positional);
  const playbook = loadPlaybook(path);
  const report = validatePlaybook(playbook);
  if (!report.ok) return reportInvalid(report, elog);

  const result = await engineApply(playbook, {
    confirmRemovals: !!args.bool["confirm-removals"],
    dryRun: false,
  });

  if (!result.envCheck.ok) {
    elog(`Required env vars unset: ${result.envCheck.missing.join(", ")}`);
    elog("Refusing to apply. Set them and re-run.");
    return 1;
  }

  printSyncResult(result, false, log, elog);

  const errors = result.perInstance.flatMap((p) => p.apply.errors);
  return errors.length ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// status
// ─────────────────────────────────────────────────────────────────────────────

async function cmdStatus(
  _argv: string[],
  log: (s?: string) => void,
  elog: (s: string) => void,
): Promise<number> {
  log("Detected tools:");
  for (const a of listAdapters()) {
    const det = await a.detect();
    const mark = det.installed ? "✓" : "·";
    const v = det.version ? ` (${det.version.split("\n")[0]})` : "";
    log(`  ${mark} ${a.defaults.toolId}${v}  → ${det.configDir}`);
  }

  // If a playbook is configured, show drift summary
  const cfg = readBlackbookConfig();
  if (!cfg?.playbook_path) {
    log("");
    log("No playbook configured. Run `blackbook init` to create one.");
    return 0;
  }

  const playbook = loadPlaybook(cfg.playbook_path);
  const report = validatePlaybook(playbook);
  if (!report.ok) return reportInvalid(report, elog);

  log("");
  log(`Playbook: ${cfg.playbook_path}`);
  const result = await enginePreview(playbook, { confirmRemovals: false });
  printSyncResult(result, true, log, elog);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// validate
// ─────────────────────────────────────────────────────────────────────────────

async function cmdValidate(
  argv: string[],
  log: (s?: string) => void,
  _elog: (s: string) => void,
): Promise<number> {
  const path = resolvePlaybookPath(argv);
  const playbook = loadPlaybook(path);
  const report = validatePlaybook(playbook);

  if (report.issues.length === 0) {
    log("Playbook valid; no issues found.");
    return 0;
  }

  log(`Found ${report.issues.length} issue(s):`);
  for (const i of report.issues) {
    log(`  [${i.severity}] ${i.source}${i.pointer ? ` (${i.pointer})` : ""}: ${i.message}`);
  }
  return report.ok ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolvePlaybookPath(positional: string[]): string {
  if (positional[0]) return resolve(positional[0]);
  const cfg = readBlackbookConfig();
  if (cfg?.playbook_path) return resolve(cfg.playbook_path);
  throw new Error(
    "No playbook path. Pass one as the first arg, or run `blackbook init` to configure one.",
  );
}

function readBlackbookConfig(): MinimalConfig | undefined {
  const { path } = blackbookConfigPaths();
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf-8");
  // Minimal YAML: we only need playbook_path. Use a tiny regex to avoid
  // pulling YAML for one key.
  const match = text.match(/^playbook_path:\s*(.+)\s*$/m);
  if (!match) return {};
  return { playbook_path: match[1].replace(/^["']|["']$/g, "").trim() };
}

function writeBlackbookConfig(cfg: MinimalConfig): void {
  const { dir, path } = blackbookConfigPaths();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = [
    "# blackbook config — points at a playbook directory",
    "# Edit `blackbook init --from <path>` to change.",
  ];
  if (cfg.playbook_path) lines.push(`playbook_path: ${cfg.playbook_path}`);
  writeFileSync(path, lines.join("\n") + "\n");
}

function reportInvalid(
  report: ReturnType<typeof validatePlaybook>,
  elog: (s: string) => void,
): number {
  const messages = report.issues
    .filter((i) => i.severity === "error")
    .map((i) => `[error] ${i.source}: ${i.message}`)
    .join("\n");
  elog(`Playbook invalid:\n${messages}`);
  return 1;
}

function printSyncResult(
  result: EngineSyncResult,
  isPreview: boolean,
  log: (s?: string) => void,
  elog: (s: string) => void,
): void {
  if (!result.envCheck.ok) {
    log("");
    log(`⚠ Required env vars not set: ${result.envCheck.missing.join(", ")}`);
  }
  if (result.topLevelErrors.length) {
    log("");
    log("Top-level errors:");
    for (const e of result.topLevelErrors) log(`  ! ${e.message}`);
  }
  log("");
  for (const p of result.perInstance) {
    const real = p.diff.ops.filter((o) => o.kind !== "no-op");
    const counts = countByKind(p.diff.ops);
    const verb = isPreview ? "would" : "did";
    log(`[${p.toolId}/${p.instanceId}] ${verb}: ${counts}`);
    for (const op of real) {
      log(`  ${kindGlyph(op.kind)} ${op.artifactType}/${op.name}  (${op.reason})`);
    }
    if (p.mcpEmit) {
      const written = p.mcpEmit.written.length;
      const unchanged = p.mcpEmit.unchanged.length;
      log(`  mcp: ${written} written, ${unchanged} unchanged`);
    }
    for (const err of p.apply.errors) {
      elog(`  ERR ${p.toolId}/${p.instanceId}: ${err.op.name}: ${err.message}`);
    }
    for (const e of p.errors) {
      log(`  ! ${e.message}`);
    }
  }
}

function countByKind(ops: { kind: string }[]): string {
  const counts = ops.reduce<Record<string, number>>((acc, o) => {
    acc[o.kind] = (acc[o.kind] ?? 0) + 1;
    return acc;
  }, {});
  return ["add", "update", "remove", "no-op"]
    .map((k) => `${counts[k] ?? 0} ${k}`)
    .join(", ");
}

function kindGlyph(kind: string): string {
  return kind === "add" ? "+" : kind === "remove" ? "-" : kind === "update" ? "~" : "=";
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface ParsedArgs {
  positional: string[];
  bool: Record<string, boolean>;
  string: Record<string, string | undefined>;
}

function parseArgs(
  argv: string[],
  schema: { string: string[]; bool: string[] },
): ParsedArgs {
  const out: ParsedArgs = { positional: [], bool: {}, string: {} };
  for (const k of schema.bool) out.bool[k] = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out.positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (schema.bool.includes(name)) {
      out.bool[name] = true;
      continue;
    }
    if (schema.string.includes(name)) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out.string[name] = next;
        i++;
      }
      continue;
    }
    // unknown flag — preserve as positional for forwards compat
    out.positional.push(a);
  }
  // ensure parent dir exists for clean paths
  return out;
}

function usage(): string {
  return `blackbook — playbook-centric AI tool config manager

Usage:
  blackbook                    Open the TUI
  blackbook init               Scaffold a playbook from current machine state
  blackbook init --from <path> Use an existing playbook directory (e.g. cloned from git)
  blackbook preview [path]     Show what apply would do (dry-run)
  blackbook apply [path]       Apply playbook to local tools
                                 --confirm-removals  allow file deletions
  blackbook status             Show detection + brief drift summary
  blackbook validate [path]    Check schema + cross-file consistency

Environment:
  ~/.config/blackbook/config.yaml — points at the active playbook
`;
}

// Re-export internals only for tests.
export const __test = {
  readBlackbookConfig,
  writeBlackbookConfig,
  parseArgs,
  blackbookConfigPaths,
};
