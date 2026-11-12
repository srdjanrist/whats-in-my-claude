// Skills come from five places: ~/.claude/skills, ~/.agents/skills (the
// `skills` CLI, with a lock file), claude.ai-synced skills under
// ~/.claude/skills/synced/<id>/, installed plugins, and projects'
// .claude/skills. The same skill is often present in several (as a symlink or
// as a copy), so each one records whether it is a symlink, its real path, and
// how many other locations carry a skill of the same name.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { readClaudeJson } from './claude-json.ts'
import {
  isObj,
  listDir,
  listField,
  listSubdirs,
  lstatSafe,
  readFrontmatter,
  readJsonObj,
  readlinkSafe,
  realpathSafe,
  str,
} from './fs.ts'
import { agentsDir, claudePath } from './paths.ts'
import type { PluginItem } from './plugins.ts'
import { projectConfig } from './project-config.ts'

export type SkillSource = 'user' | 'agents' | 'claude-ai' | 'plugin' | 'project'

export interface SkillItem {
  id: string
  name: string
  /** How Claude Code refers to it: plugin:skill, anthropic-skills:name, or the bare name. */
  qualifiedName: string
  description: string | null
  source: SkillSource
  /** The plugin id or project path it belongs to. */
  owner: string | null
  dir: string
  file: string
  isSymlink: boolean
  symlinkTarget: string | null
  realPath: string | null
  broken: boolean
  /** Other locations holding a skill with the same name. */
  duplicates: number
  extras: string[]
  fileCount: number
  allowedTools: string[]
  version: string | null
  license: string | null
  userInvocable: boolean | null
  usageCount: number
  lastUsedAt: number | null
  lock: {
    source: string | null
    sourceUrl: string | null
    installedAt: string | null
    updatedAt: string | null
  } | null
}

async function countFiles(dir: string, depth = 3): Promise<{ files: number; extras: string[] }> {
  let files = 0
  const extras: string[] = []
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory()) {
      extras.push(entry.name)
      if (depth > 0) files += (await countFiles(path.join(dir, entry.name), depth - 1)).files
    } else if (entry.isFile()) files++
  }
  return { files, extras: extras.sort() }
}

async function readSkill(
  dir: string,
  source: SkillSource,
  owner: string | null,
  qualify: (name: string) => string,
): Promise<SkillItem | null> {
  const l = await lstatSafe(dir)
  if (!l) return null
  const isSymlink = l.isSymbolicLink()
  const realPath = await realpathSafe(dir)
  const file = path.join(dir, 'SKILL.md')
  const fm = await readFrontmatter(file)
  const dirName = path.basename(dir)
  if (!fm && !isSymlink) return null
  const name = str(fm?.data.name) ?? dirName
  const { files, extras } = realPath ? await countFiles(realPath) : { files: 0, extras: [] }
  const d = fm?.data ?? {}
  const metadata = isObj(d.metadata) ? d.metadata : {}
  return {
    id: `${source}:${owner ?? ''}:${dirName}`,
    name,
    qualifiedName: qualify(name),
    description: str(d.description),
    source,
    owner,
    dir,
    file,
    isSymlink,
    symlinkTarget: isSymlink ? await readlinkSafe(dir) : null,
    realPath,
    broken: realPath === null || fm === null,
    duplicates: 0,
    extras,
    fileCount: files,
    allowedTools: listField(d['allowed-tools']),
    version: str(d.version) ?? str(metadata.version),
    license: str(d.license),
    userInvocable: typeof d['user-invocable'] === 'boolean' ? (d['user-invocable'] as boolean) : null,
    usageCount: 0,
    lastUsedAt: null,
    lock: null,
  }
}

async function readSkillsDir(
  dir: string,
  source: SkillSource,
  owner: string | null,
  qualify: (name: string) => string,
  skip: string[] = [],
): Promise<SkillItem[]> {
  const out: SkillItem[] = []
  for (const entry of await listDir(dir)) {
    if (skip.includes(entry.name) || entry.name.startsWith('.')) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const skill = await readSkill(path.join(dir, entry.name), source, owner, qualify)
    if (skill) out.push(skill)
  }
  return out
}

async function load(plugins: PluginItem[], projectRoots: string[]): Promise<SkillItem[]> {
  const bare = (n: string) => n
  const skills: SkillItem[] = []

  skills.push(...(await readSkillsDir(claudePath('skills'), 'user', null, bare, ['synced'])))

  const lock = await readJsonObj(path.join(agentsDir(), '.skill-lock.json'))
  const lockSkills = isObj(lock?.skills) ? lock.skills : {}
  for (const s of await readSkillsDir(path.join(agentsDir(), 'skills'), 'agents', null, bare)) {
    const l = lockSkills[path.basename(s.dir)]
    if (isObj(l)) {
      s.lock = {
        source: str(l.source),
        sourceUrl: str(l.sourceUrl),
        installedAt: str(l.installedAt),
        updatedAt: str(l.updatedAt),
      }
    }
    skills.push(s)
  }

  // claude.ai-synced skills: skills/synced/<bucket>/<skill>/SKILL.md, with a manifest.
  for (const bucket of await listSubdirs(claudePath('skills', 'synced'))) {
    const dir = claudePath('skills', 'synced', bucket)
    const manifest = await readJsonObj(path.join(dir, 'manifest.json'))
    const descriptions = new Map<string, string>()
    for (const m of Array.isArray(manifest?.skills) ? manifest.skills : []) {
      if (isObj(m) && str(m.name) && str(m.description)) descriptions.set(m.name as string, m.description as string)
    }
    for (const s of await readSkillsDir(dir, 'claude-ai', 'claude.ai', n => `anthropic-skills:${n}`)) {
      s.description ??= descriptions.get(s.name) ?? null
      skills.push(s)
    }
  }

  for (const plugin of plugins) {
    for (const c of plugin.components.skills) {
      const s = await readSkill(path.dirname(c.file), 'plugin', plugin.id, n => `${plugin.name}:${n}`)
      if (s) skills.push(s)
    }
  }

  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    if (cfg.skillsDir) skills.push(...(await readSkillsDir(cfg.skillsDir, 'project', root, bare)))
  }

  // Duplicates: same name in more than one location (a symlink to another one counts too).
  const byName = new Map<string, number>()
  for (const s of skills) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  const usage = (await readClaudeJson()).skillUsage
  for (const s of skills) {
    s.duplicates = (byName.get(s.name) ?? 1) - 1
    const u = usage[s.qualifiedName] ?? (s.source !== 'plugin' && s.source !== 'claude-ai' ? usage[s.name] : undefined)
    if (u) {
      s.usageCount = u.usageCount
      s.lastUsedAt = u.lastUsedAt
    }
  }
  return skills
}

export function readSkills(plugins: PluginItem[], projectRoots: string[]): Promise<SkillItem[]> {
  return cached('skills', TTL.config * 3, () => load(plugins, projectRoots))
}
