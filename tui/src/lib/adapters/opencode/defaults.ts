import type { AdapterDefaults } from "../types.js";

export const OPENCODE_DEFAULTS: AdapterDefaults = {
  toolId: "opencode",
  displayName: "OpenCode",
  defaultConfigDir: "~/.config/opencode",
  paths: {
    skills: "skills",
    commands: "commands",
    agents: "agents",
    agentsMd: "AGENTS.md",
    // OpenCode MCP lives in opencode.json under `mcp` key — adapter merges JSON.
    mcp: "opencode.json",
    hooks: null,                  // hooks are runtime via plugins, not file-based
  },
  binary: "opencode",
  capabilities: {
    skills: true,
    commands: true,
    agents: true,
    agentsMd: true,
    mcp: true,
    hooks: false,
    bundleParadigm: "code-package",
  },
};
