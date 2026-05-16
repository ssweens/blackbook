#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { initializeStore } from "./lib/store.js";
import { patchExistsSync, mark, measure, logReport, setStartupTime } from "./lib/perf.js";

patchExistsSync();
mark("startup");
await initializeStore();
render(<App />);

const startupMs = measure("startup");
if (startupMs !== null) {
  setStartupTime(startupMs);
  logReport();
}
