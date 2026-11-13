#!/usr/bin/env node
// `npx whats-in-my-claude`: serves the API and the built web app from one
// local port, then opens the browser. Bundled to dist/cli.js, next to the
// web app in dist/client.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { app, localOnly } from './app.ts'
import { claudeDir, tildify } from './lib/paths.ts'
import { ensureIndexing } from './lib/transcript/indexer.ts'
import { listen } from './serve.ts'

const DEFAULT_PORT = 4317

// Both dist/cli.js and server/cli.ts sit one level below the package root.
const pkgRoot = path.resolve(import.meta.dirname, '..')
const version: string = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version

const HELP = `What's in my Claude ${version}
A local, read-only dashboard of your Claude Code setup.

Usage: npx whats-in-my-claude [options]

Options:
  -p, --port <n>  Port to listen on (default ${DEFAULT_PORT}, or the next free one)
      --no-open   Don't open the browser
  -h, --help      Show this help
  -v, --version   Show the version

Reads ~/.claude (or $CLAUDE_CONFIG_DIR) and ~/.claude.json without changing them.
Listens on 127.0.0.1 only.`

function fail(message: string): never {
  console.error(`whats-in-my-claude: ${message}`)
  process.exit(1)
}

function readArgs() {
  try {
    return parseArgs({
      options: {
        port: { type: 'string', short: 'p' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }).values
  } catch (err) {
    return fail(`${(err as Error).message}\n\n${HELP}`)
  }
}

function openBrowser(url: string) {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {}) // No opener available: the URL is printed anyway.
  child.unref()
}

const args = readArgs()
if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args.version) {
  console.log(version)
  process.exit(0)
}

const requested = args.port ?? process.env.WIMC_PORT
const port = Number(requested ?? DEFAULT_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`invalid port: ${requested}`)

const clientDir = path.join(pkgRoot, 'dist/client')
if (!fs.existsSync(path.join(clientDir, 'index.html'))) fail('the web app is not built. Run `bun run build` first.')

const spa = serveStatic({ root: clientDir, path: 'index.html' })
const root = new Hono()
  .route('/', app)
  .use('*', localOnly)
  .use('/*', serveStatic({ root: clientDir }))
  // Client-side routes get index.html; unknown API paths stay 404.
  .use('*', async (c, next) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not-found' }, 404) : spa(c, next)))

const server = await listen(root.fetch, port, requested === undefined).catch((err: NodeJS.ErrnoException) =>
  fail(err.code === 'EADDRINUSE' ? `port ${port} is in use. Pick another with --port.` : err.message),
)
const url = `http://127.0.0.1:${server.port}`

console.log(`
  What's in my Claude ${version}

  Reading  ${tildify(claudeDir())}
  Open     ${url}

  Press Ctrl+C to stop.
`)

ensureIndexing()
if (!args['no-open'] && !process.env.CI) openBrowser(url)
