// Subagent definitions and slash commands: markdown files with frontmatter,
// from ~/.claude/{agents,commands}, installed plugins, and projects'
// .claude/{agents,commands}. Nested command folders are namespaces
// (commands/infra/validate.md → /infra:validate).
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { isDir, listField, listFilesRecursive, readFrontmatter, str } from './fs.ts'
import { claudePath } from './paths.ts'
import type { PluginItem } from './plugins.ts'
import { projectConfig } from './project-config.ts'

export type DefinitionSource = 'user' | 'plugin' | 'project'

export interface AgentItem {
  id: string
  name: string
  description: string | null
  model: string | null
  tools: string[]
  color: string | null
  source: DefinitionSource
  owner: string | null
  file: string
  bytes: number
}

export interface CommandItem {
  id: string
  name: string
  description: string | null
  argumentHint: string | null
  allowedTools: string[]
  model: string | null
  source: DefinitionSource
  owner: string | null
  file: string
}

/** Descriptions sometimes carry escaped newlines and <example> blocks: keep the first paragraph. */
export function shortDescription(d: string | null, max = 400): string | null {
  if (!d) return null
  const text =
    d
      .replace(/\\n/g, '\n')
      .split(/\n\s*\n|<example>/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function readAgents(dir: string, source: DefinitionSource, owner: string | null): Promise<AgentItem[]> {
  if (!(await isDir(dir))) return []
  const out: AgentItem[] = []
  for (const rel of await listFilesRecursive(dir, '.md', 2)) {
    const file = path.join(dir, rel)
    const fm = await readFrontmatter(file)
    if (!fm || path.basename(file).startsWith('_')) continue
    const name = str(fm.data.name) ?? path.basename(rel, '.md')
    out.push({
      id: `${source}:${owner ?? ''}:${rel}`,
      name,
      description: shortDescription(str(fm.data.description)),
      model: str(fm.data.model),
      tools: listField(fm.data.tools),
      color: str(fm.data.color),
      source,
      owner,
      file,
      bytes: fm.bytes,
    })
  }
  return out
}

async function readCommands(
  dir: string,
  source: DefinitionSource,
  owner: string | null,
  prefix = '',
): Promise<CommandItem[]> {
  if (!(await isDir(dir))) return []
  const out: CommandItem[] = []
  for (const rel of await listFilesRecursive(dir, '.md', 3)) {
    const file = path.join(dir, rel)
    if (path.basename(file).startsWith('_') || path.basename(file) === 'README.md') continue
    const fm = await readFrontmatter(file)
    if (!fm) continue
    const namespaced = rel.replace(/\.md$/, '').split(path.sep).join(':')
    out.push({
      id: `${source}:${owner ?? ''}:${rel}`,
      name: `/${prefix}${str(fm.data.name) ?? namespaced}`,
      description: shortDescription(str(fm.data.description), 300),
      argumentHint: str(fm.data['argument-hint']),
      allowedTools: listField(fm.data['allowed-tools']),
      model: str(fm.data.model),
      source,
      owner,
      file,
    })
  }
  return out
}

async function load(plugins: PluginItem[], projectRoots: string[]) {
  const agents: AgentItem[] = [...(await readAgents(claudePath('agents'), 'user', null))]
  const commands: CommandItem[] = [...(await readCommands(claudePath('commands'), 'user', null))]
  for (const plugin of plugins) {
    for (const a of plugin.components.agents) {
      const [item] = await readAgents(path.dirname(a.file), 'plugin', plugin.id).then(list =>
        list.filter(x => x.file === a.file),
      )
      if (item) agents.push(item)
    }
    for (const c of plugin.components.commands) {
      commands.push({
        id: `plugin:${plugin.id}:${c.file}`,
        name: `/${plugin.name}:${c.name}`,
        description: shortDescription(c.description, 300),
        argumentHint: null,
        allowedTools: [],
        model: null,
        source: 'plugin',
        owner: plugin.id,
        file: c.file,
      })
    }
  }
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    if (cfg.agentsDir) agents.push(...(await readAgents(cfg.agentsDir, 'project', root)))
    if (cfg.commandsDir) commands.push(...(await readCommands(cfg.commandsDir, 'project', root)))
  }
  return { agents, commands }
}

export function readDefinitions(plugins: PluginItem[], projectRoots: string[]) {
  return cached('definitions', TTL.config * 3, () => load(plugins, projectRoots))
}
