export type Lang = "en" | "zh";

let current: Lang | undefined;

/** Chinese when the user asked for it or the system locale is Chinese, English otherwise. */
export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const explicit = env.AGENT_SWEEP_LANG;
  if (explicit) return explicit.toLowerCase().startsWith("zh") ? "zh" : "en";
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE;
  // "C" / "POSIX" mean no preference; fall through to the OS locale (macOS and Windows rarely set LANG for GUI terminals).
  const locale = posix && !/^(C|POSIX)([.@]|$)/i.test(posix) ? posix : Intl.DateTimeFormat().resolvedOptions().locale;
  return /^zh/i.test(locale) ? "zh" : "en";
}

export function setLang(lang: Lang | undefined) {
  current = lang;
}

export function lang(): Lang {
  return (current ??= detectLang());
}

const zh = () => lang() === "zh";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every string a person reads. Paths, commands and tool names stay as they are. */
export const t = {
  // scanners
  orphanedProject: (name: string) => (zh() ? `孤儿项目 ${name}` : `orphaned project ${name}`),
  orphanedProjectDetail: () => (zh() ? "项目文件夹已不存在，将删除它的全部会话" : "project folder no longer exists; all its sessions"),
  staleSessions: (name: string) => (zh() ? `过期会话：${name}` : `stale sessions in ${name}`),
  staleSessionsDetail: (n: number, days: number) =>
    zh() ? `${n} 个会话闲置超过 ${days} 天` : `${plural(n, "session")} idle > ${days}d`,
  idleIn: (where: string, days: number) => (zh() ? `${where}，闲置超过 ${days} 天` : `${where}, idle > ${days}d`),
  idle: (days: number) => (zh() ? `闲置超过 ${days} 天` : `idle > ${days}d`),
  claudeDir: (key: string) =>
    (zh()
      ? {
          debug: "调试日志",
          "file-history": "文件编辑历史",
          "shell-snapshots": "shell 快照",
          todos: "待办列表",
          "paste-cache": "粘贴缓存",
          "session-env": "会话环境",
          telemetry: "遥测数据",
          statsig: "statsig 缓存",
        }
      : {
          debug: "debug logs",
          "file-history": "file edit history",
          "shell-snapshots": "shell snapshots",
          todos: "todo lists",
          "paste-cache": "paste cache",
          "session-env": "session env",
          telemetry: "telemetry",
          statsig: "statsig cache",
        })[key] ?? key,
  sessionRollouts: () => (zh() ? "会话记录" : "session rollouts"),
  archivedSessions: () => (zh() ? "已归档会话" : "archived sessions"),
  logs: () => (zh() ? "日志" : "logs"),
  geminiTmp: () => (zh() ? "项目临时文件和聊天记录" : "project temp & chats"),
  npxTitle: () => (zh() ? "npx 缓存的 MCP 服务器和一次性 CLI" : "cached MCP servers & one-off CLIs"),
  npxDetail: (n: number, days: number) =>
    zh()
      ? `${n} 个 npx 安装超过 ${days} 天未使用，需要时 npx 会重新下载`
      : `${plural(n, "npx install")} unused > ${days}d; npx re-downloads on demand`,
  workspaces: (n: number) => (zh() ? `${n} 个已删除工作区的存储` : `storage of ${plural(n, "deleted workspace")}`),
  workspacesDetail: (dir: string) =>
    zh() ? `${dir}：已不存在的文件夹留下的聊天、索引和状态` : `${dir}: chats, indexes and state for folders that no longer exist`,
  orphanedWorktree: (name: string) => (zh() ? `孤儿 worktree ${name}` : `orphaned worktree ${name}`),
  orphanedWorktreeDetail: (path: string) => (zh() ? `${path}（所属仓库已不存在）` : `${path} (its repository is gone)`),
  staleWorktree: (name: string) => (zh() ? `闲置 worktree ${name}` : `stale worktree ${name}`),
  staleWorktreeDetail: (path: string, days: number) =>
    zh() ? `${path}，无未提交改动，闲置超过 ${days} 天（保留分支）` : `${path}, clean, idle > ${days}d (branch is kept)`,
  danglingRecords: (n: number, repo: string) =>
    zh() ? `${repo} 中 ${n} 条悬空的 worktree 记录` : `${plural(n, "dangling worktree record")} in ${repo}`,
  pruneIn: (top: string) => (zh() ? `在 ${top} 执行 git worktree prune` : `git worktree prune in ${top}`),
  orphanedProcess: (name: string, pid: number) => (zh() ? `孤儿进程 ${name}（pid ${pid}）` : `orphaned ${name} (pid ${pid})`),

  // actions
  deleteOne: (p: string) => (zh() ? `删除 ${p}` : `delete ${p}`),
  deleteMany: (n: number) => (zh() ? `删除 ${n} 项` : `delete ${n} entries`),
  kill: (pid: number) => (zh() ? `结束进程 ${pid}` : `kill ${pid}`),
  refused: (p: string) => (zh() ? `已拒绝：${p} 不在 Agent 目录内` : `refused: ${p} is outside the agent folders`),
  wouldDo: (what: string) => (zh() ? `[演练] 将会${what}` : `[dry-run] would ${what}`),
  failed: (what: string, why: string) => (zh() ? `${what} 失败：${why}` : `${what} failed: ${why}`),

  // tui
  kind: (k: "cache" | "worktree" | "process") =>
    (zh() ? { cache: "缓存", worktree: "worktree", process: "进程" } : { cache: "cache", worktree: "worktree", process: "process" })[k],
  sortName: (k: "kind" | "size" | "age") =>
    (zh() ? { kind: "类型", size: "大小", age: "时间" } : { kind: "kind", size: "size", age: "age" })[k],
  modeApply: () => (zh() ? " 执行模式 " : " APPLY "),
  modeDry: () => (zh() ? " 演练模式 " : " DRY-RUN "),
  header: (items: number, total: string, selected: number, selBytes: string) =>
    zh()
      ? [`${items} 项`, `可释放 ${total}`, `已选 ${selected} 项（${selBytes}）`]
      : [plural(items, "item"), `${total} reclaimable`, `${selected} selected (${selBytes})`],
  applyHint: () => (zh() ? "确认后，选中的项目会被真正删除。" : "Selected items will really be deleted after you confirm."),
  dryHint: () =>
    zh() ? "不会删除任何东西。加上 --apply 重新运行才会真正清理。" : "Nothing will be deleted. Re-run with --apply to clean for real.",
  columns: () => (zh() ? ["大小", "时间", "类型", "内容"] : ["SIZE", "AGE", "KIND", "WHAT"]),
  sortLabel: (k: string) => (zh() ? `排序：${k}` : `sort: ${k}`),
  confirmApply: (n: number) => (zh() ? `确定清理这 ${n} 项吗？[y/N] ` : `Really clean ${n} item(s)? [y/N] `),
  confirmDry: (n: number) => (zh() ? `模拟清理这 ${n} 项吗？[y/N] ` : `Simulate cleaning ${n} item(s)? [y/N] `),
  keys: () =>
    zh()
      ? "↑/↓ 移动  空格 勾选  a 全选  s 排序  回车 清理  q 退出   (* = 内存)"
      : "↑/↓ move  space select  a all  s sort  enter clean  q quit   (* = memory)",
  working: (title: string) => (zh() ? `正在处理 ${title}...` : `working on ${title}...`),
  freed: (b: string) => (zh() ? `已释放 ${b}。` : `Freed ${b}.`),
  wouldFree: (b: string) =>
    zh() ? `演练：将会释放 ${b}。加上 --apply 重新运行即可真正清理。` : `Dry-run: would free ${b}. Re-run with --apply to do it.`,
  cancelled: () => (zh() ? "已取消。" : "Cancelled."),
  selectFirst: () => (zh() ? "请先用空格勾选要清理的项目。" : "Select something with space first."),

  // cli
  scanning: () => (zh() ? "正在扫描..." : "Scanning..."),
  tidy: () => (zh() ? "没有需要清理的东西，你的 Agent 很干净。" : "Nothing to sweep. Your agents are tidy."),
  listTotal: (n: number, b: string) =>
    zh() ? `\n共 ${n} 项，磁盘可释放 ${b}（* 表示进程内存）。` : `\n${plural(n, "item")}, ${b} reclaimable on disk (* = process memory).`,
  summaryApply: (n: number, b: string, failed: number) =>
    zh()
      ? `agent-sweep 清理了 ${n} 项，释放了 ${b}${failed ? `，${failed} 项失败` : ""}。`
      : `agent-sweep cleaned ${n} item(s) and freed ${b}${failed ? `, ${failed} failed` : ""}.`,
  summaryDry: (n: number, b: string, failed: number) =>
    zh()
      ? `演练：${n} 项，将会释放 ${b}${failed ? `，${failed} 项失败` : ""}。加上 --apply 重新运行即可真正清理。`
      : `Dry-run: ${n} item(s), ${b} would be freed${failed ? `, ${failed} failed` : ""}. Run again with --apply to clean for real.`,
  help: () =>
    zh()
      ? `agent-sweep：清理 AI 编程 Agent 留下的垃圾

用法：npx agent-sweeper [选项]

扫描 Claude Code / Codex / Gemini CLI / opencode 的过期会话和缓存、
Cursor / Windsurf / VS Code 中已删除项目的存储、遗忘的 npx 安装、
孤儿 git worktree，以及宿主 Agent 已退出的 MCP 服务器进程。
打开交互列表；不加 --apply 并确认，就不会删除任何东西。

选项：
  --days <n>       闲置 n 天算过期（默认 14）
  --only <kinds>   逗号分隔：cache、worktree、process
  --apply          真正删除 / 结束进程（仍需确认）
  --list           打印结果后退出（不会删除）
  --json           以 JSON 输出后退出（不会删除）
  --lang <en|zh>   界面语言（默认跟随系统）
  -h, --help       显示帮助
  -v, --version    显示版本
`
      : `agent-sweep: clean up after your AI coding agents

Usage: npx agent-sweeper [options]

Finds stale Claude Code / Codex / Gemini CLI / opencode sessions and caches,
Cursor / Windsurf / VS Code storage for deleted projects, forgotten npx
installs, orphaned git worktrees, and MCP server processes whose agent is
gone. Opens an interactive list; nothing is deleted without --apply and a
confirmation.

Options:
  --days <n>       Treat things idle for n days as stale (default 14)
  --only <kinds>   Comma list of: cache, worktree, process
  --apply          Actually delete / kill (still asks to confirm)
  --list           Print the findings and exit (never deletes)
  --json           Print the findings as JSON and exit (never deletes)
  --lang <en|zh>   Interface language (default: follows your system)
  -h, --help       Show this help
  -v, --version    Show version
`,
};

/** Terminal columns a string occupies: CJK and full-width characters take two. */
export function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    w +=
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

/** Pad or cut `s` to exactly `n` terminal columns. */
export function fit(s: string, n: number): string {
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = width(ch);
    if (w + cw > n) break;
    out += ch;
    w += cw;
  }
  return out + " ".repeat(n - w);
}

/** Cut `s` to at most `n` columns, marking the cut with an ellipsis. */
export function clip(s: string, n: number): string {
  return width(s) <= n ? s : fit(s, n - 1).trimEnd() + "…";
}
