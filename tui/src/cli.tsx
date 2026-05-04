#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { PlaybookApp } from "./tabs-v2/PlaybookApp.js";
import { initializeStore } from "./lib/store.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadPlaybook, validatePlaybook } from "./lib/playbook/index.js";
import { usePlaybookStore } from "./lib/playbook-store.js";

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

  // New playbook TUI: activated when a playbook is configured or --playbook flag passed.
  const playbookFlag = argv.find((a) => a.startsWith("--playbook="));
  const playbookPathArg = playbookFlag?.split("=")[1];
  const configuredPath = readConfiguredPlaybookPath();
  const playbookPath = playbookPathArg ? resolve(playbookPathArg) : configuredPath;

  if (playbookPath) {
    // Load synchronously before first render — eliminates the "No playbook" flash.
    try {
      const pb = loadPlaybook(playbookPath);
      const validation = validatePlaybook(pb);
      usePlaybookStore.getState().setPlaybookImmediate(playbookPath, pb, validation);
    } catch (e) {
      // Surface the error immediately so Dashboard renders the error, not "no playbook".
      usePlaybookStore.setState({
        playbookPath: playbookPath,
        playbookError: e instanceof Error ? e.message : String(e),
        playbookLoading: false,
      });
    }
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
