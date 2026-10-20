export type Category = "cache" | "worktree" | "process";

export type Action =
  | { kind: "rm"; paths: string[] }
  | { kind: "git-worktree-remove"; repo: string; path: string }
  | { kind: "git-worktree-prune"; repo: string }
  | { kind: "kill"; pid: number };

export interface Item {
  id: string;
  category: Category;
  tool: string;
  title: string;
  detail: string;
  /** Bytes freed on disk, or resident memory for processes. */
  bytes: number;
  /** Last activity, in ms since epoch. */
  mtime: number;
  action: Action;
}

export interface ScanOptions {
  home: string;
  /** Entries untouched for at least this many days count as stale. */
  days: number;
  cwd: string;
  now: number;
  env: NodeJS.ProcessEnv;
}
