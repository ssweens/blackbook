#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { homedir } from "os";
import { App } from "./App.js";
import { initializeStore, useStore } from "./lib/store.js";
import { isAgenticDir } from "./lib/projects.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";
import { logError } from "./lib/validation.js";
import { reconcileStaleInstallArtifacts } from "./lib/install.js";
import { isCliInvocation, runCli } from "./lib/cli/program.js";

// Safety net: a stray unhandled promise rejection (e.g. from a fire-and-forget
// background refresh) must never terminate the whole TUI. Log it and degrade
// gracefully instead of letting the default behavior crash the process.
process.on("unhandledRejection", (reason) => {
  logError("Unhandled promise rejection", reason);
});

// Headless CLI mode: `blackbook status|list|sync|install|uninstall ...` runs
// non-interactively and exits, skipping the TUI entirely. Bare `blackbook`
// (no recognized subcommand) falls through to the interactive TUI below,
// unchanged.
const cliArgv = process.argv.slice(2);
if (isCliInvocation(cliArgv)) {
  const exitCode = await runCli(cliArgv);
  process.exit(exitCode);
}

patchExistsSync();
mark("startup");
await initializeStore();

// Recover any user files stranded mid-install by an earlier crash (see
// reconcileStaleInstallArtifacts). Never allowed to block or break startup.
try {
  reconcileStaleInstallArtifacts();
} catch (error) {
  logError("Failed to reconcile stale install artifacts", error);
}

// Workspace-aware startup: launched from an agentic project dir (has .agents/
// .claude/AGENTS.md/CLAUDE.md), boot straight into that workspace's drill-in
// view on the Projects tab. The home dir is excluded — it carries those
// markers too but is already the synthetic Global workspace. Never allowed to
// block or break startup.
try {
  const cwd = process.cwd();
  if (cwd !== homedir() && isAgenticDir(cwd)) {
    await useStore.getState().openWorkspace(cwd);
  }
} catch (error) {
  logError("Failed to open cwd workspace", error);
}

render(<App />);

const startupMs = measure("startup");
if (startupMs !== null) {
  setStartupTime(startupMs);
  logReport();
}
