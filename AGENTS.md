# Repository Guidelines

## Project Structure & Module Organization
- `blackbook`: Bash CLI entrypoint that routes commands.
- `deploy.py` and `status.py`: Python scripts that create and verify symlinks.
- `tools.toml`: Source of truth for tool metadata and file mappings.
- `tui/`: Plugin manager TUI (Ink/React) for installing plugins from marketplaces.
- `memory_files/`: Archived or historical docs.

## Build, Test, and Development Commands
- `./blackbook deploy [--tool TOOL] [--force]`: Create or refresh symlinks into tool config directories.
- `./blackbook status`: Validate symlinks and report drift.
- `./blackbook list-tools`: List configured tools (requires `yq` or Python 3.11+ for `tomllib`).
- `BLACKBOOK_ROOT=/path ./blackbook status`: Point the CLI at a different repo root for local checks.

## Coding Style & Naming Conventions
- Python uses standard library only, type hints, `pathlib`, and `logging` (no `print`).
- Use snake_case for Python functions and variables.
- Tool IDs in `tools.toml` are kebab-case (e.g., `openai-codex`).
- Keep TOML keys consistent: `name`, `status`, `config_dir`, and `files` with `src`/`dest`.

## Testing Guidelines
- No automated test suite is defined.
- Validate changes by running `./blackbook deploy` and `./blackbook status`, and confirm the target config directories contain correct symlinks.

## Commit & Pull Request Guidelines
- Use Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
- PRs should include a clear summary, list affected tools/paths, and note validation performed (e.g., `./blackbook status`).
- If you change deployment behavior or config mappings, update `README.md` and any affected skill docs.

## Configuration & Deployment Notes
- `tools.toml` is the authoritative mapping for what gets deployed.
- Avoid storing secrets in this repo; deploy only files intended to be symlinked into user config directories.
