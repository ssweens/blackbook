#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { initializeStore } from "./lib/store.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";
import { runPlaybookCli } from "./cli/playbook-cli.js";

const PLAYBOOK_SUBCOMMANDS = new Set([
  "init",
  "preview",
  "apply",
  "status",
  "validate",
  "help",
  "--help",
  "-h",
]);

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  // Subcommand routing: anything matching a playbook command goes to the CLI.
  // Otherwise drop into the TUI (existing behavior).
  if (sub && PLAYBOOK_SUBCOMMANDS.has(sub)) {
    const result = await runPlaybookCli(argv);
    if (result.stdout) process.stdout.write(result.stdout + (result.stdout.endsWith("\n") ? "" : "\n"));
    if (result.stderr) process.stderr.write(result.stderr + (result.stderr.endsWith("\n") ? "" : "\n"));
    process.exit(result.exitCode);
  }

  patchExistsSync();
  mark("startup");
  initializeStore();
  render(<App />);

  const startupMs = measure("startup");
  if (startupMs !== null) {
    setStartupTime(startupMs);
    logReport();
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
