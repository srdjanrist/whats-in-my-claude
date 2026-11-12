// The whats-in-my-claude API. Read-only and local-only: requests must come from
// localhost (Host and Origin are checked, which also stops DNS-rebinding
// pages from reading the API), only GET/HEAD are served, and no CORS headers
// are ever sent. The Bun entry point (index.ts) binds to 127.0.0.1.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { overviewRoute } from './routes/overview.ts'
import { projectsRoute } from './routes/projects.ts'
import { searchRoute } from './routes/search.ts'
import { sessionsRoute } from './routes/sessions.ts'
import { setupRoute } from './routes/setup.ts'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether a Host header (host[:port]) names this machine. */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name !== undefined && LOCAL_HOSTS.has(name.toLowerCase())
}

export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLocalHost(url.host)
  } catch {
    return false
  }
}

const api = new Hono()
  .get('/health', c => c.json({ ok: true as const, name: 'whats-in-my-claude' }))
  .route('/', overviewRoute)
  .route('/', setupRoute)
  .route('/', searchRoute)
  .route('/projects', projectsRoute)
  .route('/sessions', sessionsRoute)

/** Localhost-only, read-only guard; also used in front of the static files. */
export const localOnly = createMiddleware(async (c, next) => {
  if (!isLocalHost(c.req.header('host')) || !isLocalOrigin(c.req.header('origin'))) {
    return c.text('Forbidden: whats-in-my-claude only answers requests from localhost.', 403)
  }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Method Not Allowed', 405)
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
})

export const app = new Hono().use('*', localOnly).route('/api', api)

export type AppType = typeof app
