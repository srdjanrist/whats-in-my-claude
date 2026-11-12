// Bun entry point. Serves the API on 127.0.0.1 only; with --static (used by
// `bun run start`) it also serves the built web app from dist/.
import path from 'node:path'
import { serveStatic } from '@hono/bun'
import { Hono } from 'hono'
import { app, localOnly } from './app.ts'
import { claudeDir, tildify } from './lib/paths.ts'
import { ensureIndexing } from './lib/transcript/indexer.ts'

const port = Number(process.env.WIMC_PORT ?? 4317)
const serveDist = process.argv.includes('--static')

const root = new Hono().route('/', app)
if (serveDist) {
  root.use('*', localOnly)
  const dist = path.relative(process.cwd(), path.resolve(import.meta.dirname, '../dist'))
  root.use('/*', serveStatic({ root: dist }))
  // Client-side routes: fall back to index.html.
  root.get('*', serveStatic({ path: path.join(dist, 'index.html') }))
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: root.fetch,
  idleTimeout: 60,
})

console.log(`whats-in-my-claude API on http://127.0.0.1:${server.port}  (reading ${tildify(claudeDir())})`)
if (serveDist) console.log(`open http://127.0.0.1:${server.port}`)

// Start the background transcript index right away.
ensureIndexing()
