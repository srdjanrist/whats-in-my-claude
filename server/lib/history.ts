// ~/.claude/history.jsonl: one line per prompt typed into Claude Code,
// across every project. It powers the activity heatmap and prompt search.
import { cached, TTL } from './cache.ts'
import { isObj, readText, str } from './fs.ts'
import { claudePath } from './paths.ts'
import { maskTokens } from './redact.ts'

export interface HistoryEntry {
  display: string
  at: number
  project: string | null
  sessionId: string | null
  pastes: number
}

async function load(): Promise<HistoryEntry[]> {
  const text = await readText(claudePath('history.jsonl'))
  if (!text) return []
  const out: HistoryEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(v) || typeof v.timestamp !== 'number') continue
    out.push({
      display: typeof v.display === 'string' ? v.display : '',
      at: v.timestamp,
      project: str(v.project),
      sessionId: str(v.sessionId),
      pastes: isObj(v.pastedContents) ? Object.keys(v.pastedContents).length : 0,
    })
  }
  return out
}

export function readHistory(): Promise<HistoryEntry[]> {
  return cached('history', TTL.history, load)
}

/** Local calendar day, YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function historyByDay(): Promise<Record<string, number>> {
  const days: Record<string, number> = {}
  for (const e of await readHistory()) {
    const day = dayOf(e.at)
    days[day] = (days[day] ?? 0) + 1
  }
  return days
}

export async function historyByProject(): Promise<Map<string, { count: number; lastAt: number }>> {
  const map = new Map<string, { count: number; lastAt: number }>()
  for (const e of await readHistory()) {
    if (!e.project) continue
    const p = map.get(e.project) ?? { count: 0, lastAt: 0 }
    p.count++
    p.lastAt = Math.max(p.lastAt, e.at)
    map.set(e.project, p)
  }
  return map
}

export interface HistoryQuery {
  q?: string
  project?: string
  limit: number
  offset: number
}

export async function searchHistory(query: HistoryQuery) {
  const all = await readHistory()
  const q = query.q?.trim().toLowerCase()
  const matches = all.filter(
    e => (!query.project || e.project === query.project) && (!q || e.display.toLowerCase().includes(q)),
  )
  matches.sort((a, b) => b.at - a.at)
  return {
    total: matches.length,
    items: matches.slice(query.offset, query.offset + query.limit).map(e => ({
      ...e,
      display: maskTokens(e.display.length > 800 ? `${e.display.slice(0, 800)}…` : e.display),
    })),
  }
}
