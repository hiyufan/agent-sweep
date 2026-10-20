#!/usr/bin/env node
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { cacheRoots, scanCaches } from "./scanners/caches.js";
import { scanEditors, workspaceStorageDirs } from "./scanners/editors.js";
import { scanProcesses } from "./scanners/processes.js";
import { scanWorktrees, worktreeRoots } from "./scanners/worktrees.js";
import { describe } from "./actions.js";
import { formatAge, formatBytes } from "./fsutil.js";
import { interactive } from "./tui.js";
import type { Category, Item, ScanOptions } from "./types.js";

const HELP = `agent-sweep: clean up after your AI coding agents

Usage: npx agent-sweep [options]

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
  -h, --help       Show this help
  -v, --version    Show version
`;

interface Args {
  days: number;
  only: Set<Category>;
  apply: boolean;
  list: boolean;
  json: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { days: 14, only: new Set(["cache", "worktree", "process"]), apply: false, list: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--days": {
        const n = Number(val());
        if (!Number.isFinite(n) || n < 0) throw new Error("--days must be a non-negative number");
        a.days = n;
        break;
      }
      case "--only": {
        const kinds = val().split(",").map((s) => s.trim()) as Category[];
        for (const k of kinds) if (!["cache", "worktree", "process"].includes(k)) throw new Error(`unknown kind: ${k}`);
        a.only = new Set(kinds);
        break;
      }
      case "--apply":
        a.apply = true;
        break;
      case "--list":
        a.list = true;
        break;
      case "--json":
        a.json = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(HELP);
        process.exit(0);
      case "-v":
      case "--version": {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        process.stdout.write(`${pkg.version}\n`);
        process.exit(0);
      }
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return a;
}

export function scanAll(o: ScanOptions, only: Set<Category>): Item[] {
  const items: Item[] = [];
  if (only.has("cache")) items.push(...scanCaches(o), ...scanEditors(o));
  if (only.has("worktree")) items.push(...scanWorktrees(o));
  if (only.has("process")) items.push(...scanProcesses(o));
  const order: Category[] = ["process", "worktree", "cache"];
  return items.sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category) || y.bytes - x.bytes);
}

export function allowedRoots(o: ScanOptions): string[] {
  return [...cacheRoots(o), ...workspaceStorageDirs(o), ...worktreeRoots(o)];
}

function printList(items: Item[], now: number) {
  if (items.length === 0) {
    console.log("Nothing to sweep. Your agents are tidy.");
    return;
  }
  const total = items.reduce((n, it) => n + (it.category === "process" ? 0 : it.bytes), 0);
  for (const it of items) {
    const size = it.category === "process" ? `${formatBytes(it.bytes)}*` : formatBytes(it.bytes);
    console.log(`${size.padEnd(9)}${formatAge(it.mtime, now).padEnd(6)}${it.category.padEnd(10)}${it.tool}: ${it.title}`);
    console.log(`${" ".repeat(25)}${describe(it.action)}`);
  }
  console.log(`\n${items.length} items, ${formatBytes(total)} reclaimable on disk (* = process memory).`);
}

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`agent-sweep: ${(e as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  const o: ScanOptions = {
    home: homedir(),
    days: args.days,
    cwd: process.cwd(),
    now: Date.now(),
    env: process.env,
    platform: process.platform,
  };
  const interactiveMode = !args.list && !args.json && process.stdin.isTTY && process.stdout.isTTY;
  if (interactiveMode) process.stderr.write("Scanning...\n");
  const items = scanAll(o, args.only);

  if (args.json) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }
  if (!interactiveMode) {
    printList(items, o.now);
    return;
  }
  if (items.length === 0) {
    console.log("Nothing to sweep. Your agents are tidy.");
    return;
  }
  const sum = await interactive(items, { apply: args.apply, roots: allowedRoots(o), now: o.now });
  if (sum.done + sum.failed === 0) return;
  const failed = sum.failed ? `, ${sum.failed} failed` : "";
  console.log(
    args.apply
      ? `agent-sweep cleaned ${sum.done} item(s) and freed ${formatBytes(sum.bytes)}${failed}.`
      : `Dry-run: ${sum.done} item(s), ${formatBytes(sum.bytes)} would be freed${failed}. Run again with --apply to clean for real.`,
  );
}

main().catch((e) => {
  process.stderr.write(`agent-sweep: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
