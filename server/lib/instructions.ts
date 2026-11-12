// CLAUDE.md-style instruction files: the global ~/.claude/CLAUDE.md and the
// CLAUDE.md / AGENTS.md / CLAUDE.local.md at each known project root.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { lstatSafe, readText } from './fs.ts'
import { claudePath, tildify } from './paths.ts'
import { projectConfig } from './project-config.ts'
import { maskTokens } from './redact.ts'

export interface InstructionFile {
  path: string
  displayPath: string
  kind: string
  scope: 'global' | 'project'
  project: string | null
  bytes: number
  lines: number
  isSymlink: boolean
  imports: string[]
}

/** `@path` imports, ignoring fenced code (where `@Decorator()` is common) and email addresses. */
export function findImports(markdown: string): string[] {
  const out = new Set<string>()
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const stripped = line.replace(/`[^`]*`/g, '')
    for (const m of stripped.matchAll(/(?:^|\s)@([~./A-Za-z0-9_-][^\s()]*)/g)) {
      const target = (m[1] as string).replace(/[.,;:]+$/, '')
      if (target.includes('/') || /\.[A-Za-z0-9]+$/.test(target)) out.add(target)
    }
  }
  return [...out]
}

async function describe(file: string, kind: string, scope: InstructionFile['scope'], project: string | null) {
  const text = await readText(file)
  if (text === null) return null
  const l = await lstatSafe(file)
  return {
    path: file,
    displayPath: tildify(file),
    kind,
    scope,
    project,
    bytes: Buffer.byteLength(text),
    lines: text.split('\n').length,
    isSymlink: l?.isSymbolicLink() ?? false,
    imports: findImports(text),
  } satisfies InstructionFile
}

async function load(projectRoots: string[]): Promise<InstructionFile[]> {
  const out: InstructionFile[] = []
  const global = await describe(claudePath('CLAUDE.md'), 'CLAUDE.md', 'global', null)
  if (global) out.push(global)
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    for (const ref of cfg.instructions) {
      const f = await describe(ref.path, ref.kind, 'project', root)
      if (f) out.push(f)
    }
  }
  return out
}

export function readInstructions(projectRoots: string[]) {
  return cached('instructions', TTL.config * 3, () => load(projectRoots))
}

/** The content of a file from the list above (any other path is refused). */
export async function readInstructionContent(projectRoots: string[], file: string) {
  const known = (await readInstructions(projectRoots)).find(f => f.path === path.normalize(file))
  if (!known) return null
  const text = await readText(known.path)
  return text === null ? null : { ...known, content: maskTokens(text) }
}
