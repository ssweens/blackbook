import { Command } from "commander";
import { runStatus, runList, runSync, runInstall, runUninstall, type CommandResult } from "./commands.js";

const SUBCOMMAND_NAMES = ["status", "list", "sync", "install", "uninstall"];

/** True if argv (post `node script.js`) is a headless CLI invocation rather than a bare TUI launch. */
export function isCliInvocation(argv: string[]): boolean {
  const first = argv[0];
  if (!first) return false;
  if (first === "--help" || first === "-h" || first === "--version" || first === "-V") return true;
  return SUBCOMMAND_NAMES.includes(first);
}

async function handle(result: Promise<CommandResult>): Promise<number> {
  const { exitCode, output } = await result;
  console.log(output);
  return exitCode;
}

/** Parse and run argv (post `node script.js`), returning the process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  let exitCode = 0;

  const program = new Command();
  program
    .name("blackbook")
    .description("Blackbook — plugin/skill/config manager for AI coding tools")
    .exitOverride()
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
    });

  program
    .command("status")
    .description("Show what's out of sync (missing/drifted plugins, skills, files, pi packages)")
    .option("--tool <id>", "scope to one tool instance (toolId, name, or toolId:instanceId)")
    .option("--json", "machine-readable JSON output")
    .action(async (opts) => {
      exitCode = await handle(runStatus({ tool: opts.tool, json: opts.json }));
    });

  program
    .command("list")
    .description("List everything tracked (plugins, skills, files, pi packages) with install state")
    .option("--tool <id>", "scope to one tool instance (toolId, name, or toolId:instanceId)")
    .option("--json", "machine-readable JSON output")
    .action(async (opts) => {
      exitCode = await handle(runList({ tool: opts.tool, json: opts.json }));
    });

  program
    .command("sync")
    .description("Sync missing/drifted items")
    .option("--tool <id>", "scope to one tool instance (toolId, name, or toolId:instanceId)")
    .option("--yes", "also force-overwrite conflicts and untracked existing targets")
    .option("--dry-run", "show what would sync without changing anything")
    .option("--json", "machine-readable JSON output")
    .action(async (opts) => {
      exitCode = await handle(runSync({ tool: opts.tool, json: opts.json, yes: opts.yes, dryRun: opts.dryRun }));
    });

  program
    .command("install <name>")
    .description("Install a plugin or standalone skill to all enabled tools (name or name@marketplace)")
    .option("--json", "machine-readable JSON output")
    .action(async (name, opts) => {
      exitCode = await handle(runInstall(name, { json: opts.json }));
    });

  program
    .command("uninstall <name>")
    .description("Uninstall a plugin or standalone skill from all enabled tools (name or name@marketplace)")
    .option("--json", "machine-readable JSON output")
    .action(async (name, opts) => {
      exitCode = await handle(runUninstall(name, { json: opts.json }));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    // commander's exitOverride throws a CommanderError instead of calling
    // process.exit — help/version output already happened via configureOutput.
    const code = (error as { exitCode?: number }).exitCode;
    return typeof code === "number" ? code : 1;
  }

  return exitCode;
}
