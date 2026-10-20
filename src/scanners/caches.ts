import { basename, join } from "node:path";
import { exists, head, isDir, list, usage } from "../fsutil.js";
import type { Item, ScanOptions } from "../types.js";

interface Group {
  paths: string[];
  bytes: number;
  /** Newest mtime among the collected entries. */
  mtime: number;
}

/** Direct children of `dir` whose whole subtree is older than `cutoff`. */
function staleChildren(dir: string, cutoff: number, filter: (p: string) => boolean = () => true): Group {
  const g: Group = { paths: [], bytes: 0, mtime: 0 };
  for (const p of list(dir)) {
    if (!filter(p)) continue;
    const u = usage(p);
    if (u.mtime >= cutoff) continue;
    g.paths.push(p);
    g.bytes += u.bytes;
    if (u.mtime > g.mtime) g.mtime = u.mtime;
  }
  return g;
}

/** Leaf directories `depth` levels below `dir` (e.g. Codex's sessions/YYYY/MM/DD) older than `cutoff`. */
function staleLeaves(dir: string, depth: number, cutoff: number): Group {
  if (depth === 0) return staleChildren(dir, cutoff);
  const g: Group = { paths: [], bytes: 0, mtime: 0 };
  for (const p of list(dir)) {
    if (!isDir(p)) continue;
    const sub = staleLeaves(p, depth - 1, cutoff);
    g.paths.push(...sub.paths);
    g.bytes += sub.bytes;
    if (sub.mtime > g.mtime) g.mtime = sub.mtime;
  }
  return g;
}

function push(items: Item[], tool: string, title: string, g: Group, detail: string) {
  if (g.paths.length === 0) return;
  items.push({
    id: `cache:${tool}:${title}`,
    category: "cache",
    tool,
    title,
    detail,
    bytes: g.bytes,
    mtime: g.mtime,
    action: { kind: "rm", paths: g.paths },
  });
}

/** The working directory a Claude Code project folder belongs to, read from its transcripts. */
export function claudeProjectCwd(projectDir: string): string | undefined {
  for (const f of list(projectDir)) {
    if (!f.endsWith(".jsonl")) continue;
    const m = head(f).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    }
  }
  return undefined;
}

function scanClaude(o: ScanOptions, cutoff: number, items: Item[]) {
  const root = o.env.CLAUDE_CONFIG_DIR || join(o.home, ".claude");
  if (!isDir(root)) return;

  for (const proj of list(join(root, "projects"))) {
    if (!isDir(proj)) continue;
    const cwd = claudeProjectCwd(proj);
    const name = cwd ? cwd : basename(proj);
    if (cwd && !exists(cwd)) {
      const u = usage(proj);
      if (u.mtime >= o.now - 3_600_000) continue;
      push(items, "claude", `orphaned project ${name}`, { paths: [proj], ...u }, "project folder no longer exists; all its sessions");
      continue;
    }
    // Session transcripts (<id>.jsonl) and their sidecar folders (<id>/) go together.
    // Leave Claude's per-project memory alone.
    const g = staleChildren(proj, cutoff, (p) => basename(p) !== "memory");
    const sessions = g.paths.filter((p) => p.endsWith(".jsonl")).length;
    push(items, "claude", `stale sessions in ${name}`, g, `${sessions} session(s) idle > ${o.days}d`);
  }

  const dirs: [string, string][] = [
    ["debug", "debug logs"],
    ["file-history", "file edit history"],
    ["shell-snapshots", "shell snapshots"],
    ["todos", "todo lists"],
    ["paste-cache", "paste cache"],
    ["session-env", "session env"],
    ["telemetry", "telemetry"],
    ["statsig", "statsig cache"],
  ];
  for (const [dir, label] of dirs) {
    push(items, "claude", label, staleChildren(join(root, dir), cutoff), `~/.claude/${dir}, idle > ${o.days}d`);
  }
}

function scanCodex(o: ScanOptions, cutoff: number, items: Item[]) {
  const root = o.env.CODEX_HOME || join(o.home, ".codex");
  if (!isDir(root)) return;
  push(items, "codex", "session rollouts", staleLeaves(join(root, "sessions"), 2, cutoff), `~/.codex/sessions, idle > ${o.days}d`);
  push(items, "codex", "archived sessions", staleChildren(join(root, "archived_sessions"), cutoff), `idle > ${o.days}d`);
  push(items, "codex", "logs", staleChildren(join(root, "log"), cutoff), `~/.codex/log, idle > ${o.days}d`);
}

function scanGemini(o: ScanOptions, cutoff: number, items: Item[]) {
  const root = join(o.home, ".gemini");
  if (!isDir(root)) return;
  push(items, "gemini", "project temp & chats", staleChildren(join(root, "tmp"), cutoff), `~/.gemini/tmp, idle > ${o.days}d`);
}

export function scanCaches(o: ScanOptions): Item[] {
  // Never touch anything used in the last hour, whatever --days says: it may be a live session.
  const cutoff = Math.min(o.now - o.days * 86_400_000, o.now - 3_600_000);
  const items: Item[] = [];
  scanClaude(o, cutoff, items);
  scanCodex(o, cutoff, items);
  scanGemini(o, cutoff, items);
  return items;
}

/** Roots that `rm` actions are allowed to touch. Anything else is refused at delete time. */
export function cacheRoots(o: Pick<ScanOptions, "home" | "env">): string[] {
  return [
    o.env.CLAUDE_CONFIG_DIR || join(o.home, ".claude"),
    o.env.CODEX_HOME || join(o.home, ".codex"),
    join(o.home, ".gemini"),
  ];
}
