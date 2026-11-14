// The map of one session: its prompts, the subagents it ran (and which agent
// launched which), the files every one of them read and changed, and what the
// session keeps on disk. A pure function over per-transcript timelines and
// stats, so the route only gathers inputs. It carries names, paths, times and
// counts only: never tool inputs beyond a file's path, agent prompts, tool
// results, backup names or file contents.
import path from 'node:path'
import { maskTokens } from './redact.ts'
import type { StoredItem } from './storage.ts'
import type { Usage } from './transcript/records.ts'
import type { SessionStats } from './transcript/stats.ts'
import type { AgentMeta } from './transcript/subagents.ts'
import type { AgentCall, FileKind, Span, Timeline } from './transcript/timeline.ts'

/** 'main', or a subagent's agent id. */
export type Who = string

export interface SessionLinks {
  continuedIn: { id: string; title: string | null; exists: boolean } | null
  continuedFrom: { id: string; title: string | null }[]
  /** Some sessions aren't indexed yet, so continuedFrom may be missing some. */
  continuedFromPartial: boolean
  plans: { slug: string; title: string; agentId: string | null }[]
}

export interface MapAgentInput {
  agentId: string
  meta: AgentMeta | null
  timeline: Timeline
  stats: SessionStats
  bytes: number
  mtimeMs: number
}

export interface SessionMapInput {
  /** The session's folder (from its listing). */
  cwd: string | null
  home: string
  now: number
  main: { timeline: Timeline; stats: SessionStats }
  agents: MapAgentInput[]
  stored: StoredItem[]
  linked: SessionLinks
}

export interface MapPrompt {
  /** 1-based, in transcript order. */
  n: number
  at: number | null
  text: string
}

export interface MapAgent {
  id: string
  type: string
  description: string | null
  isFork: boolean
  parent: Who
  /** False when the call that launched it wasn't found (it is then shown under main). */
  parentKnown: boolean
  /** 1 for agents main launched. */
  depth: number
  launchedAt: number | null
  /** The main prompt it was launched after, for agents main launched. */
  afterPrompt: number | null
  firstAt: number | null
  lastAt: number | null
  segments: Span[]
  model: string | null
  tokens: Usage
  toolCalls: Record<string, number>
  children: string[]
  /** 'running' while its transcript was written in the last two minutes and it isn't marked finished. */
  status: 'done' | 'running' | null
  bytes: number
}

export interface MapLaunch {
  /** The Agent tool_use id. */
  id: string
  by: Who
  at: number | null
  type: string | null
  /** The subagent it started, when its transcript is on disk. */
  agentId: string | null
}

export interface MapFileEvent {
  at: number | null
  who: Who
  kind: FileKind
  tool: string
  failed: boolean
}

export interface MapFileVersion {
  version: number
  at: number | null
  /** False for the "didn't exist yet" backup Claude Code records before creating a file. */
  exists: boolean
}

export interface MapFile {
  /** The display path, also used in ?file=. */
  id: string
  dir: string
  name: string
  /** Inside the session's folder (shown relative to it). */
  inCwd: boolean
  events: MapFileEvent[]
  versions: MapFileVersion[]
  reads: number
  /** Successful edits and writes. */
  edits: number
  created: boolean
}

export interface SessionMapData {
  main: {
    firstAt: number | null
    lastAt: number | null
    segments: Span[]
    prompts: MapPrompt[]
    model: string | null
    tokens: Usage
    toolCalls: Record<string, number>
  }
  /** Tree order: each agent is followed by the agents it launched. */
  agents: MapAgent[]
  launches: MapLaunch[]
  files: MapFile[]
  stored: StoredItem[]
  linked: SessionLinks
  summary: {
    prompts: number
    agents: number
    nested: number
    forks: number
    toolCalls: number
    subagentToolCalls: number
    tokens: number
    subagentTokens: number
    filesRead: number
    filesEdited: number
    filesCreated: number
    storedBytes: number
    storedFiles: number
    backups: number
    /** Agent calls whose subagent transcript isn't on disk. */
    unmatchedLaunches: number
  }
}

const RUNNING_MS = 2 * 60_000

const sumTokens = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite
const sumCalls = (calls: Record<string, number>) => Object.values(calls).reduce((a, b) => a + b, 0)
const byTime = (a: number | null, b: number | null) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY)

/** The model that wrote the most messages. */
function topModel(stats: SessionStats): string | null {
  let best: string | null = null
  let most = 0
  for (const [model, m] of Object.entries(stats.models))
    if (model !== '<synthetic>' && m.messages > most) {
      best = model
      most = m.messages
    }
  return best
}

interface Owner {
  who: Who
  call: AgentCall
}

interface Draft {
  input: MapAgentInput
  parent: Who
  parentKnown: boolean
  call: AgentCall | null
  isFork: boolean
}

export function buildSessionMap(input: SessionMapInput): SessionMapData {
  const { main } = input
  const rootCwd = input.cwd ?? main.timeline.cwd

  // Who holds each Agent call. A fork's transcript starts with a copy of the
  // message that launched it, so its own launch shows up there too.
  const owners = new Map<string, Owner[]>()
  const addOwner = (who: Who, calls: AgentCall[]) => {
    for (const call of calls) {
      const list = owners.get(call.id) ?? []
      if (!list.some(o => o.who === who)) list.push({ who, call })
      owners.set(call.id, list)
    }
  }
  addOwner('main', main.timeline.agentCalls)
  for (const a of input.agents) addOwner(a.agentId, a.timeline.agentCalls)

  const isForkInput = (a: MapAgentInput) => a.meta?.isFork === true || a.meta?.agentType === 'fork'
  const drafts = new Map<string, Draft>()
  for (const a of input.agents) {
    const launch = a.meta?.toolUseId ?? null
    const held = launch ? (owners.get(launch) ?? []) : []
    const candidates = held.filter(o => o.who !== a.agentId)
    const pick =
      candidates.find(o => o.who === 'main') ??
      candidates
        .map(o => ({ o, d: input.agents.find(x => x.agentId === o.who) }))
        .filter((x): x is { o: Owner; d: MapAgentInput } => x.d !== undefined)
        .sort(
          (x, y) =>
            Number(isForkInput(x.d)) - Number(isForkInput(y.d)) || byTime(x.d.timeline.firstAt, y.d.timeline.firstAt),
        )[0]?.o
    const call = pick?.call ?? held.find(o => o.who === a.agentId)?.call ?? null
    const type = a.meta?.agentType ?? call?.type ?? null
    drafts.set(a.agentId, {
      input: a,
      parent: pick?.who ?? 'main',
      parentKnown: pick !== undefined,
      call,
      isFork: a.meta?.isFork === true || type === 'fork',
    })
  }

  // Depths, breaking any cycle by hanging its agent under main.
  const depthOf = (id: string): number | null => {
    const seen = new Set([id])
    let depth = 1
    let parent = drafts.get(id)?.parent
    while (parent && parent !== 'main') {
      if (seen.has(parent)) return null
      seen.add(parent)
      depth++
      parent = drafts.get(parent)?.parent
    }
    return depth
  }
  for (const [id, d] of drafts)
    if (depthOf(id) === null) {
      d.parent = 'main'
      d.parentKnown = false
    }

  const launchedAt = (d: Draft) => d.call?.at ?? d.input.timeline.firstAt
  const childrenOf = new Map<Who, string[]>()
  for (const [id, d] of drafts) childrenOf.set(d.parent, [...(childrenOf.get(d.parent) ?? []), id])
  for (const ids of childrenOf.values())
    ids.sort((a, b) => {
      const da = drafts.get(a)
      const db = drafts.get(b)
      return da && db ? byTime(launchedAt(da), launchedAt(db)) : 0
    })
  const order: string[] = []
  const walk = (who: Who) => {
    for (const id of childrenOf.get(who) ?? []) {
      order.push(id)
      walk(id)
    }
  }
  walk('main')

  const prompts: MapPrompt[] = main.timeline.prompts.map((p, i) => ({ n: i + 1, at: p.at, text: p.text }))
  const afterPrompt = (at: number | null): number | null => {
    if (at === null) return null
    let n: number | null = null
    for (const p of prompts) if (p.at !== null && p.at <= at) n = p.n
    return n
  }

  const agents: MapAgent[] = order.flatMap(id => {
    const d = drafts.get(id)
    if (!d) return []
    const a = d.input
    const toolCalls = { ...a.stats.toolCalls }
    // A fork's copy of its own launch isn't a call it made.
    const launch = a.meta?.toolUseId
    if (launch && a.timeline.agentCalls.some(c => c.id === launch) && toolCalls.Agent) {
      toolCalls.Agent -= 1
      if (toolCalls.Agent === 0) delete toolCalls.Agent
    }
    const at = launchedAt(d)
    const metaModel = a.meta?.model && a.meta.model !== 'inherit' ? a.meta.model : null
    return [
      {
        id,
        type: a.meta?.agentType ?? d.call?.type ?? (d.isFork ? 'fork' : 'agent'),
        description: a.meta?.description ? maskTokens(a.meta.description) : (d.call?.description ?? null),
        isFork: d.isFork,
        parent: d.parent,
        parentKnown: d.parentKnown,
        depth: depthOf(id) ?? 1,
        launchedAt: at,
        afterPrompt: d.parent === 'main' ? afterPrompt(at) : null,
        firstAt: a.timeline.firstAt,
        lastAt: a.timeline.lastAt,
        segments: a.timeline.segments,
        model: topModel(a.stats) ?? metaModel,
        tokens: a.stats.tokens,
        toolCalls,
        children: childrenOf.get(id) ?? [],
        status: a.meta?.finished === true ? 'done' : input.now - a.mtimeMs < RUNNING_MS ? 'running' : null,
        bytes: a.bytes,
      },
    ]
  })

  // Every Agent call, once, credited to the transcript that really made it.
  const launchedBy = new Map<string, string>()
  for (const a of input.agents) if (a.meta?.toolUseId) launchedBy.set(a.meta.toolUseId, a.agentId)
  const launches: MapLaunch[] = []
  const seenLaunches = new Set<string>()
  const addLaunches = (who: Who, calls: AgentCall[], own: string | null) => {
    for (const call of calls) {
      if (call.id === own || seenLaunches.has(call.id)) continue
      seenLaunches.add(call.id)
      launches.push({ id: call.id, by: who, at: call.at, type: call.type, agentId: launchedBy.get(call.id) ?? null })
    }
  }
  addLaunches('main', main.timeline.agentCalls, null)
  for (const id of order) {
    const d = drafts.get(id)
    if (d) addLaunches(id, d.input.timeline.agentCalls, d.input.meta?.toolUseId ?? null)
  }

  const files = buildFiles(input, rootCwd, order)

  const subagentToolCalls = agents.reduce((n, a) => n + sumCalls(a.toolCalls), 0)
  const subagentTokens = agents.reduce((n, a) => n + sumTokens(a.tokens), 0)
  return {
    main: {
      firstAt: main.timeline.firstAt,
      lastAt: main.timeline.lastAt,
      segments: main.timeline.segments,
      prompts,
      model: topModel(main.stats),
      tokens: main.stats.tokens,
      toolCalls: main.stats.toolCalls,
    },
    agents,
    launches,
    files,
    stored: input.stored,
    linked: input.linked,
    summary: {
      prompts: prompts.length,
      agents: agents.length,
      nested: agents.filter(a => a.depth > 1).length,
      forks: agents.filter(a => a.isFork).length,
      toolCalls: sumCalls(main.stats.toolCalls) + subagentToolCalls,
      subagentToolCalls,
      tokens: sumTokens(main.stats.tokens) + subagentTokens,
      subagentTokens,
      filesRead: files.filter(f => f.reads > 0).length,
      filesEdited: files.filter(f => f.edits > 0).length,
      filesCreated: files.filter(f => f.created).length,
      storedBytes: input.stored.reduce((n, s) => n + s.bytes, 0),
      storedFiles: input.stored.reduce((n, s) => n + s.files, 0),
      backups: files.reduce((n, f) => n + f.versions.filter(v => v.exists).length, 0),
      unmatchedLaunches: launches.filter(l => l.agentId === null).length,
    },
  }
}

interface FileDraft {
  events: MapFileEvent[]
  versions: Map<number, MapFileVersion>
}

/** Files by absolute path: tool calls from every transcript, plus file-history versions. */
function buildFiles(input: SessionMapInput, rootCwd: string | null, order: string[]): MapFile[] {
  const byPath = new Map<string, FileDraft>()
  const draft = (key: string): FileDraft => {
    let d = byPath.get(key)
    if (!d) {
      d = { events: [], versions: new Map() }
      byPath.set(key, d)
    }
    return d
  }
  // A fork repeats its parent's last message, so a call can appear twice: keep the first.
  const seen = new Set<string>()
  const timelines: [Who, Timeline][] = [['main', input.main.timeline]]
  for (const id of order) {
    const a = input.agents.find(x => x.agentId === id)
    if (a) timelines.push([id, a.timeline])
  }
  for (const [who, tl] of timelines)
    for (const e of tl.fileEvents) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      draft(e.path).events.push({ at: e.at, who, kind: e.kind, tool: e.tool, failed: e.failed })
    }

  for (const [, tl] of timelines)
    for (const b of tl.backups) {
      let key = path.isAbsolute(b.path) ? path.normalize(b.path) : rootCwd ? path.resolve(rootCwd, b.path) : b.path
      if (!byPath.has(key) && b.realParentDir) {
        const alt = path.join(b.realParentDir, path.basename(b.path))
        if (byPath.has(alt)) key = alt
      }
      const versions = draft(key).versions
      const prev = versions.get(b.version)
      if (!prev || byTime(b.at, prev.at) < 0)
        versions.set(b.version, { version: b.version, at: b.at, exists: b.exists })
    }

  const display = (abs: string): { text: string; inCwd: boolean } => {
    if (rootCwd && path.isAbsolute(abs)) {
      const rel = path.relative(rootCwd, abs)
      if (rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
        return { text: rel, inCwd: true }
    }
    const home = input.home
    const text = abs === home || abs.startsWith(home + path.sep) ? `~${abs.slice(home.length)}` : abs
    return { text, inCwd: false }
  }

  const used = new Map<string, number>()
  const files: MapFile[] = [...byPath.entries()].map(([abs, d]) => {
    const shown = display(abs)
    const text = maskTokens(shown.text)
    const count = (used.get(text) ?? 0) + 1
    used.set(text, count)
    const id = count === 1 ? text : `${text} (${count})`
    const cut = text.lastIndexOf('/')
    const events = d.events.sort((a, b) => byTime(a.at, b.at))
    const versions = [...d.versions.values()].sort((a, b) => a.version - b.version)
    return {
      id,
      dir: cut === -1 ? '' : text.slice(0, cut + 1),
      name: cut === -1 ? text : text.slice(cut + 1),
      inCwd: shown.inCwd,
      events,
      versions,
      reads: events.filter(e => e.kind === 'read' && !e.failed).length,
      edits: events.filter(e => e.kind !== 'read' && !e.failed).length,
      created: versions.some(v => v.version === 1 && !v.exists),
    }
  })
  const firstAt = (f: MapFile) => {
    const times = [...f.events.map(e => e.at), ...f.versions.map(v => v.at)].filter((t): t is number => t !== null)
    return times.length ? Math.min(...times) : null
  }
  return files.sort((a, b) => byTime(firstAt(a), firstAt(b)))
}
