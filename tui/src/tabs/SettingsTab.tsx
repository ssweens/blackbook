import React from "react";
import { SettingsPanel } from "../components/SettingsPanel.js";

export function SettingsTab({ onTextInputActiveChange }: { onTextInputActiveChange: (active: boolean) => void }) {
  return <SettingsPanel onTextInputActiveChange={onTextInputActiveChange} />;
}
