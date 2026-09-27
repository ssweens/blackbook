/**
 * Every vitest worker runs with a throwaway HOME and XDG dirs, so no test can
 * read or write the developer's real ~/.claude, ~/.agents, ~/.config, or
 * ~/.cache — even when a test forgets to isolate itself or one test file leaks
 * an env change into the next. Tests that need a specific HOME still set their
 * own; this only replaces the default.
 */
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "bb-test-home-"));
const home = join(root, "home");
mkdirSync(home, { recursive: true });
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.XDG_DATA_HOME = join(home, ".local", "share");
delete process.env.XDG_STATE_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
delete process.env.SKILLS_DEV_SHORTCUTS;
delete process.env.SKILLS_STORE_DIR;
