// Dev entry point (`bun run dev`): serves the API on 127.0.0.1 while Vite
// serves the web app and proxies /api here. The published CLI is cli.ts.
import { app } from './app.ts'
import { claudeDir, tildify } from './lib/paths.ts'
import { ensureIndexing } from './lib/transcript/indexer.ts'
import { listen } from './serve.ts'

const { port } = await listen(app.fetch, Number(process.env.WIMC_PORT ?? 4317))
console.log(`whats-in-my-claude API on http://127.0.0.1:${port}  (reading ${tildify(claudeDir())})`)

// Start the background transcript index right away.
ensureIndexing()
