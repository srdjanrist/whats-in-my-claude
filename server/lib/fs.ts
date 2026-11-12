// Read-only filesystem helpers. Nothing here throws for a missing or
// unreadable file: callers get null / [] and carry on, because any part of
// a Claude setup may be absent. whats-in-my-claude never writes outside its own
// .cache dir, so there are deliberately no write helpers in this module.
import type { Dirent, Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Parses a JSON file. Claude Code rewrites some files (notably ~/.claude.json)
 * all the time, so a parse error gets one retry after a short pause before
 * it counts as a broken file.
 */
export async function readJson(file: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await readText(file)
    if (text === null) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      if (attempt === 0) await sleep(60)
    }
  }
  return null
}

export async function readJsonObj(file: string): Promise<Obj | null> {
  const value = await readJson(file)
  return isObj(value) ? value : null
}

export async function statSafe(file: string): Promise<Stats | null> {
  try {
    return await fs.stat(file)
  } catch {
    return null
  }
}

export async function lstatSafe(file: string): Promise<Stats | null> {
  try {
    return await fs.lstat(file)
  } catch {
    return null
  }
}

export async function exists(file: string): Promise<boolean> {
  return (await statSafe(file)) !== null
}

export async function isDir(file: string): Promise<boolean> {
  return (await statSafe(file))?.isDirectory() ?? false
}

export async function realpathSafe(file: string): Promise<string | null> {
  try {
    return await fs.realpath(file)
  } catch {
    return null
  }
}

export async function readlinkSafe(file: string): Promise<string | null> {
  try {
    return await fs.readlink(file)
  } catch {
    return null
  }
}

export async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Names of the entries of `dir` that are directories (following symlinks). */
export async function listSubdirs(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory()) out.push(entry.name)
    else if (entry.isSymbolicLink() && (await isDir(path.join(dir, entry.name)))) out.push(entry.name)
  }
  return out.sort()
}

/** Every file under `dir` whose name ends with `ext`, recursively, as paths relative to `dir`. */
export async function listFilesRecursive(dir: string, ext: string, depth = 4): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string, level: number) {
    for (const entry of await listDir(path.join(dir, rel))) {
      const child = rel ? path.join(rel, entry.name) : entry.name
      if (entry.isDirectory() && level < depth) await walk(child, level + 1)
      else if (entry.isFile() && entry.name.endsWith(ext)) out.push(child)
    }
  }
  await walk('', 0)
  return out.sort()
}

export interface Frontmatter {
  data: Obj
  body: string
}

/** Splits YAML frontmatter from a markdown file. Broken YAML gives empty data and the whole text as body. */
export function parseFrontmatter(text: string): Frontmatter {
  try {
    const parsed = matter(text)
    // Round-trip through JSON so YAML dates and the like become plain values.
    const data = JSON.parse(JSON.stringify(parsed.data ?? {})) as unknown
    return { data: isObj(data) ? data : {}, body: parsed.content }
  } catch {
    return { data: {}, body: text }
  }
}

export async function readFrontmatter(file: string): Promise<(Frontmatter & { bytes: number }) | null> {
  const text = await readText(file)
  if (text === null) return null
  return { ...parseFrontmatter(text), bytes: Buffer.byteLength(text) }
}

/** A frontmatter list that may be a YAML list, an inline array or a comma string. */
export function listField(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean)
  if (typeof v === 'string')
    return v
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  return []
}

export interface DirSize {
  bytes: number
  files: number
}

/** Total size of everything under `target`, without following symlinks. */
export async function dirSize(target: string): Promise<DirSize> {
  const stat = await lstatSafe(target)
  if (!stat) return { bytes: 0, files: 0 }
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1 }
  let bytes = 0
  let files = 0
  const stack = [target]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    for (const entry of await listDir(dir)) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        const s = await lstatSafe(full)
        if (s) {
          bytes += s.size
          files += 1
        }
      }
    }
  }
  return { bytes, files }
}

/** First markdown heading, if any. */
export function firstHeading(markdown: string): string | null {
  const match = /^#{1,3}\s+(.+?)\s*$/m.exec(markdown)
  return match?.[1] ?? null
}
