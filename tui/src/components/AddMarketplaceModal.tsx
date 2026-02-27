import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

type MarketplaceType = "plugin" | "pi";

interface AddMarketplaceModalProps {
  type?: MarketplaceType;
  onSubmit: (name: string, source: string) => void;
  onCancel: () => void;
}

function parsePluginSource(source: string): { name: string; url: string } | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  // Full HTTPS URL to marketplace.json
  if (trimmed.startsWith("https://") && trimmed.includes("marketplace.json")) {
    const match = trimmed.match(/github(?:usercontent)?\.com\/([^/]+)\/([^/]+)/);
    const name = match ? match[2] : trimmed.split("/").pop()?.replace(".json", "") || "custom";
    return { name, url: trimmed };
  }

  // Full HTTPS URL (add default path)
  if (trimmed.startsWith("https://")) {
    const match = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      const name = match[2].replace(".git", "");
      const url = `https://raw.githubusercontent.com/${match[1]}/${name}/main/.claude-plugin/marketplace.json`;
      return { name, url };
    }
    return null;
  }

  // SSH format: git@github.com:owner/repo.git
  if (trimmed.startsWith("git@github.com:")) {
    const match = trimmed.match(/git@github\.com:([^/]+)\/([^.]+)/);
    if (match) {
      const name = match[2];
      const url = `https://raw.githubusercontent.com/${match[1]}/${name}/main/.claude-plugin/marketplace.json`;
      return { name, url };
    }
    return null;
  }

  // Local path
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("~")) {
    const name = trimmed.split("/").filter(Boolean).pop() || "local";
    return { name, url: trimmed };
  }

  // GitHub shorthand: owner/repo
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split("/");
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/.claude-plugin/marketplace.json`;
    return { name: repo, url };
  }

  return null;
}

function parsePiSource(source: string): { name: string; url: string } | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("~")) {
    const name = trimmed.split("/").filter(Boolean).pop() || "local";
    return { name, url: trimmed };
  }

  // GitHub HTTPS URL
  const ghHttps = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (ghHttps) {
    const name = ghHttps[2];
    return { name, url: `https://github.com/${ghHttps[1]}/${name}.git` };
  }

  // GitHub SSH URL
  const ghSsh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ghSsh) {
    const name = ghSsh[2];
    return { name, url: `git@github.com:${ghSsh[1]}/${name}.git` };
  }

  // git:github.com/owner/repo shorthand
  const gitPrefix = trimmed.match(/^git:github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (gitPrefix) {
    const name = gitPrefix[2];
    return { name, url: `git:github.com/${gitPrefix[1]}/${name}` };
  }

  // Generic HTTPS git URL
  if (trimmed.startsWith("https://") && trimmed.endsWith(".git")) {
    const name = trimmed.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "git-marketplace";
    return { name, url: trimmed };
  }

  // Generic SSH git URL
  if (trimmed.startsWith("git@") && trimmed.includes(":")) {
    const name = trimmed.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") || "git-marketplace";
    return { name, url: trimmed };
  }

  // owner/repo shorthand
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split("/");
    return { name: repo, url: `https://github.com/${owner}/${repo}.git` };
  }

  return null;
}

const VARIANTS: Record<MarketplaceType, {
  title: string;
  prompt: string;
  examples: string[];
  errorMessage: string;
  parse: (source: string) => { name: string; url: string } | null;
}> = {
  plugin: {
    title: "Add Plugin Marketplace",
    prompt: "Enter marketplace source:",
    examples: [
      "owner/repo (GitHub)",
      "git@github.com:owner/repo.git (SSH)",
      "https://example.com/marketplace.json",
      "./path/to/marketplace",
    ],
    errorMessage: "Invalid marketplace source format",
    parse: parsePluginSource,
  },
  pi: {
    title: "Add Pi Marketplace",
    prompt: "Enter local directory or git repository containing Pi packages:",
    examples: [
      "~/src/my-packages",
      "/opt/pi-packages",
      "https://github.com/org/pi-packages.git",
      "git@github.com:org/pi-packages.git",
      "org/pi-packages",
    ],
    errorMessage: "Enter a local path or git repository source",
    parse: parsePiSource,
  },
};

export function AddMarketplaceModal({ type = "plugin", onSubmit, onCancel }: AddMarketplaceModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const variant = VARIANTS[type];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const result = variant.parse(value);
      if (result) {
        onSubmit(result.name, result.url);
      } else {
        setError(variant.errorMessage);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>{variant.title}</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>{variant.prompt}</Text>
        <Text color="gray">Examples:</Text>
        {variant.examples.map((ex) => (
          <Text key={ex} color="gray">  • {ex}</Text>
        ))}
      </Box>

      <Box marginBottom={1}>
        <TextInput value={value} onChange={setValue} />
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box>
        <Text color="gray" italic>Enter to add ; Esc to cancel</Text>
      </Box>
    </Box>
  );
}
