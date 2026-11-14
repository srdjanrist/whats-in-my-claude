// One streaming pass over a transcript that totals what a session did:
// tokens per model, tool calls, prompts, compactions, cost, PR links. Lines
// can be close to 1 MB, files close to 200 MB, so the file is read with
// readline and API-request payload lines are skipped before JSON.parse.
//
// Token usage is repeated on every line of a response (Claude Code writes one
// line per content block), so it is counted once per message id.
import { createReadStream } from 'node:fs'
import readline from 'node:readline'
import { isObj, str } from '../fs.ts'
import { commandName, isHumanPrompt } from './prompts.ts'
import { type CostTotals, isSkippedLine, parseRecord, textOf, type Usage } from './records.ts'

export const STATS_VERSION = 3

export interface ModelTokens extends Usage {
  messages: number
}

export interface SessionStats {
  v: number
  lines: number
  skippedLines: number
  parseErrors: number
  humanPrompts: number
  userMessages: number
  assistantMessages: number
  toolCalls: Record<string, number>
  /** Skill tool calls by skill (as Claude names it: plugin:skill or the bare name). */
  skillCalls: Record<string, number>
  /** Agent / Task tool calls by subagent_type. */
  agentCalls: Record<string, number>
  /** Slash commands run (`/name`), including skills started with a slash. */
  commandCalls: Record<string, number>
  models: Record<string, ModelTokens>
  tokens: Usage
  firstAt: number | null
  lastAt: number | null
  /** Sum of turn_duration records: time Claude spent working on prompts. */
  workMs: number
  compactions: number
  apiErrors: number
  cost: CostTotals | null
  prLinks: { url: string; number: number | null; repository: string | null }[]
  continuedIn: string | null
  slug: string | null
  gitBranches: string[]
  versions: string[]
  permissionModes: string[]
}

export function emptyStats(): SessionStats {
  return {
    v: STATS_VERSION,
    lines: 0,
    skippedLines: 0,
    parseErrors: 0,
    humanPrompts: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: {},
    skillCalls: {},
    agentCalls: {},
    commandCalls: {},
    models: {},
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    firstAt: null,
    lastAt: null,
    workMs: 0,
    compactions: 0,
    apiErrors: 0,
    cost: null,
    prLinks: [],
    continuedIn: null,
    slug: null,
    gitBranches: [],
    versions: [],
    permissionModes: [],
  }
}

function bump(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by
}

export async function computeStats(file: string): Promise<SessionStats> {
  const s = emptyStats()
  const seenMessages = new Set<string>()
  const branches = new Set<string>()
  const versions = new Set<string>()
  const modes = new Set<string>()
  const prs = new Map<string, SessionStats['prLinks'][number]>()

  const rl = readline.createInterface({
    input: createReadStream(file, {
      encoding: 'utf8',
      highWaterMark: 1024 * 1024,
    }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of rl) {
    if (line === '') continue
    s.lines++
    if (isSkippedLine(line)) {
      s.skippedLines++
      continue
    }
    const r = parseRecord(line)
    if (r === null) {
      s.parseErrors++
      continue
    }
    if ('at' in r) {
      if (r.at !== null) {
        if (s.firstAt === null || r.at < s.firstAt) s.firstAt = r.at
        if (s.lastAt === null || r.at > s.lastAt) s.lastAt = r.at
      }
      if (r.gitBranch && r.gitBranch !== 'HEAD') branches.add(r.gitBranch)
      if (r.version) versions.add(r.version)
      if (r.slug && !s.slug) s.slug = r.slug
    }
    switch (r.type) {
      case 'user':
        s.userMessages++
        if (isHumanPrompt(r)) s.humanPrompts++
        if (!r.isMeta && !r.hasToolResult) {
          const command = commandName(textOf(r.content))
          if (command) bump(s.commandCalls, command)
        }
        break
      case 'assistant': {
        if (r.isApiError) {
          if (!r.messageId || !seenMessages.has(r.messageId)) s.apiErrors++
          if (r.messageId) seenMessages.add(r.messageId)
          break
        }
        for (const block of r.content) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            bump(s.toolCalls, block.name)
            const input = isObj(block.input) ? block.input : {}
            if (block.name === 'Skill') {
              const skill = str(input.skill)
              if (skill) bump(s.skillCalls, skill.replace(/^\//, ''))
            } else if (block.name === 'Agent' || block.name === 'Task') {
              const agent = str(input.subagent_type)
              if (agent) bump(s.agentCalls, agent)
            }
          }
        }
        const id = r.messageId ?? r.requestId ?? r.uuid
        if (id && seenMessages.has(id)) break
        if (id) seenMessages.add(id)
        s.assistantMessages++
        if (r.usage) {
          const model = r.model ?? 'unknown'
          const m = s.models[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 }
          s.models[model] = m
          m.messages++
          for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
            m[k] += r.usage[k]
            s.tokens[k] += r.usage[k]
          }
        }
        break
      }
      case 'system':
        if (r.subtype === 'compact_boundary') s.compactions++
        else if (r.subtype === 'turn_duration' && r.durationMs) s.workMs += r.durationMs
        break
      case 'cost-state':
        s.cost = r.totals
        break
      case 'pr-link':
        prs.set(r.url, {
          url: r.url,
          number: r.number,
          repository: r.repository,
        })
        break
      case 'continued-in':
        s.continuedIn = r.sessionId
        break
      case 'permission-mode':
        modes.add(r.mode)
        break
    }
  }
  s.gitBranches = [...branches]
  s.versions = [...versions].sort()
  s.permissionModes = [...modes]
  s.prLinks = [...prs.values()]
  return s
}

/** Adds `b` into `a` (for project / global totals). */
export function addStats(a: SessionStats, b: SessionStats): SessionStats {
  a.lines += b.lines
  a.humanPrompts += b.humanPrompts
  a.userMessages += b.userMessages
  a.assistantMessages += b.assistantMessages
  a.workMs += b.workMs
  a.compactions += b.compactions
  a.apiErrors += b.apiErrors
  for (const k of ['toolCalls', 'skillCalls', 'agentCalls', 'commandCalls'] as const)
    for (const [key, count] of Object.entries(b[k])) bump(a[k], key, count)
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) a.tokens[k] += b.tokens[k]
  for (const [model, m] of Object.entries(b.models)) {
    const t = a.models[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 }
    a.models[model] = t
    t.messages += m.messages
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) t[k] += m[k]
  }
  if (b.firstAt !== null && (a.firstAt === null || b.firstAt < a.firstAt)) a.firstAt = b.firstAt
  if (b.lastAt !== null && (a.lastAt === null || b.lastAt > a.lastAt)) a.lastAt = b.lastAt
  return a
}
