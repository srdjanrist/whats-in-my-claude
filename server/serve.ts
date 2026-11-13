// Starts the HTTP server on 127.0.0.1 only. @hono/node-server runs on both
// Node (the published CLI) and Bun (`bun run dev`).
import { type ServerType, serve } from '@hono/node-server'

type Fetch = Parameters<typeof serve>[0]['fetch']

/**
 * Listens on 127.0.0.1:port. With `tryNext`, a port that is already in use
 * is skipped for the next one (up to 10 tries).
 */
export async function listen(
  fetch: Fetch,
  port: number,
  tryNext = false,
): Promise<{ server: ServerType; port: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await listenOnce(fetch, port + attempt)
    } catch (err) {
      const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      if (!inUse || !tryNext || attempt >= 9) throw err
    }
  }
}

function listenOnce(fetch: Fetch, port: number): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port, hostname: '127.0.0.1' }, info => resolve({ server, port: info.port }))
    server.once('error', reject)
  })
}
