import { lstatSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

export interface Usage {
  bytes: number;
  /** Newest mtime of anything inside, in ms. */
  mtime: number;
}

/** Disk usage and newest mtime of a file or directory tree. Never follows symlinks. */
export function usage(path: string): Usage {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return { bytes: 0, mtime: 0 };
  }
  if (!st.isDirectory()) return { bytes: st.size, mtime: st.mtimeMs };
  let bytes = 0;
  let mtime = st.mtimeMs;
  let entries: string[] = [];
  try {
    entries = readdirSync(path);
  } catch {
    return { bytes, mtime };
  }
  for (const name of entries) {
    const u = usage(join(path, name));
    bytes += u.bytes;
    if (u.mtime > mtime) mtime = u.mtime;
  }
  return { bytes, mtime };
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function list(dir: string): string[] {
  try {
    return readdirSync(dir).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** First `max` bytes of a file as UTF-8, or "" if unreadable. */
export function head(path: string, max = 65536): string {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(max);
      const n = readSync(fd, buf, 0, max, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatAge(mtime: number, now: number): string {
  if (!mtime) return "-";
  const days = Math.floor((now - mtime) / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor((now - mtime) / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(0, Math.floor((now - mtime) / 60_000))}m`;
}
