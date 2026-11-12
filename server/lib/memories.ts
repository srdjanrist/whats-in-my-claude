// Auto-memory: ~/.claude/projects/<project>/memory/*.md, one fact per file
// with frontmatter, plus a MEMORY.md index. Older files keep `type` at the
// top level of the frontmatter instead of under `metadata`.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { isObj, listDir, readFrontmatter, readText, statSafe, str } from './fs.ts'
import { claudePath } from './paths.ts'
import { maskTokens } from './redact.ts'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
const TYPES = new Set(['user', 'feedback', 'project', 'reference'])

export interface MemoryItem {
  projectId: string
  file: string
  name: string
  description: string | null
  type: MemoryType | null
  originSessionId: string | null
  modified: number | null
  bytes: number
  links: string[]
  brokenLinks: string[]
  inIndex: boolean
}

export interface MemoryIndexEntry {
  title: string
  file: string
  hook: string | null
}

export interface MemoryDir {
  projectId: string
  dir: string
  files: number
  hasIndex: boolean
  index: MemoryIndexEntry[]
  /** Memory files the index doesn't mention. */
  orphans: string[]
  /** Index entries pointing at files that don't exist. */
  dead: string[]
}

const LINK = /\[\[([^\]]+)\]\]/g

function parseIndex(text: string): MemoryIndexEntry[] {
  const out: MemoryIndexEntry[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.*))?$/.exec(line)
    if (m)
      out.push({
        title: m[1] as string,
        file: (m[2] as string).trim(),
        hook: m[3]?.trim() || null,
      })
  }
  return out
}

async function loadDir(projectId: string): Promise<{ dir: MemoryDir; items: MemoryItem[] } | null> {
  const dir = claudePath('projects', projectId, 'memory')
  const entries = await listDir(dir)
  if (entries.length === 0) return null
  const indexText = await readText(path.join(dir, 'MEMORY.md'))
  const index = indexText ? parseIndex(indexText) : []
  const indexed = new Set(index.map(e => path.basename(e.file)))
  const files = entries.filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'MEMORY.md').map(e => e.name)
  const raw = await Promise.all(
    files.map(async file => {
      const full = path.join(dir, file)
      const fm = await readFrontmatter(full)
      const st = await statSafe(full)
      const meta = fm && isObj(fm.data.metadata) ? fm.data.metadata : {}
      const typeRaw = str(meta.type) ?? str(fm?.data.type)
      const modified = str(meta.modified)
      return {
        projectId,
        file,
        name: str(fm?.data.name) ?? file.replace(/\.md$/, ''),
        description: str(fm?.data.description),
        type: typeRaw && TYPES.has(typeRaw) ? (typeRaw as MemoryType) : null,
        originSessionId: str(meta.originSessionId) ?? str(fm?.data.originSessionId),
        modified: modified ? Date.parse(modified) || null : (st?.mtimeMs ?? null),
        bytes: fm?.bytes ?? 0,
        links: [...new Set([...(fm?.body ?? '').matchAll(LINK)].map(m => (m[1] as string).trim()))],
        brokenLinks: [] as string[],
        inIndex: indexed.has(file),
      } satisfies MemoryItem
    }),
  )
  const names = new Set(raw.flatMap(m => [m.name, m.file.replace(/\.md$/, '')]))
  for (const m of raw) m.brokenLinks = m.links.filter(l => !names.has(l))
  const fileSet = new Set(files)
  return {
    dir: {
      projectId,
      dir,
      files: files.length,
      hasIndex: indexText !== null,
      index,
      orphans: indexText !== null ? files.filter(f => !indexed.has(f)) : [],
      dead: index.map(e => path.basename(e.file)).filter(f => !fileSet.has(f)),
    },
    items: raw.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0)),
  }
}

async function loadAll() {
  const dirs: MemoryDir[] = []
  const items: MemoryItem[] = []
  for (const entry of await listDir(claudePath('projects'))) {
    if (!entry.isDirectory()) continue
    const loaded = await loadDir(entry.name)
    if (!loaded) continue
    dirs.push(loaded.dir)
    items.push(...loaded.items)
  }
  return { dirs, items }
}

export function readMemories(): Promise<{
  dirs: MemoryDir[]
  items: MemoryItem[]
}> {
  return cached('memories', TTL.config, loadAll)
}

/** One memory file's frontmatter and body, for the detail view. */
export async function readMemory(projectId: string, file: string) {
  if (
    projectId.includes('/') ||
    projectId.includes('..') ||
    file.includes('/') ||
    file.includes('..') ||
    !file.endsWith('.md')
  ) {
    return null
  }
  const full = claudePath('projects', projectId, 'memory', file)
  const fm = await readFrontmatter(full)
  if (!fm) return null
  return {
    projectId,
    file,
    path: full,
    frontmatter: fm.data,
    body: maskTokens(fm.body),
  }
}
