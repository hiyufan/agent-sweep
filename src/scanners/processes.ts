import { execFileSync } from "node:child_process";
import type { Item, ScanOptions } from "../types.js";
import { t } from "../i18n.js";

export interface Proc {
  pid: number;
  ppid: number;
  uid: number;
  rssKb: number;
  elapsedSec: number;
  args: string;
}

/** Agent hosts that legitimately own MCP servers while they run. */
const HOST =
  /(^|\/)(claude|codex|gemini|cursor|windsurf|opencode|goose|aider|code)(\s|$)|@anthropic-ai\/claude-code|@openai\/codex|@google\/gemini-cli|Cursor( Helper)?|Code Helper|Visual Studio Code|Windsurf/i;

const MCP = /mcp|@modelcontextprotocol|claude-mem/i;

/** `[[dd-]hh:]mm:ss` as printed by `ps -o etime`. */
export function parseEtime(s: string): number {
  const [d, rest] = s.includes("-") ? s.split("-") : ["0", s];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts;
  return Number(d) * 86400 + h * 3600 + m * 60 + sec;
}

export function parsePs(text: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    procs.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      uid: Number(m[3]),
      rssKb: Number(m[4]),
      elapsedSec: parseEtime(m[5]),
      args: m[6],
    });
  }
  return procs;
}

/** MCP server processes owned by `uid` with no agent host anywhere above them. */
export function findOrphans(procs: Proc[], uid: number, selfPid: number): Proc[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const hasHostAncestor = (p: Proc): boolean => {
    const seen = new Set<number>();
    let cur = byPid.get(p.ppid);
    while (cur && cur.pid > 1 && !seen.has(cur.pid)) {
      if (HOST.test(cur.args)) return true;
      seen.add(cur.pid);
      cur = byPid.get(cur.ppid);
    }
    return false;
  };
  const orphans = procs.filter(
    (p) => p.uid === uid && p.pid !== selfPid && MCP.test(p.args) && !HOST.test(p.args) && !hasHostAncestor(p),
  );
  // Report only the top of each orphaned tree; killing it is enough to see the rest go.
  const ids = new Set(orphans.map((p) => p.pid));
  return orphans.filter((p) => !ids.has(p.ppid));
}

/** A readable name for an MCP server from its command line, e.g. "server-github" or "@playwright/mcp". */
export function mcpName(args: string): string {
  const pkg = args.match(/(@[\w.-]+\/[\w.-]*mcp[\w.-]*|@modelcontextprotocol\/[\w.-]+|[\w.-]*mcp[\w.-]*)/i);
  if (pkg) return pkg[1];
  const script = args.split(/\s+/).find((t) => /\.(c|m)?js$|\.py$/.test(t));
  return script ? script.split(/[\\/]/).pop()! : args.split(/\s+/)[0];
}

export function scanProcesses(o: ScanOptions): Item[] {
  if (process.platform === "win32" || typeof process.getuid !== "function") return [];
  let out: string;
  try {
    // -ww: never cut command lines to the terminal width ($COLUMNS), or long npx paths lose their "mcp".
    out = execFileSync("ps", ["-ww", "-A", "-o", "pid=,ppid=,uid=,rss=,etime=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return findOrphans(parsePs(out), process.getuid(), process.pid).map((p) => ({
    id: `process:${p.pid}`,
    category: "process" as const,
    tool: "mcp",
    title: t.orphanedProcess(mcpName(p.args), p.pid),
    detail: p.args.length > 120 ? p.args.slice(0, 117) + "..." : p.args,
    bytes: p.rssKb * 1024,
    mtime: o.now - p.elapsedSec * 1000,
    action: { kind: "kill" as const, pid: p.pid },
  }));
}
