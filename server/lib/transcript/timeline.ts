// One streaming pass over a transcript that keeps what the session map draws:
// when the session was active, the prompts typed into it, the Agent calls it
// made, the files its tools read and changed, and the file-history backups
// Claude Code recorded. It keeps names, paths, times and short masked prompt
// text only: never tool inputs beyond a file's path, agent prompts, tool
// results or file contents.
//
// file-history records are parsed here rather than in records.ts: they carry
// no top-level timestamp, and adding them to TranscriptRecord would change
// how listings and stats narrow records with `'at' in r`.
import { createReadStream } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createFileCache } from '../cache.ts'
import { isObj, num, type Obj, str } from '../fs.ts'
import { maskTokens } from '../redact.ts'
import type { TranscriptFile } from './listing.ts'
import { isHumanPrompt, oneLine, promptText } from './prompts.ts'
import { isSkippedLine, parseObject, time } from './records.ts'

export type FileKind = 'read' | 'edit' | 'write'

/** A stretch of time, in epoch ms. */
export interface Span {
  from: number
  to: number
}

export interface TimelinePrompt {
  at: number | null
  text: string
}

/** An Agent (or older Task) tool call: the launch of a subagent. */
export interface AgentCall {
  /** The tool_use id; a subagent's .meta.json names the call that launched it. */
  id: string
  at: number | null
  type: string | null
  description: string | null
}

/** A file tool call (Read, Edit, Write…). */
export interface FileEvent {
  id: string
  at: number | null
  tool: string
  kind: FileKind
  /** Absolute and normalized. */
  path: string
  /** The tool returned an error. */
  failed: boolean
}

/** One version of a file Claude Code backed up before changing it (file-history). */
export interface FileBackup {
  /** As recorded: relative to the session's first folder, or absolute. */
  path: string
  realParentDir: string | null
  version: number
  at: number | null
  /** False when the file didn't exist yet, so there was nothing to back up. */
  exists: boolean
}

export interface Timeline {
  firstAt: number | null
  lastAt: number | null
  /** The first working folder seen. */
  cwd: string | null
  /** When the transcript was being written: record times, split at gaps of SEGMENT_GAP_MS. */
  segments: Span[]
  prompts: TimelinePrompt[]
  agentCalls: AgentCall[]
  fileEvents: FileEvent[]
  /** Deduplicated by path and version, oldest first. */
  backups: FileBackup[]
}

export const SEGMENT_GAP_MS = 10 * 60_000
const PROMPT_TEXT_MAX = 120
const DESCRIPTION_MAX = 160

const FILE_TOOLS: Record<string, FileKind> = {
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
}

export function emptyTimeline(): Timeline {
  return {
    firstAt: null,
    lastAt: null,
    cwd: null,
    segments: [],
    prompts: [],
    agentCalls: [],
    fileEvents: [],
    backups: [],
  }
}

/** Sorts times and joins them into spans, starting a new span wherever the gap is at least `gap`. */
export function mergeTimes(times: number[], gap = SEGMENT_GAP_MS): Span[] {
  const out: Span[] = []
  for (const t of [...times].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && t - last.to < gap) last.to = t
    else out.push({ from: t, to: t })
  }
  return out
}

function backupOf(file: string, b: unknown, fallbackAt: number | null): FileBackup | null {
  if (!isObj(b)) return null
  const version = num(b.version)
  if (version === null) return null
  return {
    path: file,
    realParentDir: str(b.realParentDir),
    version,
    at: time(b.backupTime) ?? fallbackAt,
    exists: str(b.backupFileName) !== null,
  }
}

/** The backups a file-history-snapshot or file-history-delta record lists; [] for anything else. */
export function parseFileHistory(r: Obj): FileBackup[] {
  if (r.type === 'file-history-snapshot') {
    const snapshot = isObj(r.snapshot) ? r.snapshot : null
    const tracked = snapshot && isObj(snapshot.trackedFileBackups) ? snapshot.trackedFileBackups : null
    if (!snapshot || !tracked) return []
    const at = time(snapshot.timestamp)
    return Object.entries(tracked).flatMap(([file, b]) => {
      const backup = file ? backupOf(file, b, at) : null
      return backup ? [backup] : []
    })
  }
  if (r.type === 'file-history-delta') {
    const file = str(r.trackingPath)
    const backup = file ? backupOf(file, r.backup, time(r.timestamp)) : null
    return backup ? [backup] : []
  }
  return []
}

/** Reads one transcript. Never throws: an unreadable file gives what was read so far. */
export async function readTimeline(file: string): Promise<Timeline> {
  const out = emptyTimeline()
  const times: number[] = []
  const failed = new Set<string>()
  const seenCalls = new Set<string>()
  const backups = new Map<string, FileBackup>()
  try {
    const rl = readline.createInterface({
      input: createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 }),
      crlfDelay: Number.POSITIVE_INFINITY,
    })
    for await (const line of rl) {
      if (line === '' || isSkippedLine(line)) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObj(value)) continue
      if (value.type === 'file-history-snapshot' || value.type === 'file-history-delta') {
        for (const b of parseFileHistory(value)) {
          const key = `${b.path}\u0000${b.version}`
          const prev = backups.get(key)
          if (!prev || (b.at !== null && (prev.at === null || b.at < prev.at))) backups.set(key, b)
        }
        continue
      }
      const r = parseObject(value)
      if (!r || !('at' in r)) continue
      if (r.at !== null) times.push(r.at)
      if (r.cwd && !out.cwd) out.cwd = r.cwd
      if (r.type === 'user') {
        if (isHumanPrompt(r)) out.prompts.push({ at: r.at, text: maskTokens(promptText(r.content, PROMPT_TEXT_MAX)) })
        if (typeof r.content !== 'string')
          for (const b of r.content) {
            const id = b.type === 'tool_result' && b.is_error === true ? str(b.tool_use_id) : null
            if (id) failed.add(id)
          }
      } else if (r.type === 'assistant') {
        for (const b of r.content) {
          if (b.type !== 'tool_use') continue
          const name = str(b.name)
          const id = str(b.id)
          if (!name || !id || seenCalls.has(id)) continue
          seenCalls.add(id)
          const input = isObj(b.input) ? b.input : {}
          if (name === 'Agent' || name === 'Task') {
            const description = str(input.description)
            out.agentCalls.push({
              id,
              at: r.at,
              type: str(input.subagent_type),
              description: description ? oneLine(maskTokens(description), DESCRIPTION_MAX) : null,
            })
            continue
          }
          const kind = FILE_TOOLS[name]
          const raw = str(input.file_path) ?? str(input.notebook_path)
          if (!kind || !raw) continue
          const base = r.cwd ?? out.cwd
          const abs = path.isAbsolute(raw) || !base ? raw : path.resolve(base, raw)
          out.fileEvents.push({ id, at: r.at, tool: name, kind, path: path.normalize(abs), failed: false })
        }
      }
    }
  } catch {
    // A file that vanished or can't be read: keep what was read.
  }
  for (const e of out.fileEvents) e.failed = failed.has(e.id)
  out.segments = mergeTimes(times)
  out.firstAt = out.segments[0]?.from ?? null
  out.lastAt = out.segments.at(-1)?.to ?? null
  out.backups = [...backups.values()].sort(
    (a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY),
  )
  return out
}

const timelineCache = createFileCache<Promise<Timeline>>(256)

/** A transcript's timeline, from cache while the file is unchanged. */
export function timelineOf(t: TranscriptFile): Promise<Timeline> {
  const hit = timelineCache.get(t.file, t.size, t.mtimeMs)
  if (hit) return hit
  const work = readTimeline(t.file)
  timelineCache.set(t.file, t.size, t.mtimeMs, work)
  return work
}
