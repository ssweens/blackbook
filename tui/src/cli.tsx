#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { homedir } from "os";
import { App } from "./App.js";
import { initializeStore } from "./lib/store.js";
import { isAgenticDir } from "./lib/projects.js";
import { recordRecentWorkspace } from "./lib/recent-workspaces.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";
import { logError } from "./lib/validation.js";
import { reconcileStaleInstallArtifacts } from "./lib/install.js";
import { isCliInvocation, runCli } from "./lib/cli/program.js";
import { flushStdio } from "./lib/cli/flush.js";

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
  await flushStdio();
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
// .claude/AGENTS.md/CLAUDE.md), register the current directory as a recent
// workspace so it shows up on the Projects tab. It does NOT switch tabs or
// block the first paint — the app opens on the default tab and loads Sync,
// projects and everything else in the background (App's boot effect). The home
// dir is excluded — it carries those markers too but is already the synthetic
// Global workspace. A plain `recordRecentWorkspace` is a cheap, synchronous
// file write. Never allowed to block or break startup.
try {
  const cwd = process.cwd();
  if (cwd !== homedir() && isAgenticDir(cwd)) {
    recordRecentWorkspace(cwd);
  }
} catch (error) {
  logError("Failed to register cwd workspace", error);
}

render(<App />);

const startupMs = measure("startup");
if (startupMs !== null) {
  setStartupTime(startupMs);
  logReport();
}
