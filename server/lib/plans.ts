// Plan-mode plans: ~/.claude/plans/<slug>.md. The slug is also written on
// every transcript line of the session that made it, which links the two.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { firstHeading, listDir, readText, statSafe } from './fs.ts'
import { claudePath } from './paths.ts'
import { maskTokens } from './redact.ts'
import { getListings } from './transcript/indexer.ts'

export interface PlanItem {
  slug: string
  title: string
  file: string
  bytes: number
  modifiedAt: number
  /** For subagent plans (<slug>-agent-<id>.md). */
  agentId: string | null
  sessionId: string | null
  sessionTitle: string | null
  projectDir: string | null
}

async function load(): Promise<PlanItem[]> {
  const bySlug = new Map<string, { id: string; title: string | null; projectDir: string }>()
  for (const l of getListings())
    if (l.slug && !bySlug.has(l.slug))
      bySlug.set(l.slug, {
        id: l.id,
        title: l.title,
        projectDir: l.projectDir,
      })
  const out: PlanItem[] = []
  for (const entry of await listDir(claudePath('plans'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = claudePath('plans', entry.name)
    const [text, st] = await Promise.all([readText(file), statSafe(file)])
    const slug = entry.name.replace(/\.md$/, '')
    const agent = /^(.*)-agent-([A-Za-z0-9]+)$/.exec(slug)
    const parentSlug = agent?.[1] ?? slug
    const session = bySlug.get(parentSlug)
    out.push({
      slug,
      title: (text && firstHeading(text)) ?? slug,
      file,
      bytes: st?.size ?? 0,
      modifiedAt: st?.mtimeMs ?? 0,
      agentId: agent?.[2] ?? null,
      sessionId: session?.id ?? null,
      sessionTitle: session?.title ?? null,
      projectDir: session?.projectDir ?? null,
    })
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function readPlans() {
  return cached('plans', TTL.config, load)
}

export async function readPlan(slug: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null
  const plan = (await readPlans()).find(p => p.slug === slug)
  if (!plan) return null
  const text = await readText(path.join(claudePath('plans'), `${slug}.md`))
  return text === null ? null : { ...plan, content: maskTokens(text) }
}
