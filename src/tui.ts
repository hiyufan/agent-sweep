import { emitKeypressEvents } from "node:readline";
import { run, type RunOptions } from "./actions.js";
import { formatAge, formatBytes } from "./fsutil.js";
import type { Item } from "./types.js";
import { clip, fit, t } from "./i18n.js";

const ESC = "\x1b[";
// Reverse video stays on under NO_COLOR: without it you cannot see the cursor.
const paint = (code: string, always = false) => (s: string) =>
  process.env.NO_COLOR && !always ? s : `${ESC}${code}m${s}${ESC}0m`;
const c = {
  dim: paint("2"),
  bold: paint("1"),
  inv: paint("7", true),
  green: paint("32"),
  yellow: paint("33"),
  red: paint("31"),
  cyan: paint("36"),
};

export interface Summary {
  done: number;
  failed: number;
  bytes: number;
}

type SortKey = "kind" | "size" | "age";
const SORTS: SortKey[] = ["kind", "size", "age"];
const KIND_ORDER: Item["category"][] = ["process", "worktree", "cache"];

function sortItems(items: Item[], key: SortKey): Item[] {
  const by: Record<SortKey, (a: Item, b: Item) => number> = {
    kind: (a, b) => KIND_ORDER.indexOf(a.category) - KIND_ORDER.indexOf(b.category) || b.bytes - a.bytes,
    size: (a, b) => b.bytes - a.bytes,
    age: (a, b) => (a.mtime || Infinity) - (b.mtime || Infinity),
  };
  return [...items].sort(by[key]);
}


type Status = { ok: boolean; message: string };


export async function interactive(input: Item[], o: RunOptions & { now: number }): Promise<Summary> {
  const out = process.stdout;
  let sortKey: SortKey = "kind";
  let items = sortItems(input, sortKey);
  // Keyed by item so selections survive re-sorting.
  const selected = new Set<Item>();
  const done = new Map<Item, Status>();
  const summary: Summary = { done: 0, failed: 0, bytes: 0 };
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

    const selBytes = [...selected].reduce((n, it) => n + (it.category === "process" ? 0 : it.bytes), 0);
    const mode = o.apply ? c.red(t.modeApply()) : c.yellow(t.modeDry());
    const [hItems, hTotal, hSel] = t.header(items.length, formatBytes(total), selected.size, formatBytes(selBytes));
    const [cSize, cAge, cKind, cWhat] = t.columns();
    let s = `${ESC}H${ESC}2J`;
    s += `${c.bold("agent-sweep")} ${mode} ${hItems} · ${c.green(hTotal)} · ${hSel}\n`;
    s += c.dim((o.apply ? t.applyHint() : t.dryHint()) + "\n");
    const heading = `${fit("", 4)}${fit(cSize, 9)}${fit(cAge, 6)}${fit(cKind, 10)}${cWhat}`;
    s += c.dim(fit(heading, Math.min(cols, 80) - 14) + t.sortLabel(t.sortName(sortKey))) + "\n";

    for (let i = top; i < Math.min(items.length, top + listHeight); i++) {
      const it = items[i];
      const st = done.get(it);
      const box = st ? (st.ok ? (o.apply ? c.green(" ✓ ") : c.yellow(" ~ ")) : c.red(" ✗ ")) : selected.has(it) ? c.cyan("[x]") : "[ ]";
      const size = it.category === "process" ? `${formatBytes(it.bytes)}*` : formatBytes(it.bytes);
      let line = `${fit(size, 9)}${fit(formatAge(it.mtime, o.now), 6)}${fit(t.kind(it.category), 10)}${it.tool}: ${it.title}`;
      line = fit(line, Math.max(10, cols - 5));
      s += `${box} ${i === cursor ? c.inv(line) : st ? c.dim(line) : line}\n`;
    }
    for (let i = Math.min(items.length, top + listHeight); i < top + listHeight; i++) s += "\n";

    const cur = items[cursor];
    const st = cur && done.get(cur);
    s += c.dim("─".repeat(Math.min(cols, 80))) + "\n";
    const msg = st ? clip(st.message, cols - 1) : "";
    s += cur ? `${clip(cur.detail, cols - 1)}\n${st ? (st.ok ? c.green(msg) : c.red(msg)) : ""}\n` : "\n\n";
    if (confirming) {
      s += o.apply ? c.bold(c.red(t.confirmApply(selected.size))) : c.bold(t.confirmDry(selected.size));
    } else {
      s += note || c.dim(t.keys());
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
      const picks = items.filter((it) => selected.has(it));
      let freed = 0;
      for (const it of picks) {
        note = c.dim(t.working(it.title));
        render();
        const r = await run(it, o);
        done.set(it, r);
        selected.delete(it);
        if (r.ok) summary.done++;
        else summary.failed++;
        if (r.ok && it.category !== "process") freed += it.bytes;
      }
      summary.bytes += freed;
      note = o.apply ? c.green(t.freed(formatBytes(freed))) : c.yellow(t.wouldFree(formatBytes(freed)));
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
          note = c.dim(t.cancelled());
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
        case "space": {
          const it = items[cursor];
          if (!done.has(it)) selected.has(it) ? selected.delete(it) : selected.add(it);
          cursor = Math.min(items.length - 1, cursor + 1);
          break;
        }
        case "a": {
          const open = items.filter((it) => !done.has(it));
          if (open.every((it) => selected.has(it))) selected.clear();
          else open.forEach((it) => selected.add(it));
          break;
        }
        case "s": {
          const at = items[cursor];
          sortKey = SORTS[(SORTS.indexOf(sortKey) + 1) % SORTS.length];
          items = sortItems(items, sortKey);
          cursor = items.indexOf(at);
          break;
        }
        case "return":
        case "enter":
        case "d":
          if (selected.size === 0) note = c.dim(t.selectFirst());
          else confirming = true;
          break;
      }
      render();
    };
    process.stdin.on("keypress", onKey);
  });
  return summary;
}
