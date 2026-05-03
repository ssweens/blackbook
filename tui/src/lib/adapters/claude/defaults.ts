import type { AdapterDefaults } from "../types.js";

export const CLAUDE_DEFAULTS: AdapterDefaults = {
  toolId: "claude",
  displayName: "Claude Code",
  defaultConfigDir: "~/.claude",
  paths: {
    skills: "skills",
    commands: "commands",
    agents: "agents",
    agentsMd: "AGENTS.md",      // CLAUDE.md detected as variant via addAgentsMdVariants
    mcp: ".mcp.json",
    hooks: "hooks",
  },
  binary: "claude",
  capabilities: {
    skills: true,
    commands: true,
    agents: true,
    agentsMd: true,
    mcp: true,
    hooks: true,
    bundleParadigm: "artifact",
  },
};

/** Filenames Claude accepts as the AGENTS.md document, in priority order. */
export const CLAUDE_AGENTS_MD_VARIANTS = ["AGENTS.md", "CLAUDE.md"];
