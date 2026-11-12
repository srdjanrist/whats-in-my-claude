// What a session is, read cheaply. Adapted from claude-visualizer
// (src/transcript/sessions.ts: readLines, readListing): only the first 256 KB
// (for the folder, branch and first prompt) and the last 128 KB (for the
// latest title and last activity) of a transcript are read, so listing
// hundreds of sessions totalling more than a gigabyte stays fast.
import fs from 'node:fs'
import path from 'node:path'
import { isHumanPrompt, promptText } from './prompts.ts'
import { parseRecord } from './records.ts'

const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 128 * 1024

export interface TranscriptFile {
  id: string
  file: string
  /** The encoded folder under ~/.claude/projects it lives in. */
  projectDir: string
  size: number
  mtimeMs: number
}

export type TitleSource = 'ai-title' | 'agent-name' | 'summary' | 'session-memory' | 'prompt' | null

export interface SessionListing extends TranscriptFile {
  cwd: string | null
  title: string | null
  titleSource: TitleSource
  /** The first prompt, on one line. */
  prompt: string | null
  /** The first prompt's time, else the first record's. */
  startedAt: number | null
  /** The last record's time, else the file's modification time. */
  lastAt: number
  gitBranch: string | null
  version: string | null
  slug: string | null
}

/** The complete lines in `length` bytes from `start`; a cut-off first or last line is dropped. */
export function readLines(file: string, start: number, length: number): string[] {
  if (length <= 0) return []
  const buf = Buffer.alloc(length)
  let read: number
  try {
    const fd = fs.openSync(file, 'r')
    try {
      read = fs.readSync(fd, buf, 0, length, start)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
  const lines = buf.subarray(0, read).toString('utf8').split('\n')
  if (start > 0) lines.shift()
  // The last piece is either '' (file ends with \n) or a line cut off by the window.
  lines.pop()
  return lines
}

/** The "# Session Title" section of <id>/session-memory/summary.md, if Claude wrote one. */
function sessionMemoryTitle(file: string, id: string): string | null {
  const summary = path.join(path.dirname(file), id, 'session-memory', 'summary.md')
  let text: string
  try {
    text = fs.readFileSync(summary, 'utf8')
  } catch {
    return null
  }
  const match = /^#\s*Session Title\s*\n+([^\n#][^\n]*)/m.exec(text)
  const title = match?.[1]?.trim()
  return title && !title.startsWith('_') ? title : null
}

/** What a session's transcript says about it, reading only its start and end. */
export function readListing(t: TranscriptFile): SessionListing {
  let cwd: string | null = null
  let prompt: string | null = null
  let firstAt: number | null = null
  let promptAt: number | null = null
  let gitBranch: string | null = null
  let version: string | null = null
  let slug: string | null = null
  for (const line of readLines(t.file, 0, Math.min(t.size, HEAD_BYTES))) {
    const r = parseRecord(line)
    if (r === null || !('at' in r)) continue
    if (r.at !== null && firstAt === null) firstAt = r.at
    if (cwd === null && r.cwd) cwd = r.cwd
    if (gitBranch === null && r.gitBranch && r.gitBranch !== 'HEAD') gitBranch = r.gitBranch
    if (version === null && r.version) version = r.version
    if (slug === null && r.slug) slug = r.slug
    if (prompt === null && r.type === 'user' && isHumanPrompt(r)) {
      const text = promptText(r.content)
      if (text) {
        prompt = text
        promptAt = r.at
      }
    }
    if (cwd !== null && prompt !== null && slug !== null && gitBranch !== null) break
  }

  let aiTitle: string | null = null
  let agentName: string | null = null
  let summary: string | null = null
  let lastAt: number | null = null
  const start = Math.max(0, t.size - TAIL_BYTES)
  const tail = readLines(t.file, start, t.size - start)
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i] as string
    // Only these are needed: skip parsing the big lines.
    const wanted =
      (aiTitle === null && line.includes('"ai-title"')) ||
      (agentName === null && line.includes('"agent-name"')) ||
      (summary === null && line.includes('"summary"')) ||
      (lastAt === null && line.includes('"timestamp"'))
    if (!wanted) continue
    const r = parseRecord(line)
    if (!r) continue
    if (r.type === 'ai-title' && aiTitle === null) aiTitle = r.title
    else if (r.type === 'agent-name' && agentName === null) agentName = r.name
    else if (r.type === 'summary' && summary === null) summary = r.summary
    else if ('at' in r && r.at !== null && lastAt === null) lastAt = r.at
    if (aiTitle !== null && lastAt !== null) break
  }

  let title: string | null = aiTitle
  let titleSource: TitleSource = aiTitle ? 'ai-title' : null
  if (!title && agentName) [title, titleSource] = [agentName, 'agent-name']
  if (!title && summary) [title, titleSource] = [summary, 'summary']
  if (!title) {
    const fromMemory = sessionMemoryTitle(t.file, t.id)
    if (fromMemory) [title, titleSource] = [fromMemory, 'session-memory']
  }
  if (!title && prompt) [title, titleSource] = [promptText(prompt, 90), 'prompt']

  return {
    ...t,
    cwd,
    title,
    titleSource,
    prompt,
    startedAt: promptAt ?? firstAt,
    lastAt: lastAt ?? firstAt ?? t.mtimeMs,
    gitBranch,
    version,
    slug,
  }
}
