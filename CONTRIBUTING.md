# Contributing

Thanks for helping agents clean up after themselves.

```sh
git clone https://github.com/hiyufan/agent-sweep && cd agent-sweep
npm install
npm test                      # builds, then runs node:test
node dist/cli.js --list       # scan your own machine, deletes nothing
```

## Adding a new agent

Most new targets are a few lines in `src/scanners/caches.ts` (session/cache folders) or `src/scanners/editors.ts` (VS Code forks). Each one needs:

1. **A folder the tool owns.** Add it to `cacheRoots()` so deletes there are allowed. Deletes anywhere else are refused at run time.
2. **A staleness rule.** Use `staleChildren()` / `staleLeaves()` so the `--days` threshold and the one-hour safety floor apply.
3. **A test** in `test/sweep.test.js` that builds a fake home folder and checks what is and is not offered. Include something that must be kept.

Never add settings, credentials, instructions files (`CLAUDE.md`, `AGENTS.md`), skills, or memory to a cleanup target.

## Code style

TypeScript, no runtime dependencies. Keep `npx agent-sweeper` fast to download and start.
