// A "project" is any folder Claude Code has worked in. Three sources name
// them: the transcript folders under ~/.claude/projects (whose names are an
// irreversible encoding of the path), the `projects` map of ~/.claude.json,
// and the cwd of each prompt in history.jsonl. They are merged by encoded
// path, and each transcript folder's real path is recovered from (in order)
// its transcripts' cwd, a matching path from the other two sources, or a
// legacy sessions-index.json.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { readClaudeJson } from './claude-json.ts'
import { readJsonObj, str } from './fs.ts'
import { historyByProject } from './history.ts'
import { readMemories } from './memories.ts'
import { claudePath, encodeProjectDir, homeDir, tildify } from './paths.ts'
import { projectConfig } from './project-config.ts'
import { cachedStats, getInventory, getListings } from './transcript/indexer.ts'
import type { Usage } from './transcript/records.ts'

export interface ProjectSummary {
  id: string
  path: string | null
  displayPath: string
  name: string
  exists: boolean
  /** The folder under ~/.claude/projects, when there is one. */
  transcriptDir: string | null
  sessionCount: number
  subagentCount: number
  transcriptBytes: number
  lastActiveAt: number | null
  memoryCount: number
  promptCount: number
  instructionFiles: string[]
  hasDotClaude: boolean
  hasMcpJson: boolean
  hasSettings: boolean
  inClaudeJson: boolean
  lastCost: number | null
  /** Totals over sessions whose stats are indexed so far. */
  tokens: Usage
  costUSD: number
  indexedSessions: number
  sources: ('transcripts' | 'claude-json' | 'history' | 'memory')[]
}

interface Draft {
  id: string
  path: string | null
  transcriptDir: string | null
  sources: Set<ProjectSummary['sources'][number]>
}

async function legacyIndexPath(dir: string): Promise<string | null> {
  const index = await readJsonObj(claudePath('projects', dir, 'sessions-index.json'))
  return index ? str(index.originalPath) : null
}

async function build(): Promise<ProjectSummary[]> {
  const [claudeJson, history, memories] = await Promise.all([readClaudeJson(), historyByProject(), readMemories()])
  const inv = getInventory()
  const listings = getListings()
  const drafts = new Map<string, Draft>()
  const draft = (id: string): Draft => {
    let d = drafts.get(id)
    if (!d) {
      d = { id, path: null, transcriptDir: null, sources: new Set() }
      drafts.set(id, d)
    }
    return d
  }

  // Known real paths, by their encoding.
  const pathsByEncoding = new Map<string, string>()
  for (const p of Object.keys(claudeJson.projects)) pathsByEncoding.set(encodeProjectDir(p), p)
  for (const p of history.keys()) pathsByEncoding.set(encodeProjectDir(p), p)

  for (const dir of inv.projectDirs) {
    const d = draft(dir)
    d.transcriptDir = dir
    const cwds = listings.filter(l => l.projectDir === dir && l.cwd).map(l => l.cwd as string)
    d.path =
      cwds.find(c => encodeProjectDir(c) === dir) ?? pathsByEncoding.get(dir) ?? cwds[0] ?? (await legacyIndexPath(dir))
    if (inv.sessions.some(s => s.projectDir === dir)) d.sources.add('transcripts')
  }
  for (const p of Object.keys(claudeJson.projects)) {
    const d = draft(encodeProjectDir(p))
    d.path ??= p
    d.sources.add('claude-json')
  }
  for (const p of history.keys()) {
    const d = draft(encodeProjectDir(p))
    d.path ??= p
    d.sources.add('history')
  }
  const memoryCounts = new Map<string, number>()
  for (const m of memories.items) memoryCounts.set(m.projectId, (memoryCounts.get(m.projectId) ?? 0) + 1)
  for (const id of memoryCounts.keys()) draft(id).sources.add('memory')

  const out = await Promise.all(
    [...drafts.values()].map(async (d): Promise<ProjectSummary> => {
      const config = d.path ? await projectConfig(d.path) : null
      const sessions = inv.sessions.filter(s => s.projectDir === d.id)
      const subagents = inv.subagents.filter(s => s.projectDir === d.id)
      const sessionListings = listings.filter(l => l.projectDir === d.id)
      const state = d.path ? claudeJson.projects[d.path] : undefined
      const hist = d.path ? history.get(d.path) : undefined
      const tokens: Usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      }
      let costUSD = 0
      let indexedSessions = 0
      for (const s of [...sessions, ...subagents]) {
        const stats = cachedStats(s)
        if (!stats) continue
        if (!s.id.includes('/') && !s.id.startsWith('agent-')) indexedSessions++
        for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) tokens[k] += stats.tokens[k]
        costUSD += stats.cost?.costUSD ?? 0
      }
      const lastActive = Math.max(0, ...sessionListings.map(l => l.lastAt), hist?.lastAt ?? 0)
      return {
        id: d.id,
        path: d.path,
        displayPath: d.path ? tildify(d.path) : d.id,
        name: d.path ? (d.path === homeDir() ? '~' : path.basename(d.path)) : d.id,
        exists: config?.exists ?? false,
        transcriptDir: d.transcriptDir,
        sessionCount: sessions.length,
        subagentCount: subagents.length,
        transcriptBytes: [...sessions, ...subagents].reduce((n, s) => n + s.size, 0),
        lastActiveAt: lastActive > 0 ? lastActive : null,
        memoryCount: memoryCounts.get(d.id) ?? 0,
        promptCount: hist?.count ?? 0,
        instructionFiles: config?.instructions.map(i => i.kind) ?? [],
        hasDotClaude: config?.hasDotClaude ?? false,
        hasMcpJson: config?.mcpJson != null,
        hasSettings: config?.settings != null || config?.settingsLocal != null,
        inClaudeJson: state !== undefined,
        lastCost: state?.lastCost ?? null,
        tokens,
        costUSD,
        indexedSessions,
        sources: [...d.sources],
      }
    }),
  )
  return out.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
}

export function readProjects(): Promise<ProjectSummary[]> {
  return cached('projects', TTL.config, build)
}

export async function findProject(id: string): Promise<ProjectSummary | null> {
  return (await readProjects()).find(p => p.id === id) ?? null
}

/** Absolute paths of projects that exist on disk (for scanning project-level config). */
export async function existingProjectRoots(): Promise<string[]> {
  return (await readProjects()).filter(p => p.exists && p.path).map(p => p.path as string)
}
