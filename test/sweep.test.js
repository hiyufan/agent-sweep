import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanCaches } from "../dist/scanners/caches.js";
import { scanWorktrees } from "../dist/scanners/worktrees.js";
import { scanEditors } from "../dist/scanners/editors.js";
import { pathToFileURL } from "node:url";
import { findOrphans, mcpName, parseEtime, parsePs } from "../dist/scanners/processes.js";
import { inside, run } from "../dist/actions.js";
import { clip, detectLang, fit, setLang, width } from "../dist/i18n.js";

setLang("en");

const DAY = 86_400_000;
const now = Date.now();

function file(path, content, ageDays) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const t = (now - ageDays * DAY) / 1000;
  utimesSync(path, t, t);
}

function age(path, ageDays) {
  const t = (now - ageDays * DAY) / 1000;
  utimesSync(path, t, t);
}

function opts(home, extra = {}) {
  return { home, days: 14, cwd: home, now, env: {}, platform: "linux", ...extra };
}

test("finds stale Claude sessions but keeps fresh ones, memory and settings", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  const proj = join(home, ".claude/projects/-work-app");
  const line = JSON.stringify({ cwd: home, type: "user" }) + "\n";
  file(join(proj, "old.jsonl"), line.repeat(100), 30);
  file(join(proj, "new.jsonl"), line, 1);
  file(join(proj, "memory/MEMORY.md"), "keep", 30);
  age(join(proj, "memory"), 30);
  file(join(home, ".claude/settings.json"), "{}", 90);
  file(join(home, ".claude/debug/a.txt"), "x".repeat(50), 20);

  const items = scanCaches(opts(home));
  const sessions = items.find((i) => i.title.startsWith("stale sessions"));
  assert.deepEqual(sessions.action.paths, [join(proj, "old.jsonl")]);
  assert.ok(items.find((i) => i.title === "debug logs"));
  const all = items.flatMap((i) => i.action.paths);
  assert.ok(!all.some((p) => p.includes("settings.json") || p.includes("memory")));
});

test("flags a Claude project whose folder was deleted", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  const proj = join(home, ".claude/projects/-gone");
  file(join(proj, "s.jsonl"), JSON.stringify({ cwd: join(home, "does-not-exist") }) + "\n", 2);
  age(proj, 2);
  const items = scanCaches(opts(home));
  assert.equal(items.length, 1);
  assert.match(items[0].title, /orphaned project/);
  assert.deepEqual(items[0].action.paths, [proj]);
});

test("finds old Codex rollouts and Gemini temp folders", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  file(join(home, ".codex/sessions/2026/01/02/rollout-a.jsonl"), "{}", 200);
  age(join(home, ".codex/sessions/2026/01/02"), 200);
  file(join(home, ".codex/sessions/2026/10/19/rollout-b.jsonl"), "{}", 1);
  file(join(home, ".gemini/tmp/abc/chats/c.json"), "{}", 40);
  age(join(home, ".gemini/tmp/abc/chats"), 40);
  age(join(home, ".gemini/tmp/abc"), 40);
  const items = scanCaches(opts(home));
  const codex = items.find((i) => i.tool === "codex");
  assert.deepEqual(codex.action.paths, [join(home, ".codex/sessions/2026/01/02")]);
  assert.ok(items.find((i) => i.tool === "gemini"));
});

test("--days 0 still leaves anything touched in the last hour", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  file(join(home, ".claude/projects/-p/live.jsonl"), JSON.stringify({ cwd: home }), 0);
  assert.equal(scanCaches(opts(home, { days: 0 })).length, 0);
});

test("finds orphaned and stale clean worktrees", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  const repo = join(home, "repo");
  mkdirSync(repo);
  const g = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  g(repo, "init", "-q");
  g(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  const wt = join(home, ".claude-worktrees/repo/feature");
  g(repo, "worktree", "add", "-q", "-b", "feature", wt);
  for (const p of [join(wt, ".git"), wt]) age(p, 30);

  const orphan = join(home, ".claude-worktrees/repo/ghost");
  file(join(orphan, ".git"), `gitdir: ${join(home, "nowhere/.git/worktrees/ghost")}\n`, 30);
  file(join(orphan, "big.bin"), "x".repeat(1000), 30);

  const items = scanWorktrees(opts(home));
  const stale = items.find((i) => i.action.kind === "git-worktree-remove");
  assert.equal(stale.action.path, wt);
  const ghost = items.find((i) => i.title.includes("ghost"));
  assert.deepEqual(ghost.action, { kind: "rm", paths: [orphan] });
});

test("process tree: MCP servers without an agent ancestor are orphans", () => {
  const ps = `
    1     0  0  1000      10-00:00:00 /sbin/init
  100     1 501 90000         05:00 /usr/local/bin/claude --mcp-config x.json
  101   100 501  5000         04:59 npm exec @modelcontextprotocol/server-filesystem /tmp
  102   101 501 40000         04:58 node /cache/server-filesystem/dist/index.js
  200     1 501 70000   2-03:04:05 node /cache/@modelcontextprotocol/server-github/dist/index.js
  201   200 501 10000   2-03:04:00 node /cache/mcp-helper.js
  300     1 777 70000      1:00:00 node some-mcp-server.js
`;
  const procs = parsePs(ps);
  assert.equal(procs.length, 7);
  const orphans = findOrphans(procs, 501, 999).map((p) => p.pid);
  assert.deepEqual(orphans, [200]);
  assert.equal(parseEtime("2-03:04:05"), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(parseEtime("04:59"), 299);
  assert.equal(mcpName("node /c/@modelcontextprotocol/server-github/dist/index.js"), "@modelcontextprotocol/server-github");
  assert.equal(mcpName("node /n/_npx/1/node_modules/@playwright/mcp/cli.js"), "@playwright/mcp");
  assert.equal(mcpName("uv run mcp-server-fetch"), "mcp-server-fetch");
});

test("actions: dry-run touches nothing, apply deletes, outside paths are refused", async () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  const root = join(home, ".claude");
  const target = join(root, "debug/a.txt");
  file(target, "x", 30);
  const item = { id: "x", category: "cache", tool: "claude", title: "t", detail: "", bytes: 1, mtime: 0, action: { kind: "rm", paths: [target] } };

  const dry = await run(item, { apply: false, roots: [root] });
  assert.ok(dry.ok && dry.message.startsWith("[dry-run]"));
  assert.ok(existsSync(target));

  const bad = await run({ ...item, action: { kind: "rm", paths: [join(home, "Documents")] } }, { apply: true, roots: [root] });
  assert.ok(!bad.ok && bad.message.startsWith("refused"));
  const rootItself = await run({ ...item, action: { kind: "rm", paths: [root] } }, { apply: true, roots: [root] });
  assert.ok(!rootItself.ok);

  const real = await run(item, { apply: true, roots: [root] });
  assert.ok(real.ok);
  assert.ok(!existsSync(target));

  assert.ok(inside("/a/b", "/a/b/c"));
  assert.ok(!inside("/a/b", "/a/b/../c"));
  assert.ok(!inside("/a/b", "/a/bc"));
});

test("finds old npx installs but keeps recent ones", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  file(join(home, ".npm/_npx/aaa/node_modules/x/index.js"), "x".repeat(500), 60);
  for (const p of ["node_modules/x", "node_modules", ""]) age(join(home, ".npm/_npx/aaa", p), 60);
  file(join(home, ".npm/_npx/bbb/package.json"), "{}", 2);
  const npx = scanCaches(opts(home)).find((i) => i.tool === "npx");
  assert.deepEqual(npx.action.paths, [join(home, ".npm/_npx/aaa")]);
});

test("finds Cursor / VS Code storage of deleted workspaces on each platform", () => {
  for (const [platform, base] of [
    ["linux", ".config"],
    ["darwin", "Library/Application Support"],
  ]) {
    const home = mkdtempSync(join(tmpdir(), "sweep-"));
    const ws = join(home, base, "Cursor/User/workspaceStorage");
    const live = join(home, "live-project");
    mkdirSync(live);
    file(join(ws, "gone/workspace.json"), JSON.stringify({ folder: pathToFileURL(join(home, "deleted")).href }), 10);
    file(join(ws, "gone/state.vscdb"), "x".repeat(4096), 10);
    age(join(ws, "gone"), 10);
    file(join(ws, "here/workspace.json"), JSON.stringify({ folder: pathToFileURL(live).href }), 10);
    file(join(ws, "remote/workspace.json"), JSON.stringify({ folder: "vscode-remote://ssh-remote+box/srv" }), 10);
    const items = scanEditors(opts(home, { platform }));
    assert.equal(items.length, 1, platform);
    assert.equal(items[0].tool, "cursor");
    assert.deepEqual(items[0].action.paths, [join(ws, "gone")]);
  }
});

test("language follows the system locale, with an explicit override", () => {
  assert.equal(detectLang({ LANG: "zh_CN.UTF-8" }), "zh");
  assert.equal(detectLang({ LC_ALL: "zh_TW.UTF-8", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(detectLang({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(detectLang({ LANG: "zh_CN.UTF-8", AGENT_SWEEP_LANG: "en" }), "en");
  assert.equal(detectLang({ AGENT_SWEEP_LANG: "zh" }), "zh");
});

test("Chinese text is measured and cut by terminal columns", () => {
  assert.equal(width("缓存ab"), 6);
  assert.equal(width(fit("孤儿进程", 7)), 7);
  assert.equal(fit("孤儿进程", 7), "孤儿进 ");
  assert.equal(width(clip("过期会话：/Users/dev/code/webapp", 12)), 12);
});

test("findings are reported in Chinese when asked", () => {
  const home = mkdtempSync(join(tmpdir(), "sweep-"));
  file(join(home, ".claude/debug/a.txt"), "x", 20);
  setLang("zh");
  try {
    const [item] = scanCaches(opts(home));
    assert.equal(item.title, "调试日志");
    assert.equal(item.detail, "~/.claude/debug，闲置超过 14 天");
  } finally {
    setLang("en");
  }
});
