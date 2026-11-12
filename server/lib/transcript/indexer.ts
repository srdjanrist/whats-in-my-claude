// Finds every transcript under ~/.claude/projects and keeps two indexes:
//  - listings (head/tail read, fast), refreshed on demand;
//  - full stats (streaming pass), built in the background one file at a
//    time and persisted to whats-in-my-claude/.cache so a restart doesn't rescan
//    a gigabyte of transcripts. Both are keyed by (path, size, mtime).
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createFileCache } from '../cache.ts'
import { appCacheDir, claudePath } from '../paths.ts'
import { readListing, type SessionListing, type TranscriptFile } from './listing.ts'
import { computeStats, type SessionStats, STATS_VERSION } from './stats.ts'
import { listSubagents, readAgentMeta } from './subagents.ts'

export interface SubagentTranscript extends TranscriptFile {
  parentId: string
  agentId: string
  metaFile: string | null
}

export interface TranscriptInventory {
  sessions: TranscriptFile[]
  subagents: SubagentTranscript[]
  /** Project folders under ~/.claude/projects (with or without transcripts). */
  projectDirs: string[]
}

function statFile(file: string): { size: number; mtimeMs: number } | null {
  try {
    const s = fs.statSync(file)
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}

/** Every main transcript and subagent transcript on disk, right now. */
export function scanTranscripts(): TranscriptInventory {
  const projectsDir = claudePath('projects')
  const sessions: TranscriptFile[] = []
  const subagents: SubagentTranscript[] = []
  let dirs: fs.Dirent[]
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return { sessions, subagents, projectDirs: [] }
  }
  const projectDirs: string[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    projectDirs.push(dir.name)
    const full = path.join(projectsDir, dir.name)
    let names: string[]
    try {
      names = fs.readdirSync(full)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(full, name)
      const st = statFile(file)
      if (!st) continue
      const id = name.slice(0, -'.jsonl'.length)
      const legacyAgent = /^agent-(.+)$/.exec(id)
      if (legacyAgent?.[1]) {
        subagents.push({
          id,
          file,
          projectDir: dir.name,
          ...st,
          parentId: '',
          agentId: legacyAgent[1],
          metaFile: null,
        })
        continue
      }
      sessions.push({ id, file, projectDir: dir.name, ...st })
      for (const sub of listSubagents(file)) {
        const sst = statFile(sub.file)
        if (!sst) continue
        subagents.push({
          id: `${id}/${sub.agentId}`,
          file: sub.file,
          projectDir: dir.name,
          ...sst,
          parentId: id,
          agentId: sub.agentId,
          metaFile: fs.existsSync(sub.meta) ? sub.meta : null,
        })
      }
    }
  }
  return { sessions, subagents, projectDirs: projectDirs.sort() }
}

// ---------------------------------------------------------------- listings

const listingCache = createFileCache<SessionListing>()
let inventoryAt = 0
let inventory: TranscriptInventory | null = null

export function getInventory(maxAgeMs = 5_000): TranscriptInventory {
  if (!inventory || Date.now() - inventoryAt > maxAgeMs) {
    inventory = scanTranscripts()
    inventoryAt = Date.now()
  }
  return inventory
}

export function listingOf(t: TranscriptFile): SessionListing {
  const hit = listingCache.get(t.file, t.size, t.mtimeMs)
  if (hit) return hit
  const listing = readListing(t)
  listingCache.set(t.file, t.size, t.mtimeMs, listing)
  return listing
}

/** All sessions, most recently active first. */
export function getListings(): SessionListing[] {
  return getInventory()
    .sessions.map(listingOf)
    .sort((a, b) => b.lastAt - a.lastAt)
}

export function findSession(id: string): TranscriptFile | null {
  return getInventory().sessions.find(s => s.id === id) ?? null
}

export function subagentsOf(sessionId: string) {
  return getInventory()
    .subagents.filter(s => s.parentId === sessionId)
    .map(s => ({
      ...s,
      meta: s.metaFile ? readAgentMeta(s.metaFile) : null,
    }))
}

// ------------------------------------------------------------------- stats

const statsCache = createFileCache<SessionStats>()
const CACHE_FILE = () => path.join(appCacheDir(), 'index.json')
let loaded = false

interface PersistedIndex {
  v: number
  entries: Record<string, { size: number; mtimeMs: number; stats: SessionStats }>
}

function loadPersisted(): void {
  if (loaded) return
  loaded = true
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8')) as PersistedIndex
    if (data.v !== STATS_VERSION) return
    for (const [file, e] of Object.entries(data.entries)) statsCache.load(file, e.size, e.mtimeMs, e.stats)
  } catch {
    // No cache yet, or an unreadable one: it will be rebuilt.
  }
}

async function persist(): Promise<void> {
  const entries: PersistedIndex['entries'] = {}
  for (const [file, e] of statsCache.entries()) entries[file] = { size: e.size, mtimeMs: e.mtimeMs, stats: e.value }
  const target = CACHE_FILE()
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify({ v: STATS_VERSION, entries } satisfies PersistedIndex))
    await fsp.rename(tmp, target)
  } catch {
    // Persistence is an optimisation only.
  }
}

const inFlight = new Map<string, Promise<SessionStats>>()

/** Full stats for one transcript, from cache when the file hasn't changed. */
export function statsFor(t: TranscriptFile): Promise<SessionStats> {
  loadPersisted()
  const hit = statsCache.get(t.file, t.size, t.mtimeMs)
  if (hit) return Promise.resolve(hit)
  const pending = inFlight.get(t.file)
  if (pending) return pending
  const work = computeStats(t.file)
    .then(stats => {
      statsCache.set(t.file, t.size, t.mtimeMs, stats)
      return stats
    })
    .finally(() => inFlight.delete(t.file))
  inFlight.set(t.file, work)
  return work
}

/** Cached stats only (no work): null when the file hasn't been indexed yet. */
export function cachedStats(t: TranscriptFile): SessionStats | null {
  loadPersisted()
  return statsCache.get(t.file, t.size, t.mtimeMs) ?? null
}

export interface IndexStatus {
  state: 'idle' | 'running' | 'done'
  files: number
  filesDone: number
  bytes: number
  bytesDone: number
  startedAt: number | null
  finishedAt: number | null
  current: string | null
}

const status: IndexStatus = {
  state: 'idle',
  files: 0,
  filesDone: 0,
  bytes: 0,
  bytesDone: 0,
  startedAt: null,
  finishedAt: null,
  current: null,
}

export function indexStatus(): IndexStatus {
  return { ...status }
}

/**
 * Starts a background pass over every transcript whose stats aren't cached.
 * Safe to call often: it does nothing while a pass runs, or for 30 s after one.
 */
export function ensureIndexing(): void {
  if (status.state === 'running') return
  if (status.finishedAt && Date.now() - status.finishedAt < 30_000) return
  loadPersisted()
  const inv = scanTranscripts()
  inventory = inv
  inventoryAt = Date.now()
  const all: TranscriptFile[] = [...inv.sessions, ...inv.subagents]
  const todo = all.filter(t => !statsCache.get(t.file, t.size, t.mtimeMs))
  Object.assign(status, {
    state: 'running',
    files: all.length,
    filesDone: all.length - todo.length,
    bytes: all.reduce((n, t) => n + t.size, 0),
    bytesDone: all.reduce((n, t) => n + t.size, 0) - todo.reduce((n, t) => n + t.size, 0),
    startedAt: Date.now(),
    finishedAt: null,
    current: null,
  } satisfies IndexStatus)
  // Smallest first, so most sessions get numbers quickly.
  todo.sort((a, b) => a.size - b.size)
  void (async () => {
    let sincePersist = 0
    for (const t of todo) {
      status.current = t.id
      try {
        await statsFor(t)
      } catch {
        // A file that vanished or can't be read is skipped.
      }
      status.filesDone++
      status.bytesDone += t.size
      sincePersist += t.size
      if (sincePersist > 100 * 1024 * 1024) {
        sincePersist = 0
        await persist()
      }
    }
    if (todo.length > 0) await persist()
    Object.assign(status, {
      state: 'done',
      finishedAt: Date.now(),
      current: null,
    })
  })()
}
