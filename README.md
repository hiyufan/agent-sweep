# agent-sweep

**npkill for AI coding agents.** One command finds what Claude Code, Codex and Gemini CLI leave behind, and lets you clean it from an interactive list:

| What | Where |
| --- | --- |
| Stale session transcripts and caches | `~/.claude` (projects, debug, file-history, shell-snapshots, todos…), `~/.codex` (sessions, logs), `~/.gemini/tmp` |
| Projects whose folder no longer exists | `~/.claude/projects/*` (detected from the transcript's `cwd`) |
| Orphaned and stale git worktrees | `~/.claude-worktrees`, `~/.codex/worktrees`, `<repo>/.claude/worktrees`, dangling `git worktree` records |
| MCP server processes whose agent is gone | any process with no Claude / Codex / Gemini / Cursor / VS Code ancestor |

```sh
npx agent-sweep            # look around, nothing is deleted
npx agent-sweep --apply    # clean for real (asks to confirm first)
```

Keys: `↑/↓` move, `space` select, `a` select all, `enter` clean, `q` quit.

## Safe by default

- **Dry-run unless you pass `--apply`**, and even then every clean asks `[y/N]`.
- Only deletes inside the agents' own folders; any other path is refused.
- Never touches settings, `CLAUDE.md`, credentials, skills or per-project memory.
- Ignores anything used in the last hour, whatever `--days` says.
- Worktrees are removed with `git worktree remove` (no `--force`, branch kept) and only when they have no uncommitted changes.
- Processes get `SIGTERM` first, `SIGKILL` only if they ignore it for 3 s.

## Options

| Flag | Meaning |
| --- | --- |
| `--days <n>` | Idle days before something counts as stale (default 14) |
| `--only cache,worktree,process` | Limit what is scanned |
| `--apply` | Really delete / kill (still confirms) |
| `--list` | Print findings and exit |
| `--json` | Print findings as JSON and exit |

Respects `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. Requires Node 18+. Process scanning works on macOS and Linux.

## Develop

```sh
npm install
npm test
node dist/cli.js --list
```

MIT licensed. [中文说明](README.zh-CN.md)
