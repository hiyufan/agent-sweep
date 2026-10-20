# agent-sweep

**AI 编程 Agent 界的 npkill。** 一条命令扫出 Claude Code、Codex、Gemini CLI 留下的垃圾，在交互列表里勾选清理：

- `~/.claude`、`~/.codex`、`~/.gemini` 下的过期会话记录和缓存
- 原项目文件夹已被删除的 Claude 项目缓存
- 孤儿 / 闲置的 git worktree，以及悬空的 worktree 记录
- 宿主 Agent 已退出、却还在后台吃内存的 MCP stdio 子进程

```sh
npx agent-sweep            # 只看不删（默认 dry-run）
npx agent-sweep --apply    # 真正清理，执行前仍需确认
```

安全设计：默认 dry-run；只在各 Agent 自己的目录里删除；不碰设置、CLAUDE.md、凭证、skills 和项目记忆；最近 1 小时内用过的东西一律跳过；worktree 用 `git worktree remove` 删除且保留分支；进程先 SIGTERM 再 SIGKILL。

参数：`--days <n>`（默认 14 天）、`--only cache,worktree,process`、`--apply`、`--list`、`--json`。
