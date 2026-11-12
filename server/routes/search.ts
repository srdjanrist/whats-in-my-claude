// ⌘K search across the whole setup.
import { Hono } from 'hono'
import { readDefinitions } from '../lib/agents.ts'
import { readMcpServers } from '../lib/mcp.ts'
import { readMemories } from '../lib/memories.ts'
import { tildify } from '../lib/paths.ts'
import { readPlans } from '../lib/plans.ts'
import { setupContext } from '../lib/setup.ts'
import { readSkills } from '../lib/skills.ts'
import { getListings } from '../lib/transcript/indexer.ts'
import { query, z } from './util.ts'

export interface SearchHit {
  group: 'Projects' | 'Sessions' | 'Memories' | 'Skills' | 'Agents' | 'Commands' | 'Plugins' | 'MCP' | 'Plans'
  title: string
  subtitle: string | null
  /** App route to open. */
  to: string
  search?: Record<string, string>
}

const PER_GROUP = 8

export const searchRoute = new Hono().get('/search', query(z.object({ q: z.string().default('') })), async c => {
  const q = c.req.valid('query').q.trim().toLowerCase()
  if (q.length < 2) return c.json({ hits: [] as SearchHit[] })
  const has = (...fields: (string | null | undefined)[]) => fields.some(f => f?.toLowerCase().includes(q))
  const { projects, plugins, roots } = await setupContext()
  const [memories, skills, defs, mcp, plans] = await Promise.all([
    readMemories(),
    readSkills(plugins, roots),
    readDefinitions(plugins, roots),
    readMcpServers(plugins, roots),
    readPlans(),
  ])
  const hits: SearchHit[] = []
  const push = (items: SearchHit[]) => hits.push(...items.slice(0, PER_GROUP))
  push(
    projects
      .filter(p => has(p.path, p.name))
      .map(p => ({
        group: 'Projects',
        title: p.name,
        subtitle: p.displayPath,
        to: `/projects/${encodeURIComponent(p.id)}`,
      })),
  )
  push(
    getListings()
      .filter(l => has(l.title, l.prompt, l.id, l.cwd))
      .map(l => ({
        group: 'Sessions',
        title: l.title ?? l.id,
        subtitle: l.cwd ? tildify(l.cwd) : null,
        to: `/sessions/${l.id}`,
      })),
  )
  push(
    memories.items
      .filter(m => has(m.name, m.description))
      .map(m => ({
        group: 'Memories',
        title: m.name,
        subtitle: m.description,
        to: '/memories',
        search: { open: `${m.projectId}/${m.file}` },
      })),
  )
  push(
    skills
      .filter(s => has(s.qualifiedName, s.description))
      .map(s => ({
        group: 'Skills',
        title: s.qualifiedName,
        subtitle: s.description,
        to: '/skills',
        search: { open: s.id },
      })),
  )
  push(
    defs.agents
      .filter(a => has(a.name, a.description))
      .map(a => ({
        group: 'Agents',
        title: a.name,
        subtitle: a.description,
        to: '/agents',
        search: { open: a.id },
      })),
  )
  push(
    defs.commands
      .filter(a => has(a.name, a.description))
      .map(a => ({
        group: 'Commands',
        title: a.name,
        subtitle: a.description,
        to: '/agents',
        search: { tab: 'commands', open: a.id },
      })),
  )
  push(
    plugins
      .filter(p => has(p.id, p.description))
      .map(p => ({
        group: 'Plugins',
        title: p.name,
        subtitle: p.description,
        to: `/plugins/${encodeURIComponent(p.id)}`,
      })),
  )
  push(
    mcp
      .filter(m => has(m.name, m.url, m.command))
      .map(m => ({
        group: 'MCP',
        title: m.name,
        subtitle: `${m.scope} · ${m.transport}`,
        to: '/mcp',
      })),
  )
  push(
    plans
      .filter(p => has(p.title, p.slug))
      .map(p => ({
        group: 'Plans',
        title: p.title,
        subtitle: p.slug,
        to: '/plans',
        search: { open: p.slug },
      })),
  )
  return c.json({ hits })
})
