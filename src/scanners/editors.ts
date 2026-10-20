import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exists, list, usage } from "../fsutil.js";
import type { Item, ScanOptions } from "../types.js";
import { t } from "../i18n.js";

/** AI editors built on VS Code, plus VS Code itself (Copilot keeps its chats here). */
const APPS = ["Cursor", "Windsurf", "Code"];

function userDir(o: Pick<ScanOptions, "home" | "env" | "platform">, app: string): string {
  if (o.platform === "darwin") return join(o.home, "Library", "Application Support", app, "User");
  if (o.platform === "win32") return join(o.env.APPDATA || join(o.home, "AppData", "Roaming"), app, "User");
  return join(o.env.XDG_CONFIG_HOME || join(o.home, ".config"), app, "User");
}

export function workspaceStorageDirs(o: Pick<ScanOptions, "home" | "env" | "platform">): string[] {
  return APPS.map((app) => join(userDir(o, app), "workspaceStorage"));
}

/** The local folder or .code-workspace file a workspaceStorage entry belongs to, if it is a local one. */
export function workspaceTarget(entry: string): string | undefined {
  try {
    const meta = JSON.parse(readFileSync(join(entry, "workspace.json"), "utf8"));
    const uri: unknown = meta.folder ?? meta.workspace;
    if (typeof uri !== "string" || !uri.startsWith("file://")) return undefined;
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** Per-workspace storage (chat history, indexes, state DBs) for projects that no longer exist. */
export function scanEditors(o: ScanOptions): Item[] {
  const floor = o.now - 3_600_000;
  const items: Item[] = [];
  APPS.forEach((app, i) => {
    const dir = workspaceStorageDirs(o)[i];
    const paths: string[] = [];
    let bytes = 0;
    let mtime = 0;
    for (const entry of list(dir)) {
      const target = workspaceTarget(entry);
      if (!target || exists(target)) continue;
      const u = usage(entry);
      if (u.mtime >= floor) continue;
      paths.push(entry);
      bytes += u.bytes;
      if (u.mtime > mtime) mtime = u.mtime;
    }
    if (paths.length === 0) return;
    const name = app === "Code" ? "vscode" : app.toLowerCase();
    items.push({
      id: `cache:${name}:workspaces`,
      category: "cache",
      tool: name,
      title: t.workspaces(paths.length),
      detail: t.workspacesDetail(dir),
      bytes,
      mtime,
      action: { kind: "rm", paths },
    });
  });
  return items;
}
