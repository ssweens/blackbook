import type { AdapterDefaults } from "../types.js";

export const PI_DEFAULTS: AdapterDefaults = {
  toolId: "pi",
  displayName: "Pi",
  defaultConfigDir: "~/.pi/agent",
  paths: {
    skills: "skills",
    commands: "prompts",     // Pi calls them "prompts"
    agents: "agents",         // present in the data model; verify on disk
    agentsMd: "AGENTS.md",
    // Pi core has no MCP; pi-mcp-adapter is the bridge.
    // Standard MCP location used when adapter is installed.
    mcp: ".mcp.json",
    hooks: null,
  },
  binary: "pi",
  capabilities: {
    skills: true,
    commands: true,
    agents: true,
    agentsMd: true,
    mcp: false,
    mcpViaPackage: { packageName: "pi-mcp-adapter" },
    hooks: false,
    bundleParadigm: "code-package",
  },
};
