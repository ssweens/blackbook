import type { AdapterDefaults } from "../types.js";

export const CODEX_DEFAULTS: AdapterDefaults = {
  toolId: "codex",
  displayName: "Codex (OpenAI)",
  defaultConfigDir: "~/.codex",
  paths: {
    skills: "skills",
    commands: "commands",      // verify; Codex docs reference plugin-contributed commands. Custom prompts live in prompts/ but those are outside the scope here.
    agents: "agents",
    agentsMd: "AGENTS.md",
    // MCP lives inside config.toml (TOML) — adapter merges, no dedicated file.
    mcp: "config.toml",
    hooks: null,                // hooks are inside plugin manifests, not standalone
  },
  binary: "codex",
  capabilities: {
    skills: true,
    commands: true,
    agents: true,
    agentsMd: true,
    mcp: true,
    hooks: true,                // available inside plugins, not at top level
    bundleParadigm: "artifact",
  },
};
