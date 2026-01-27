#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { initializeStore } from "./lib/store.js";

initializeStore();
render(<App />);
