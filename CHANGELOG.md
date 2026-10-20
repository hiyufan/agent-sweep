# Changelog

## 0.2.0

- Cursor, Windsurf and VS Code: storage (chats, indexes, state DBs) for workspaces whose folder was deleted.
- npx cache: `~/.npm/_npx` installs unused for `--days`, where MCP servers started with `npx` pile up.
- opencode logs.
- Sort the list by kind, size or age with `s`.
- Summary of what was freed after you quit.
- `NO_COLOR` support.
- MCP processes are listed by server name, e.g. `@playwright/mcp`.
- Fix: long `npx` command lines were cut at the terminal width, hiding some MCP servers.
- CI on Linux, macOS and Windows with Node 18, 20 and 22.

## 0.1.0

- First release: Claude Code, Codex and Gemini CLI sessions and caches, orphaned and stale git worktrees, orphaned MCP server processes.
- Dry-run by default, `--apply` with confirmation, deletes only inside agent folders.
