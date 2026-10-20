import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";
import type { Action, Item } from "./types.js";
import { t } from "./i18n.js";

export interface RunOptions {
  /** Without this, nothing is touched and the result only says what would happen. */
  apply: boolean;
  /** Folders `rm` may delete inside. A path outside all of them is refused. */
  roots: string[];
}

export interface Result {
  item: Item;
  ok: boolean;
  message: string;
}

/** Strictly inside `root` (never the root itself). */
export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function describe(a: Action): string {
  switch (a.kind) {
    case "rm":
      return a.paths.length === 1 ? t.deleteOne(a.paths[0]) : t.deleteMany(a.paths.length);
    case "git-worktree-remove":
      return `git -C ${a.repo} worktree remove ${a.path}`;
    case "git-worktree-prune":
      return `git -C ${a.repo} worktree prune`;
    case "kill":
      return t.kill(a.pid);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function kill(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) process.kill(pid, "SIGKILL");
}

export async function run(item: Item, o: RunOptions): Promise<Result> {
  const a = item.action;
  if (a.kind === "rm") {
    const bad = a.paths.find((p) => !o.roots.some((r) => inside(r, p)));
    if (bad) return { item, ok: false, message: t.refused(bad) };
  }
  if (!o.apply) return { item, ok: true, message: t.wouldDo(describe(a)) };
  try {
    switch (a.kind) {
      case "rm":
        for (const p of a.paths) rmSync(p, { recursive: true, force: true });
        break;
      case "git-worktree-remove":
        execFileSync("git", ["-C", a.repo, "worktree", "remove", a.path], { stdio: "pipe" });
        break;
      case "git-worktree-prune":
        execFileSync("git", ["-C", a.repo, "worktree", "prune"], { stdio: "pipe" });
        break;
      case "kill":
        await kill(a.pid);
        break;
    }
    return { item, ok: true, message: describe(a) };
  } catch (e) {
    return { item, ok: false, message: t.failed(describe(a), (e as Error).message.split("\n")[0]) };
  }
}
