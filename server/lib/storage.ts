// Disk usage of ~/.claude, by top-level entry and by project folder, plus a
// list of things that are probably safe to clean up. Informational only:
// whats-in-my-claude never deletes anything. Sizes come from lstat alone; file
// contents (some of which are secrets) are never read here.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { dirSize, listDir, lstatSafe } from './fs.ts'
import { claudeDir, claudePath } from './paths.ts'
import { getInventory, listingOf } from './transcript/indexer.ts'

export interface StorageEntry {
  name: string
  kind: 'dir' | 'file' | 'symlink'
  bytes: number
  files: number
}

export interface CleanupCandidate {
  label: string
  detail: string
  bytes: number
  paths: string[]
}

export interface StorageReport {
  root: string
  total: number
  entries: StorageEntry[]
  projects: {
    dir: string
    bytes: number
    files: number
    transcripts: number
    hasMemory: boolean
  }[]
  largestTranscripts: { id: string; projectDir: string; bytes: number; title: string | null; subagent: boolean }[]
  cleanup: CleanupCandidate[]
  computedAt: number
}

async function load(): Promise<StorageReport> {
  const root = claudeDir()
  const entries: StorageEntry[] = []
  for (const entry of await listDir(root)) {
    const full = path.join(root, entry.name)
    if (entry.isSymbolicLink()) {
      entries.push({ name: entry.name, kind: 'symlink', bytes: 0, files: 0 })
      continue
    }
    const size = await dirSize(full)
    entries.push({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      ...size,
    })
  }
  entries.sort((a, b) => b.bytes - a.bytes)

  const inv = getInventory()
  const projects: StorageReport['projects'] = []
  for (const dir of inv.projectDirs) {
    const size = await dirSize(claudePath('projects', dir))
    const hasMemory = (await lstatSafe(claudePath('projects', dir, 'memory')))?.isDirectory() ?? false
    projects.push({
      dir,
      ...size,
      transcripts: inv.sessions.filter(s => s.projectDir === dir).length,
      hasMemory,
    })
  }
  projects.sort((a, b) => b.bytes - a.bytes)

  const cleanup: CleanupCandidate[] = []
  const backups = (await listDir(claudePath('backups'))).filter(e => e.name.startsWith('.claude.json.backup'))
  if (backups.length > 0) {
    let bytes = 0
    for (const b of backups) bytes += (await lstatSafe(claudePath('backups', b.name)))?.size ?? 0
    cleanup.push({
      label: '~/.claude.json backups',
      detail: `${backups.length} rolling copies of ~/.claude.json (each holds full account data). Claude Code rotates these itself.`,
      bytes,
      paths: backups.map(b => claudePath('backups', b.name)),
    })
  }
  for (const e of await listDir(claudePath('backups'))) {
    if (e.isDirectory()) {
      const size = await dirSize(claudePath('backups', e.name))
      cleanup.push({
        label: `Archived backup: ${e.name}`,
        detail: 'A folder of files moved aside by an uninstall.',
        bytes: size.bytes,
        paths: [claudePath('backups', e.name)],
      })
    }
  }
  for (const e of await listDir(root)) {
    if (/\.(bak|doctor-bak|backup)$/.test(e.name) || e.name.endsWith('-bak')) {
      cleanup.push({
        label: e.name,
        detail: 'An old settings backup.',
        bytes: (await lstatSafe(path.join(root, e.name)))?.size ?? 0,
        paths: [path.join(root, e.name)],
      })
    }
  }
  const empty = projects.filter(p => p.transcripts === 0 && !p.hasMemory)
  if (empty.length > 0) {
    cleanup.push({
      label: 'Project folders without transcripts or memory',
      detail: 'Their sessions were deleted; only an old index or empty folders are left.',
      bytes: empty.reduce((n, p) => n + p.bytes, 0),
      paths: empty.map(p => claudePath('projects', p.dir)),
    })
  }
  for (const name of ['file-history', 'shell-snapshots', 'paste-cache', 'session-env', 'debug']) {
    const e = entries.find(x => x.name === name)
    if (e && e.bytes > 0) {
      cleanup.push({
        label: `${name}/`,
        detail: 'Per-session working data; old entries are only needed to rewind or resume old sessions.',
        bytes: e.bytes,
        paths: [claudePath(name)],
      })
    }
  }

  return {
    root,
    total: entries.reduce((n, e) => n + e.bytes, 0),
    entries,
    projects,
    largestTranscripts: [...inv.sessions, ...inv.subagents]
      .sort((a, b) => b.size - a.size)
      .slice(0, 12)
      .map(s => {
        const subagent = 'agentId' in s
        return {
          id: s.id,
          projectDir: s.projectDir,
          bytes: s.size,
          subagent,
          title: subagent ? null : listingOf(s).title,
        }
      }),
    cleanup: cleanup.sort((a, b) => b.bytes - a.bytes),
    computedAt: Date.now(),
  }
}

export function readStorage(): Promise<StorageReport> {
  return cached('storage', TTL.storage, load)
}
