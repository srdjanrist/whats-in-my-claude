// The conversation viewer's data. A transcript can be ~200 MB, so the first
// time a session is opened its conversation lines are located once (byte
// offset + length of each user / assistant / system line, with an
// assistant response's per-block lines grouped by message id), and pages are
// then served by reading just those byte ranges.
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { createFileCache } from '../cache.ts'
import { isObj, type Obj, str } from '../fs.ts'
import { maskTokens } from '../redact.ts'
import type { TranscriptFile } from './listing.ts'
import { isHumanPrompt, oneLine } from './prompts.ts'
import { type Block, isSkippedLine, parseObject, textOf, type UserRecord } from './records.ts'

type EntryKind = 'prompt' | 'assistant' | 'tool-result' | 'injected' | 'compact-summary' | 'system'

interface IndexedEntry {
  kind: EntryKind
  at: number | null
  /** [byte offset, byte length] of each line making up the entry. */
  lines: [number, number][]
  messageId?: string
}

export interface ConversationIndex {
  entries: IndexedEntry[]
  counts: Record<EntryKind, number>
}

const SHOWN_SYSTEM = new Set([
  'compact_boundary',
  'away_summary',
  'informational',
  'local_command',
  'scheduled_task_fire',
])
const CONVERSATION_TYPES = ['{"type":"user"', '{"type":"assistant"', '{"type":"system"']

/** Lines that might be conversation: everything but the typed metadata records. */
function mightBeConversation(line: string): boolean {
  if (!line.startsWith('{"type":"')) return true
  return CONVERSATION_TYPES.some(p => line.startsWith(p))
}

function classifyUser(r: UserRecord): EntryKind {
  if (r.isCompactSummary) return 'compact-summary'
  if (r.hasToolResult) return 'tool-result'
  if (isHumanPrompt(r)) return 'prompt'
  return 'injected'
}

async function buildIndex(file: string): Promise<ConversationIndex> {
  const entries: IndexedEntry[] = []
  const counts: Record<EntryKind, number> = {
    prompt: 0,
    assistant: 0,
    'tool-result': 0,
    injected: 0,
    'compact-summary': 0,
    system: 0,
  }
  const rl = readline.createInterface({
    input: createReadStream(file, {
      encoding: 'utf8',
      highWaterMark: 1024 * 1024,
    }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let offset = 0
  for await (const line of rl) {
    const start = offset
    const length = Buffer.byteLength(line, 'utf8')
    offset += length + 1
    if (line === '' || isSkippedLine(line) || !mightBeConversation(line)) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(value)) continue
    const r = parseObject(value)
    if (!r) continue
    if (r.type === 'assistant') {
      const last = entries.at(-1)
      if (last?.kind === 'assistant' && r.messageId && last.messageId === r.messageId) {
        last.lines.push([start, length])
        continue
      }
      entries.push({
        kind: 'assistant',
        at: r.at,
        lines: [[start, length]],
        messageId: r.messageId ?? undefined,
      })
      counts.assistant++
    } else if (r.type === 'user') {
      const kind = classifyUser(r)
      entries.push({ kind, at: r.at, lines: [[start, length]] })
      counts[kind]++
    } else if (r.type === 'system' && r.subtype && SHOWN_SYSTEM.has(r.subtype)) {
      entries.push({ kind: 'system', at: r.at, lines: [[start, length]] })
      counts.system++
    }
  }
  return { entries, counts }
}

const indexCache = createFileCache<Promise<ConversationIndex>>(6)

export function conversationIndex(t: TranscriptFile): Promise<ConversationIndex> {
  const hit = indexCache.get(t.file, t.size, t.mtimeMs)
  if (hit) return hit
  const work = buildIndex(t.file)
  indexCache.set(t.file, t.size, t.mtimeMs, work)
  return work
}

// ------------------------------------------------------------------ views

export type ViewBlock =
  | { type: 'text'; text: string; truncated: boolean }
  | { type: 'thinking'; text: string; truncated: boolean }
  | {
      type: 'tool_use'
      id: string
      name: string
      summary: string
      input: string
      truncated: boolean
    }
  | { type: 'image' }
  | { type: 'other'; name: string }

export type ConversationEntry =
  | {
      index: number
      kind: 'prompt'
      at: number | null
      text: string
      truncated: boolean
    }
  | {
      index: number
      kind: 'assistant'
      at: number | null
      model: string | null
      blocks: ViewBlock[]
    }
  | {
      index: number
      kind: 'tool-result'
      at: number | null
      toolUseId: string | null
      isError: boolean
      text: string
      truncated: boolean
      length: number
    }
  | {
      index: number
      kind: 'injected'
      at: number | null
      label: string
      text: string
      truncated: boolean
    }
  | {
      index: number
      kind: 'compact-summary'
      at: number | null
      text: string
      truncated: boolean
    }
  | {
      index: number
      kind: 'system'
      at: number | null
      subtype: string
      text: string
      truncated: boolean
    }

function cut(text: string, max: number): { text: string; truncated: boolean } {
  const masked = maskTokens(text)
  return masked.length > max ? { text: masked.slice(0, max), truncated: true } : { text: masked, truncated: false }
}

/** A one-line description of a tool call for the collapsed view. */
function toolSummary(name: string, input: Obj): string {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = str(input[k])
      if (v) return v
    }
    return null
  }
  const summary =
    pick('command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'skill', 'prompt', 'subject') ??
    Object.keys(input).slice(0, 3).join(', ')
  return oneLine(maskTokens(summary), name === 'Bash' ? 240 : 160)
}

function viewBlocks(content: Block[], max: number): ViewBlock[] {
  return content.map((b): ViewBlock => {
    if (b.type === 'text')
      return {
        type: 'text',
        ...cut(typeof b.text === 'string' ? b.text : '', max),
      }
    if (b.type === 'thinking' || b.type === 'redacted_thinking') {
      return {
        type: 'thinking',
        ...cut(typeof b.thinking === 'string' ? b.thinking : '', max),
      }
    }
    if (b.type === 'tool_use' || b.type === 'server_tool_use') {
      const input = isObj(b.input) ? b.input : {}
      const name = typeof b.name === 'string' ? b.name : 'tool'
      return {
        type: 'tool_use',
        id: typeof b.id === 'string' ? b.id : '',
        name,
        summary: toolSummary(name, input),
        ...(() => {
          const c = cut(JSON.stringify(input, null, 2), max)
          return { input: c.text, truncated: c.truncated }
        })(),
      }
    }
    if (b.type === 'image') return { type: 'image' }
    return { type: 'other', name: b.type }
  })
}

function injectedLabel(text: string, origin: string | null): string {
  if (origin && origin !== 'human') return origin
  const tag = /^\s*<([a-z-]+)>/.exec(text)?.[1]
  if (tag) return tag
  if (text.startsWith('[Request interrupted')) return 'interrupted'
  return 'injected'
}

async function readLine(handle: fsp.FileHandle, [offset, length]: [number, number]): Promise<Obj | null> {
  const buf = Buffer.alloc(length)
  await handle.read(buf, 0, length, offset)
  try {
    const value: unknown = JSON.parse(buf.toString('utf8'))
    return isObj(value) ? value : null
  } catch {
    return null
  }
}

async function renderEntry(
  handle: fsp.FileHandle,
  e: IndexedEntry,
  index: number,
  max: number,
  sessionDir: string,
): Promise<ConversationEntry | null> {
  const objs = (await Promise.all(e.lines.map(l => readLine(handle, l)))).filter((o): o is Obj => o !== null)
  const first = objs[0]
  if (!first) return null
  const r = parseObject(first)
  if (!r) return null
  switch (e.kind) {
    case 'assistant': {
      const blocks: Block[] = []
      let model: string | null = null
      for (const o of objs) {
        const rec = parseObject(o)
        if (rec?.type !== 'assistant') continue
        model ??= rec.model
        blocks.push(...rec.content)
      }
      return {
        index,
        kind: 'assistant',
        at: e.at,
        model,
        blocks: viewBlocks(blocks, max),
      }
    }
    case 'prompt':
    case 'injected':
    case 'compact-summary': {
      if (r.type !== 'user') return null
      const raw = textOf(r.content)
      const shown = cut(raw, max)
      if (e.kind === 'prompt') return { index, kind: 'prompt', at: e.at, ...shown }
      if (e.kind === 'compact-summary') return { index, kind: 'compact-summary', at: e.at, ...shown }
      return {
        index,
        kind: 'injected',
        at: e.at,
        label: injectedLabel(raw, r.origin),
        ...shown,
      }
    }
    case 'tool-result': {
      if (r.type !== 'user' || typeof r.content === 'string') return null
      const block = r.content.find(b => b.type === 'tool_result')
      const toolUseId = block && typeof block.tool_use_id === 'string' ? block.tool_use_id : null
      let raw = block ? textOf(block.content) || (typeof block.content === 'string' ? block.content : '') : ''
      // Large outputs are kept next to the transcript in <session>/tool-results/<tool use id>.txt.
      if (max > 100_000 && toolUseId) {
        const saved = path.join(sessionDir, 'tool-results', `${toolUseId}.txt`)
        try {
          const full = await fsp.readFile(saved, 'utf8')
          if (full.length > raw.length) raw = full
        } catch {
          // No saved output: the inline one is complete.
        }
      }
      return {
        index,
        kind: 'tool-result',
        at: e.at,
        toolUseId,
        isError: block?.is_error === true,
        length: raw.length,
        ...cut(raw, max),
      }
    }
    case 'system': {
      if (r.type !== 'system') return null
      let text = r.content ?? ''
      if (r.subtype === 'compact_boundary')
        text = `Conversation compacted${r.preTokens ? ` (${r.preTokens.toLocaleString()} tokens before)` : ''}`
      return {
        index,
        kind: 'system',
        at: e.at,
        subtype: r.subtype ?? 'system',
        ...cut(text, max),
      }
    }
  }
}

export interface ConversationPage {
  total: number
  offset: number
  counts: Record<EntryKind, number>
  entries: ConversationEntry[]
}

export const PAGE_TEXT_MAX = 4_000
export const FULL_TEXT_MAX = 1_000_000

export async function conversationPage(t: TranscriptFile, offset: number, limit: number): Promise<ConversationPage> {
  const idx = await conversationIndex(t)
  const slice = idx.entries.slice(offset, offset + limit)
  const handle = await fsp.open(t.file, 'r')
  const sessionDir = path.join(path.dirname(t.file), path.basename(t.file, '.jsonl'))
  try {
    const entries: ConversationEntry[] = []
    for (let i = 0; i < slice.length; i++) {
      const rendered = await renderEntry(handle, slice[i] as IndexedEntry, offset + i, PAGE_TEXT_MAX, sessionDir)
      if (rendered) entries.push(rendered)
    }
    return { total: idx.entries.length, offset, counts: idx.counts, entries }
  } finally {
    await handle.close()
  }
}

/** One entry with its text uncut (up to 1M characters), for "show all". */
export async function conversationEntry(t: TranscriptFile, index: number): Promise<ConversationEntry | null> {
  const idx = await conversationIndex(t)
  const e = idx.entries[index]
  if (!e) return null
  const handle = await fsp.open(t.file, 'r')
  const sessionDir = path.join(path.dirname(t.file), path.basename(t.file, '.jsonl'))
  try {
    return await renderEntry(handle, e, index, FULL_TEXT_MAX, sessionDir)
  } finally {
    await handle.close()
  }
}
