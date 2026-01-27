import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function SearchBox({ 
  value, 
  onChange, 
  placeholder = "Search...", 
  focus = false,
  onFocus,
  onBlur,
}: SearchBoxProps) {
  useInput((input, key) => {
    if (!focus && input === "/") {
      onFocus?.();
      return;
    }
    if (focus && key.escape) {
      onBlur?.();
      return;
    }
  });

  return (
    <Box marginBottom={1}>
      <Text color={focus ? "cyan" : "gray"}>{focus ? "● " : "○ "}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        placeholder={focus ? placeholder : "press / to search"}
        focus={focus}
        showCursor={focus}
      />
    </Box>
  );
}
