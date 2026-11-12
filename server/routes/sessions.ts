import { Hono } from 'hono'
import { tildify } from '../lib/paths.ts'
import { readPlans } from '../lib/plans.ts'
import { conversationEntry, conversationPage } from '../lib/transcript/conversation.ts'
import {
  cachedStats,
  findSession,
  getInventory,
  getListings,
  listingOf,
  statsFor,
  subagentsOf,
} from '../lib/transcript/indexer.ts'
import type { TranscriptFile } from '../lib/transcript/listing.ts'
import { int, query, z } from './util.ts'

/** The transcript to read: the session's own, or one of its subagents' (?agent=<id>). */
function target(sessionId: string, agent: string | undefined): TranscriptFile | null {
  const session = findSession(sessionId)
  if (!session) return null
  if (!agent) return session
  return getInventory().subagents.find(s => s.parentId === sessionId && s.agentId === agent) ?? null
}

export const sessionsRoute = new Hono()
  .get('/', query(z.object({ project: z.string().optional() })), c => {
    const { project } = c.req.valid('query')
    const listings = getListings().filter(l => !project || l.projectDir === project)
    const subCounts = new Map<string, number>()
    for (const s of getInventory().subagents) subCounts.set(s.parentId, (subCounts.get(s.parentId) ?? 0) + 1)
    return c.json({
      sessions: listings.map(l => {
        const stats = cachedStats(l)
        return {
          id: l.id,
          projectDir: l.projectDir,
          cwd: l.cwd,
          displayCwd: l.cwd ? tildify(l.cwd) : null,
          title: l.title,
          titleSource: l.titleSource,
          prompt: l.prompt,
          startedAt: l.startedAt,
          lastAt: l.lastAt,
          size: l.size,
          gitBranch: l.gitBranch,
          version: l.version,
          subagents: subCounts.get(l.id) ?? 0,
          stats: stats
            ? {
                prompts: stats.humanPrompts,
                tokens: stats.tokens,
                models: Object.keys(stats.models),
                toolCalls: Object.values(stats.toolCalls).reduce((a, b) => a + b, 0),
                costUSD: stats.cost?.costUSD ?? null,
                compactions: stats.compactions,
              }
            : null,
        }
      }),
    })
  })
  .get('/:id', async c => {
    const t = findSession(c.req.param('id'))
    if (!t) return c.json({ error: 'not-found' as const }, 404)
    const listing = listingOf(t)
    const stats = await statsFor(t)
    const subagents = subagentsOf(t.id).map(s => {
      const st = cachedStats(s)
      return {
        agentId: s.agentId,
        size: s.size,
        type: s.meta?.agentType ?? null,
        description: s.meta?.description ?? null,
        model: s.meta?.model ?? null,
        isFork: s.meta?.isFork ?? false,
        tokens: st?.tokens ?? null,
        toolCalls: st ? Object.values(st.toolCalls).reduce((a, b) => a + b, 0) : null,
        firstAt: st?.firstAt ?? null,
        lastAt: st?.lastAt ?? null,
      }
    })
    const slug = stats.slug ?? listing.slug
    const plans = slug ? (await readPlans()).filter(p => p.slug === slug || p.slug.startsWith(`${slug}-agent-`)) : []
    const continued = stats.continuedIn ? findSession(stats.continuedIn) : null
    return c.json({
      session: {
        ...listing,
        displayCwd: listing.cwd ? tildify(listing.cwd) : null,
        file: tildify(listing.file),
      },
      stats,
      subagents,
      plans: plans.map(p => ({ slug: p.slug, title: p.title })),
      continuedIn: stats.continuedIn
        ? {
            id: stats.continuedIn,
            title: continued ? listingOf(continued).title : null,
            exists: continued !== null,
          }
        : null,
    })
  })
  .get(
    '/:id/conversation',
    query(
      z.object({
        offset: int(0, 0, 10_000_000),
        limit: int(60, 1, 200),
        agent: z.string().optional(),
      }),
    ),
    async c => {
      const { offset, limit, agent } = c.req.valid('query')
      const t = target(c.req.param('id'), agent)
      if (!t) return c.json({ error: 'not-found' as const }, 404)
      return c.json(await conversationPage(t, offset, limit))
    },
  )
  .get('/:id/entry/:index', query(z.object({ agent: z.string().optional() })), async c => {
    const t = target(c.req.param('id'), c.req.valid('query').agent)
    if (!t) return c.json({ error: 'not-found' as const }, 404)
    const index = Number.parseInt(c.req.param('index'), 10)
    const entry = Number.isNaN(index) ? null : await conversationEntry(t, index)
    if (!entry) return c.json({ error: 'not-found' as const }, 404)
    return c.json({ entry })
  })
