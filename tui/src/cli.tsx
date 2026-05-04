#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { PlaybookApp } from "./tabs-v2/PlaybookApp.js";
import { initializeStore } from "./lib/store.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";
import { runPlaybookCli } from "./cli/playbook-cli.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

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

/** Read playbook_path from ~/.config/blackbook/config.yaml if it exists. */
function readConfiguredPlaybookPath(): string | undefined {
  const cfgPath = resolve(homedir(), ".config", "blackbook", "config.yaml");
  if (!existsSync(cfgPath)) return undefined;
  const text = readFileSync(cfgPath, "utf-8");
  const match = text.match(/^playbook_path:\s*(.+)\s*$/m);
  if (!match) return undefined;
  return match[1].replace(/^["']|["']$/g, "").trim();
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  // Subcommand routing: non-interactive playbook commands
  if (sub && PLAYBOOK_SUBCOMMANDS.has(sub)) {
    const result = await runPlaybookCli(argv);
    if (result.stdout) process.stdout.write(result.stdout + (result.stdout.endsWith("\n") ? "" : "\n"));
    if (result.stderr) process.stderr.write(result.stderr + (result.stderr.endsWith("\n") ? "" : "\n"));
    process.exit(result.exitCode);
  }

  // New playbook TUI: activated when a playbook is configured (or --playbook flag)
  const playbookFlag = argv.find((a) => a.startsWith("--playbook="));
  const playbookPathArg = playbookFlag?.split("=")[1];
  const configuredPath = readConfiguredPlaybookPath();
  const playbookPath = playbookPathArg ? resolve(playbookPathArg) : configuredPath;

  if (playbookPath) {
    render(<PlaybookApp playbookPath={playbookPath} />);
    return;
  }

  // Legacy TUI (no playbook configured)
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
