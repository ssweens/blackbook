import { getToolDefinitions } from "./config.js";
import { getAllPlaybooks } from "./config/playbooks.js";
import type { PlaybookLifecycle } from "./config/playbook-schema.js";

export interface ToolRegistryEntry {
  toolId: string;
  displayName: string;
  defaultConfigDir: string;
  binaryName: string;
  npmPackage: string;
  versionArgs: string[];
  homepage: string;
  lifecycle?: PlaybookLifecycle;
}

const TOOL_METADATA: Record<string, Omit<ToolRegistryEntry, "toolId" | "displayName" | "defaultConfigDir" | "lifecycle">> = {
  "claude-code": {
    binaryName: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    versionArgs: ["--version"],
    homepage: "https://docs.anthropic.com/en/docs/claude-code",
  },
  opencode: {
    binaryName: "opencode",
    npmPackage: "opencode-ai",
    versionArgs: ["--version"],
    homepage: "https://github.com/opencode-ai/opencode",
  },
  "amp-code": {
    binaryName: "amp",
    npmPackage: "@sourcegraph/amp",
    versionArgs: ["--version"],
    homepage: "https://ampcode.com",
  },
  "openai-codex": {
    binaryName: "codex",
    npmPackage: "@openai/codex",
    versionArgs: ["--version"],
    homepage: "https://developers.openai.com/codex/cli",
  },
  pi: {
    binaryName: "pi",
    npmPackage: "@mariozechner/pi-coding-agent",
    versionArgs: ["--version"],
    homepage: "https://github.com/mariozechner/pi",
  },
};

function buildRegistry(): Record<string, ToolRegistryEntry> {
  const definitions = getToolDefinitions();
  const playbooks = getAllPlaybooks();
  const entries: Record<string, ToolRegistryEntry> = {};

  for (const [toolId, definition] of Object.entries(definitions)) {
    const metadata = TOOL_METADATA[toolId];
    if (!metadata) {
      continue;
    }

    entries[toolId] = {
      toolId,
      displayName: definition.name,
      defaultConfigDir: definition.configDir,
      ...metadata,
      lifecycle: playbooks.get(toolId)?.lifecycle,
    };
  }

  return entries;
}

export const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = buildRegistry();

export function getToolRegistryEntry(toolId: string): ToolRegistryEntry | null {
  return TOOL_REGISTRY[toolId] || null;
}
