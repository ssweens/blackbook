import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface AddMarketplaceModalProps {
  onSubmit: (name: string, url: string) => void;
  onCancel: () => void;
}

function parseMarketplaceSource(source: string): { name: string; url: string } | null {
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
    const name = trimmed.split("/").pop() || "local";
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

export function AddMarketplaceModal({ onSubmit, onCancel }: AddMarketplaceModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const result = parseMarketplaceSource(value);
      if (result) {
        onSubmit(result.name, result.url);
      } else {
        setError("Invalid marketplace source format");
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Add Marketplace</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>Enter marketplace source:</Text>
        <Text color="gray">Examples:</Text>
        <Text color="gray">  • owner/repo (GitHub)</Text>
        <Text color="gray">  • git@github.com:owner/repo.git (SSH)</Text>
        <Text color="gray">  • https://example.com/marketplace.json</Text>
        <Text color="gray">  • ./path/to/marketplace</Text>
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
