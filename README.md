# What's in my Claude

A local, read-only dashboard of your Claude Code setup: everything Claude Code keeps in
`~/.claude`, `~/.claude.json` and your projects' `.claude` folders, in one place.

- **Overview**: counts, a year of prompt activity, tokens by model, most-used tools, disk use, sessions running now, and a list of things worth a look (inline credentials, broken hooks, disabled plugins, duplicated skills…).
- **Projects**: every folder Claude Code has worked in. Each one shows its sessions, memories, CLAUDE.md files, settings, MCP servers, agents, commands, skills, hooks and last-session usage.
- **Sessions**: every transcript, with title, span, prompts, tokens (each response counted once), cost, subagents, PR links and the plan it wrote. A conversation viewer pages through transcripts of any size (tested on a 195 MB one).
- **Session map**: one session on a timeline, at `/sessions/<id>/map`. It shows its prompts, every subagent it ran (and which agent launched which), every file they read or changed, file-history versions, and everything it keeps under `~/.claude`. Click an agent or a file to see how it connects; the selection is kept in the URL.
- **Prompt history**: search over `history.jsonl`.
- **Plans**: plan-mode plans, linked to the sessions that wrote them.
- **Memories**: auto-memory files by type and project, with `MEMORY.md` index drift and unresolved `[[links]]`.
- **Skills**: one table over `~/.claude/skills`, `~/.agents/skills`, claude.ai-synced skills, plugin skills and project skills, with usage counts, symlinks and duplicate copies.
- **Agents & commands**: user, plugin and project definitions.
- **Plugins**: what is installed, where it is enabled, what each plugin adds (skills, agents, commands, hooks, MCP, LSP), and its context cost.
- **MCP servers**: every scope (user, local, project `.mcp.json`, plugin, claude.ai). Only the _names_ of env vars and headers are shown.
- **Hooks**: an event × source matrix, every hook command, and hook activity when claude-visualizer's log is present.
- **Settings**: user settings with secret values masked, plus every permission rule across your projects.
- **CLAUDE.md files**: global and per-project instructions, rendered, with `@imports`.
- **Storage**: disk use of `~/.claude`, the largest transcripts, and cleanup candidates (informational only).
- **⌘K search** across all of it.

## Run it

```sh
npx whats-in-my-claude
```

It starts on http://127.0.0.1:4317 (or the next free port) and opens your browser. Needs Node 22 or newer; nothing else is installed.

```
Options:
  -p, --port <n>  Port to listen on (default 4317, or the next free one)
      --no-open   Don't open the browser
  -h, --help      Show this help
  -v, --version   Show the version
```

| Variable            | Default            |                                              |
| ------------------- | ------------------ | -------------------------------------------- |
| `CLAUDE_CONFIG_DIR` | `~/.claude`        | Same meaning as in Claude Code               |
| `WIMC_PORT`         | `4317`             | Port (same as `--port`)                      |
| `WIMC_CACHE_DIR`    | your cache folder¹ | Where the transcript index is cached         |
| `WIMC_HOME`         | your home dir      | Read a different home folder (used by tests) |

¹ `~/Library/Caches/whats-in-my-claude` on macOS, `$XDG_CACHE_HOME/whats-in-my-claude` (default `~/.cache/…`) on Linux, `%LOCALAPPDATA%\whats-in-my-claude` on Windows.

## Develop

Uses [Bun](https://bun.sh) for scripts.

```sh
bun install
bun run dev      # API on 127.0.0.1:4317 + Vite on http://127.0.0.1:5173
bun run start    # build, then run the CLI exactly as npx would
```

The server is [Hono](https://hono.dev) on `@hono/node-server`, so it runs on both Node and Bun. `bun run build` puts the web app in `dist/client` and bundles the server and all its dependencies into one readable file, `dist/cli.js`, so the published package has no dependencies.

To release: `npm version patch` (or `minor`), then `npm publish`. `prepublishOnly` runs typecheck, lint, tests and the build first.

## Privacy and safety

What's in my Claude runs on your machine, reads files, and shows them to you. It does nothing else.

- **Read-only.** The server never writes to `~/.claude`, `~/.claude.json` or your projects. Its only write is its own transcript index in your cache folder (see `WIMC_CACHE_DIR`).
- **Local only.** The server binds to `127.0.0.1`. It rejects requests whose `Host` or `Origin` isn't localhost (this blocks DNS-rebinding pages), serves `GET` only, and sends no CORS headers.
- **Secrets stay on the server.**
  - **`~/.claude.json`:** read through an allow-list. Account data (`oauthAccount`, email, user/machine ids), caches and `lastSessionFirstPrompt` are never read out.
  - **MCP configs:** `env`/`headers` values are dropped; secret-looking args and URL query values are masked.
  - **Settings:** `env` maps and secret-named fields are masked.
  - **Free text:** well-known token shapes (`sk-…`, `ghp_…`, JWTs, AWS keys…) are masked in hook commands, CLAUDE.md files, memories and transcripts.
- **Never opened:**
  - `sessions/*.key`
  - `daemon/control.key`
  - `session-env/`
  - `shell-snapshots/`
  - `file-history/` backups (the session map only counts and sizes them)
  - the `~/.claude.json` backups
  - IDE lock `authToken`s
- **Never parsed from transcripts:** API request payloads (system prompts) and account/org records.
- **Leak test:** a test builds a fake home full of planted secrets, calls every API route, and fails if any secret value appears in a response.

## How it works

```
server/            Hono API, run by Bun
  app.ts           routes + localhost guard (exports AppType for the typed client)
  lib/             one reader per part of the setup (projects, skills, plugins, mcp, …)
  lib/transcript/  transcript parsing: head/tail listing, streaming stats, paged conversation, session timelines
  test/            Vitest: generated fixture home, leak test, unit tests
src/               React 19 + TanStack Router (file routes) + TanStack Query/Table
  routes/          one file per page
  components/      shadcn/ui (Base UI), data table, charts, conversation viewer
```

**Listing transcripts** reads only the first 256 KB and the last 128 KB of each file, which is enough for its folder, first prompt, title and last activity. **Full stats** (tokens per model, tool calls, cost) come from one streaming pass per file, run in the background at startup. That pass skips API-request lines before parsing them (about two-thirds of the bytes) and counts usage once per response. Results are cached by (path, size, mtime) and persisted to `.cache/index.json`. **The conversation viewer** builds a byte-offset index of a transcript the first time it's opened, then reads only the lines for the requested page.

The transcript parsing, the session listing and the formatting helpers are adapted from claude-visualizer (`src/transcript/*`, `src/paths.ts`, `src/format.ts`).

## Stack

Bun · Vite 8 · React 19 · TypeScript · TanStack Router / Query / Table · Tailwind CSS v4 · shadcn/ui (Base UI) · Recharts · Hono (RPC client + zod validation) · Biome · Vitest

```sh
bun run typecheck   # tsc -b
bun run lint        # biome check
bun run test        # vitest
```
