import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { exists, isDir, list, usage } from "../fsutil.js";
import type { Item, ScanOptions } from "../types.js";

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/** Where agents park their worktrees. */
export function worktreeRoots(o: Pick<ScanOptions, "home" | "env" | "cwd">): string[] {
  const roots = [
    join(o.home, ".claude-worktrees"),
    join(o.env.CLAUDE_CONFIG_DIR || join(o.home, ".claude"), "worktrees"),
    join(o.env.CODEX_HOME || join(o.home, ".codex"), "worktrees"),
  ];
  const top = git(o.cwd, ["rev-parse", "--show-toplevel"])?.trim();
  if (top) roots.push(join(top, ".claude", "worktrees"), join(top, ".worktrees"));
  return roots;
}

/** Directories (up to `depth` levels down) that are git worktrees, i.e. hold a `.git` file. */
function findWorktrees(dir: string, depth: number, out: string[] = []): string[] {
  for (const p of list(dir)) {
    if (!isDir(p)) continue;
    let st;
    try {
      st = lstatSync(join(p, ".git"));
    } catch {
      if (depth > 1) findWorktrees(p, depth - 1, out);
      continue;
    }
    if (st.isFile()) out.push(p);
  }
  return out;
}

function gitdirOf(wt: string): string | undefined {
  try {
    const m = readFileSync(join(wt, ".git"), "utf8").match(/^gitdir:\s*(.+)$/m);
    if (!m) return undefined;
    const g = m[1].trim();
    return isAbsolute(g) ? g : resolve(wt, g);
  } catch {
    return undefined;
  }
}

/** Main repository working tree that owns a linked worktree's gitdir. */
function ownerRepo(gitdir: string): string | undefined {
  try {
    const common = readFileSync(join(gitdir, "commondir"), "utf8").trim();
    const commonDir = isAbsolute(common) ? common : resolve(gitdir, common);
    return dirname(commonDir);
  } catch {
    return undefined;
  }
}

export function scanWorktrees(o: ScanOptions): Item[] {
  // Never touch anything used in the last hour, whatever --days says: it may be a live session.
  const cutoff = Math.min(o.now - o.days * 86_400_000, o.now - 3_600_000);
  const items: Item[] = [];
  const seen = new Set<string>();

  for (const root of worktreeRoots(o)) {
    for (const wt of findWorktrees(root, 3)) {
      if (seen.has(wt)) continue;
      seen.add(wt);
      const gitdir = gitdirOf(wt);
      const u = usage(wt);
      if (!gitdir || !exists(gitdir)) {
        items.push({
          id: `worktree:orphan:${wt}`,
          category: "worktree",
          tool: "git",
          title: `orphaned worktree ${basename(wt)}`,
          detail: `${wt} (its repository is gone)`,
          bytes: u.bytes,
          mtime: u.mtime,
          action: { kind: "rm", paths: [wt] },
        });
        continue;
      }
      if (u.mtime >= cutoff) continue;
      const repo = ownerRepo(gitdir);
      const status = git(wt, ["status", "--porcelain"]);
      // Only offer worktrees with nothing uncommitted; `git worktree remove` refuses the rest anyway.
      if (!repo || status === undefined || status.trim() !== "") continue;
      items.push({
        id: `worktree:stale:${wt}`,
        category: "worktree",
        tool: "git",
        title: `stale worktree ${basename(wt)}`,
        detail: `${wt}, clean, idle > ${o.days}d (branch is kept)`,
        bytes: u.bytes,
        mtime: u.mtime,
        action: { kind: "git-worktree-remove", repo, path: wt },
      });
    }
  }

  // Registrations whose folder was deleted by hand: `git worktree prune` tidies them.
  const top = git(o.cwd, ["rev-parse", "--show-toplevel"])?.trim();
  const porcelain = top ? git(top, ["worktree", "list", "--porcelain"]) : undefined;
  if (top && porcelain) {
    const prunable = porcelain.split("\n\n").filter((b) => /^prunable/m.test(b)).length;
    if (prunable > 0) {
      items.push({
        id: `worktree:prune:${top}`,
        category: "worktree",
        tool: "git",
        title: `${prunable} dangling worktree record(s) in ${basename(top)}`,
        detail: `git worktree prune in ${top}`,
        bytes: 0,
        mtime: 0,
        action: { kind: "git-worktree-prune", repo: top },
      });
    }
  }
  return items;
}
