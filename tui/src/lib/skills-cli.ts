/**
 * Runs the vendored skills CLI (vendor/skills — vercel-labs/skills with the
 * Blackbook central-store patch). Blackbook does not reimplement anything the
 * CLI does: installs, removes, updates, lockfile (`skills-lock.json`) writes,
 * and restores all go through it. The only difference from upstream is where
 * project skills live: one copy per (source, skill) in
 * `$XDG_DATA_HOME/blackbook/skills`, symlinked into each project.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDataDir } from "./config/path.js";
import { getToolInstances } from "./config.js";
import { loadConfig } from "./config/loader.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Central store root handed to the vendored CLI. */
export function getSkillsStoreDir(): string {
  return join(getDataDir(), "skills");
}

/**
 * Entry point of the vendored CLI. Built package: `dist/lib` → `dist/vendor`.
 * Running from source (tsx/vitest): the built bundle if present, else the
 * vendored TypeScript directly (Node type-strips files outside node_modules).
 */
export function getSkillsCliEntry(): string {
  const candidates = [
    join(here, "..", "vendor", "skills", "bin", "cli.mjs"),
    join(here, "..", "..", "dist", "vendor", "skills", "bin", "cli.mjs"),
    join(here, "..", "..", "vendor", "skills", "src", "cli.ts"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Vendored skills CLI not found (run `pnpm build`)");
  return found;
}

/** Env the vendored CLI needs: the store root and any configured dev shortcuts. */
export function skillsCliEnv(): Record<string, string> {
  const env: Record<string, string> = { SKILLS_STORE_DIR: getSkillsStoreDir() };
  try {
    const shortcuts = loadConfig().config.settings.dev_shortcuts;
    if (shortcuts && Object.keys(shortcuts).length > 0) env.SKILLS_DEV_SHORTCUTS = JSON.stringify(shortcuts);
  } catch {
    // Config unreadable: run without shortcuts rather than failing the command.
  }
  return env;
}

export interface SkillsCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `skills <args>` in `cwd`. `inherit` streams to the terminal (headless
 * `blackbook skills …`); otherwise output is captured (TUI actions).
 */
export function runSkillsCli(
  args: string[],
  options: { cwd?: string; inherit?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<SkillsCliResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [getSkillsCliEntry(), ...args], {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...skillsCliEnv(), ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", (error) => resolvePromise({ code: 1, stdout, stderr: stderr + error.message }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

/** Blackbook tool id → skills CLI agent id, for the tools that take skills. */
const TOOL_TO_AGENT: Record<string, string> = {
  "claude-code": "claude-code",
  "openai-codex": "codex",
  opencode: "opencode",
  "amp-code": "amp",
  pi: "pi",
};

/** CLI agent ids for Blackbook's enabled tools (deduped, stable order). */
export function enabledSkillAgents(): string[] {
  const agents = new Set<string>();
  for (const inst of getToolInstances()) {
    const agent = TOOL_TO_AGENT[inst.toolId];
    if (inst.enabled && agent) agents.add(agent);
  }
  return [...agents];
}

/** Last meaningful line of CLI output, stripped of ANSI/box drawing, for notifications. */
export function summarizeCliFailure(result: SkillsCliResult): string {
  const text = `${result.stderr}\n${result.stdout}`
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s│◇◆●■└┌├─╮╯╭╰]+/, "").replace(/[\s│]+$/, "").trim())
    .filter(Boolean);
  const error = text.reverse().find((l) => /error|fail|not found|invalid|✗/i.test(l));
  return error ?? text[0] ?? `skills CLI exited with code ${result.code}`;
}
