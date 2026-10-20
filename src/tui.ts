import { emitKeypressEvents } from "node:readline";
import { run, type RunOptions } from "./actions.js";
import { formatAge, formatBytes } from "./fsutil.js";
import type { Item } from "./types.js";

const ESC = "\x1b[";
const c = {
  dim: (s: string) => `${ESC}2m${s}${ESC}0m`,
  bold: (s: string) => `${ESC}1m${s}${ESC}0m`,
  inv: (s: string) => `${ESC}7m${s}${ESC}0m`,
  green: (s: string) => `${ESC}32m${s}${ESC}0m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}0m`,
  red: (s: string) => `${ESC}31m${s}${ESC}0m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}0m`,
};

const TAG: Record<Item["category"], string> = { cache: "cache", worktree: "worktree", process: "process" };

type Status = { ok: boolean; message: string };

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export async function interactive(items: Item[], o: RunOptions & { now: number }): Promise<void> {
  const out = process.stdout;
  const selected = new Set<number>();
  const done = new Map<number, Status>();
  let cursor = 0;
  let top = 0;
  let confirming = false;
  let busy = false;
  let note = "";

  const total = items.reduce((n, it) => n + (it.category === "process" ? 0 : it.bytes), 0);

  const render = () => {
    const rows = out.rows || 24;
    const cols = out.columns || 80;
    const listHeight = Math.max(3, rows - 8);
    if (cursor < top) top = cursor;
    if (cursor >= top + listHeight) top = cursor - listHeight + 1;

    const selBytes = [...selected].reduce((n, i) => n + (items[i].category === "process" ? 0 : items[i].bytes), 0);
    const mode = o.apply ? c.red(" APPLY ") : c.yellow(" DRY-RUN ");
    let s = `${ESC}H${ESC}2J`;
    s += `${c.bold("agent-sweep")} ${mode} ${items.length} items · ${c.green(formatBytes(total))} reclaimable · ${selected.size} selected (${formatBytes(selBytes)})\n`;
    s += c.dim(o.apply ? "Selected items will really be deleted after you confirm.\n" : "Nothing will be deleted. Re-run with --apply to clean for real.\n");
    s += c.dim(`${pad("", 4)}${pad("SIZE", 9)}${pad("AGE", 6)}${pad("KIND", 10)}WHAT`) + "\n";

    for (let i = top; i < Math.min(items.length, top + listHeight); i++) {
      const it = items[i];
      const st = done.get(i);
      const box = st ? (st.ok ? (o.apply ? c.green(" ✓ ") : c.yellow(" ~ ")) : c.red(" ✗ ")) : selected.has(i) ? c.cyan("[x]") : "[ ]";
      const size = it.category === "process" ? `${formatBytes(it.bytes)}*` : formatBytes(it.bytes);
      let line = `${pad(size, 9)}${pad(formatAge(it.mtime, o.now), 6)}${pad(TAG[it.category], 10)}${it.tool}: ${it.title}`;
      line = pad(line, Math.max(10, cols - 5));
      s += `${box} ${i === cursor ? c.inv(line) : st ? c.dim(line) : line}\n`;
    }
    for (let i = Math.min(items.length, top + listHeight); i < top + listHeight; i++) s += "\n";

    const cur = items[cursor];
    const st = done.get(cursor);
    s += c.dim("─".repeat(Math.min(cols, 80))) + "\n";
    s += cur ? `${cur.detail}\n${st ? (st.ok ? c.green(st.message) : c.red(st.message)) : ""}\n` : "\n\n";
    if (confirming) {
      const verb = o.apply ? c.red("Really clean") : "Simulate cleaning";
      s += c.bold(`${verb} ${selected.size} item(s)? [y/N] `);
    } else {
      s += note || c.dim("↑/↓ move  space select  a all  enter clean  q quit   (* = memory)");
    }
    out.write(s);
  };

  const cleanup = () => {
    out.write(`${ESC}?25h${ESC}?1049l`);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  out.write(`${ESC}?1049h${ESC}?25l`);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  out.on("resize", render);
  render();

  await new Promise<void>((resolveDone) => {
    const quit = () => {
      process.stdin.off("keypress", onKey);
      out.off("resize", render);
      cleanup();
      resolveDone();
    };

    const execute = async () => {
      busy = true;
      const picks = [...selected].sort((a, b) => a - b);
      let freed = 0;
      for (const i of picks) {
        note = c.dim(`working on ${items[i].title}...`);
        render();
        const r = await run(items[i], o);
        done.set(i, r);
        selected.delete(i);
        if (r.ok && items[i].category !== "process") freed += items[i].bytes;
      }
      note = o.apply ? c.green(`Freed ${formatBytes(freed)}.`) : c.yellow(`Dry-run: would free ${formatBytes(freed)}. Re-run with --apply to do it.`);
      busy = false;
      render();
    };

    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key?.ctrl && key.name === "c") return quit();
      if (busy) return;
      if (confirming) {
        confirming = false;
        if (str === "y" || str === "Y") void execute();
        else {
          note = c.dim("Cancelled.");
          render();
        }
        return;
      }
      note = "";
      switch (key?.name ?? str) {
        case "q":
        case "escape":
          return quit();
        case "up":
        case "k":
          cursor = Math.max(0, cursor - 1);
          break;
        case "down":
        case "j":
          cursor = Math.min(items.length - 1, cursor + 1);
          break;
        case "pageup":
          cursor = Math.max(0, cursor - 10);
          break;
        case "pagedown":
          cursor = Math.min(items.length - 1, cursor + 10);
          break;
        case "space":
          if (!done.has(cursor)) selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor);
          cursor = Math.min(items.length - 1, cursor + 1);
          break;
        case "a": {
          const open = items.map((_, i) => i).filter((i) => !done.has(i));
          if (open.every((i) => selected.has(i))) selected.clear();
          else open.forEach((i) => selected.add(i));
          break;
        }
        case "return":
        case "enter":
        case "d":
          if (selected.size === 0) note = c.dim("Select something with space first.");
          else confirming = true;
          break;
      }
      render();
    };
    process.stdin.on("keypress", onKey);
  });
}
