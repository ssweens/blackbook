import type { AdapterDefaults } from "../types.js";

export const AMP_DEFAULTS: AdapterDefaults = {
  toolId: "amp",
  displayName: "Amp Code",
  defaultConfigDir: "~/.config/amp",
  paths: {
    skills: "skills",
    commands: "commands",
    agents: "agents",
    agentsMd: "AGENTS.md",
    // Amp MCP support is not yet verified externally; treat as unavailable in v1.
    mcp: null,
    hooks: null,
  },
  binary: "amp",
  capabilities: {
    skills: true,
    commands: true,
    agents: true,
    agentsMd: true,
    mcp: false,                // TODO: verify Amp MCP support; bump to true when wired
    hooks: false,
    bundleParadigm: null,       // TODO: verify Amp plugin/extension model
  },
};
