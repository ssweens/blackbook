/**
 * Playbook tab — browse shared/ and per-tool artifacts + bundles.
 *
 * Layout:
 *   Left panel: artifact type tree (shared skills, shared commands, etc.)
 *   Right panel: contents of selected section
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolId, LoadedPlaybook } from "../lib/playbook/index.js";
import { usePlaybookStore, type PlaybookStore } from "../lib/playbook-store.js";

type Section =
  | { kind: "shared-skills" }
  | { kind: "shared-commands" }
  | { kind: "shared-agents" }
  | { kind: "shared-mcp" }
  | { kind: "tool-skills"; toolId: ToolId }
  | { kind: "tool-commands"; toolId: ToolId }
  | { kind: "tool-bundles"; toolId: ToolId }
  | { kind: "tool-mcp"; toolId: ToolId };

function sectionLabel(s: Section): string {
  switch (s.kind) {
    case "shared-skills":    return "shared/skills";
    case "shared-commands":  return "shared/commands";
    case "shared-agents":    return "shared/agents";
    case "shared-mcp":       return "shared/mcp";
    case "tool-skills":      return `${s.toolId}/skills`;
    case "tool-commands":    return `${s.toolId}/commands`;
    case "tool-bundles":     return `${s.toolId}/bundles`;
    case "tool-mcp":         return `${s.toolId}/mcp`;
  }
}

export function PlaybookTab({ isFocused }: { isFocused: boolean }) {
  const { playbook } = usePlaybookStore();
  const [sectionIdx, setSectionIdx] = useState(0);

  if (!playbook) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="yellow">No playbook loaded.</Text>
      </Box>
    );
  }

  // Build section list
  const sections: Section[] = [
    { kind: "shared-skills" },
    { kind: "shared-commands" },
    { kind: "shared-agents" },
    { kind: "shared-mcp" },
  ];
  for (const toolId of playbook.manifest.tools_enabled) {
    const tc = playbook.tools[toolId];
    if (!tc) continue;
    if (tc.standalone.skills.length) sections.push({ kind: "tool-skills", toolId });
    if (tc.standalone.commands.length) sections.push({ kind: "tool-commands", toolId });
    const bundles = [
      ...(tc.pluginsManifest?.plugins ?? []),
      ...(tc.packagesManifest?.packages ?? []),
    ];
    if (bundles.length) sections.push({ kind: "tool-bundles", toolId });
    if (Object.keys(tc.config.include_shared.mcp).length) sections.push({ kind: "tool-mcp", toolId });
  }

  const selected = sections[sectionIdx] ?? sections[0];

  useInput(
    (_input, key) => {
      if (!isFocused) return;
      if (key.upArrow) setSectionIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setSectionIdx((i) => Math.min(sections.length - 1, i + 1));
    },
  );

  return (
    <Box flexDirection="row" flexGrow={1}>
      {/* Section tree */}
      <Box flexDirection="column" width={28} borderStyle="single" borderRight paddingX={1}>
        <Text bold dimColor>Sections</Text>
        {sections.map((s, i) => {
          const sel = i === sectionIdx && isFocused;
          const bg = sel ? "blue" : undefined;
          const fg = sel ? "white" : undefined;
          return (
            <Text key={i} backgroundColor={bg} color={fg}>
              {sel ? "▶ " : "  "}{sectionLabel(s)}
            </Text>
          );
        })}
      </Box>

      {/* Section contents */}
      <Box flexDirection="column" flexGrow={1} paddingX={2}>
        {selected && <SectionContents section={selected} playbook={playbook} />}
      </Box>
    </Box>
  );
}

function SectionContents({
  section,
  playbook,
}: {
  section: Section;
  playbook: LoadedPlaybook;
}) {
  switch (section.kind) {
    case "shared-skills":
      return <ArtifactList
        title="Shared skills"
        items={playbook.shared.skills.map((s) => s.name)}
        empty="(none — add a skill folder to shared/skills/)"
      />;

    case "shared-commands":
      return <ArtifactList
        title="Shared commands"
        items={playbook.shared.commands.map((c) => c.name)}
        empty="(none — add <name>.md to shared/commands/)"
      />;

    case "shared-agents":
      return <ArtifactList
        title="Shared agents"
        items={playbook.shared.agents.map((a) => a.name)}
        empty="(none — add <name>.md to shared/agents/)"
      />;

    case "shared-mcp": {
      const servers = Object.values(playbook.shared.mcp);
      return (
        <Box flexDirection="column">
          <Text bold>Shared MCP servers</Text>
          {servers.length === 0 ? (
            <Text dimColor>(none — add server definitions to shared/mcp/)</Text>
          ) : (
            servers.map((s) => (
              <Box key={s.name} flexDirection="column" marginTop={1}>
                <Text bold>{s.name}</Text>
                <Text dimColor>  type: {s.type}</Text>
                {s.type === "remote" && <Text dimColor>  url: {s.url}</Text>}
                {s.type === "local" && (
                  <Text dimColor>  command: {s.command.join(" ")}</Text>
                )}
                <Text dimColor>  enabled: {String(s.enabled)}</Text>
              </Box>
            ))
          )}
        </Box>
      );
    }

    case "tool-skills": {
      const tc = playbook.tools[section.toolId];
      return <ArtifactList
        title={`${section.toolId} — tool-specific skills`}
        items={tc?.standalone.skills.map((s: import('../lib/playbook/index.js').ArtifactRef) => s.name) ?? []}
        subtitle={`Opt-in shared: ${tc?.config.include_shared.skills.join(", ") || "(none)"}`}
      />;
    }

    case "tool-commands": {
      const tc = playbook.tools[section.toolId];
      return <ArtifactList
        title={`${section.toolId} — tool-specific commands`}
        items={tc?.standalone.commands.map((c: import('../lib/playbook/index.js').ArtifactRef) => c.name) ?? []}
        subtitle={`Opt-in shared: ${tc?.config.include_shared.commands.join(", ") || "(none)"}`}
      />;
    }

    case "tool-bundles": {
      const tc = playbook.tools[section.toolId];
      const bundles = [
        ...(tc?.pluginsManifest?.plugins ?? []),
        ...(tc?.packagesManifest?.packages ?? []),
      ];
      return (
        <Box flexDirection="column">
          <Text bold>{section.toolId} — bundles</Text>
          {bundles.map((b) => {
            const src = b.source;
            const srcStr = src.type === "marketplace"
              ? `${src.marketplace}/${src.plugin}`
              : src.type === "npm"
              ? src.package
              : src.type === "git"
              ? src.url
              : src.path;
            return (
              <Box key={b.name} flexDirection="column" marginTop={1}>
                <Text>
                  <Text color={b.enabled ? "green" : "gray"}>
                    {b.enabled ? "✓" : "·"}
                  </Text>
                  {" "}{b.name}
                  {b.version && <Text dimColor> @{b.version}</Text>}
                </Text>
                <Text dimColor>  source: {src.type}:{srcStr}</Text>
              </Box>
            );
          })}
        </Box>
      );
    }

    case "tool-mcp": {
      const tc = playbook.tools[section.toolId];
      const included = tc?.config.include_shared.mcp ?? [];
      return <ArtifactList
        title={`${section.toolId} — MCP servers (opted in)`}
        items={included}
        empty="(none — add names to include_shared.mcp in tool.yaml)"
      />;
    }

    default:
      return <Text dimColor>Select a section</Text>;
  }
}

function ArtifactList({
  title,
  items,
  empty,
  subtitle,
}: {
  title: string;
  items: string[];
  empty?: string;
  subtitle?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {subtitle && <Text dimColor>  {subtitle}</Text>}
      {items.length === 0 ? (
        <Text dimColor>{empty ?? "(none)"}</Text>
      ) : (
        items.map((item) => (
          <Text key={item}>  · {item}</Text>
        ))
      )}
    </Box>
  );
}
