// The map of one project: everything that applies to it, grouped by where it
// comes from, next to how often the project's sessions used it. A pure
// function over the readers' results and per-session stats, so the route only
// gathers inputs. It carries names and counts only: never commands, args, URLs
// or file contents.
import type { AgentItem, CommandItem } from './agents.ts'
import type { ProjectState } from './claude-json.ts'
import type { HookItem } from './hooks.ts'
import type { McpServerItem } from './mcp.ts'
import type { PluginItem } from './plugins.ts'
import type { SkillItem } from './skills.ts'
import type { SessionStats } from './transcript/stats.ts'

export type MapKind = 'mcp' | 'skill' | 'agent' | 'command' | 'hook'
export type OriginKind = 'user' | 'project' | 'local' | 'claude-ai' | 'plugin' | 'builtin' | 'missing'

export interface MapOrigin {
  id: string
  kind: OriginKind
  label: string
  /** Plugins: on here / switched off here. Other origins: null. */
  enabled: boolean | null
  /** Plugins: always-on context tokens, from the plugin catalog. */
  contextTokens: number | null
  /** Plugins: the plugin id (for its page). */
  pluginId: string | null
}

export interface MapItem {
  id: string
  kind: MapKind
  label: string
  origin: string
  /** false when switched off for this project; null when Claude Code would ask or can't tell. */
  enabled: boolean | null
  /** Its id on the Skills / Agents page, for skills, agents and commands in the setup. */
  ref: string | null
  /** Calls from this project's sessions; null when transcripts can't tell (hooks). */
  uses: number | null
  /** Sessions that used it at least once. */
  sessions: number
  lastUsedAt: number | null
}

export interface ProjectMapData {
  origins: MapOrigin[]
  items: MapItem[]
}

export interface MapInput {
  /** The project's folder. */
  path: string
  plugins: PluginItem[]
  mcp: McpServerItem[]
  skills: SkillItem[]
  agents: AgentItem[]
  commands: CommandItem[]
  hooks: HookItem[]
  state: ProjectState | undefined
  /** One entry per session, subagent transcripts already added into their session. */
  sessions: SessionStats[]
}

/** Agents and MCP servers that ship with Claude Code. */
const BUILTIN_AGENTS = new Set([
  'general-purpose',
  'Explore',
  'Plan',
  'fork',
  'statusline-setup',
  'claude-code-guide',
  'output-style-setup',
])
const BUILTIN_MCP = new Set(['ide', 'claude-in-chrome'])

const norm = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_')

/** The prefix of an MCP server's tool names: mcp__<server>__, or mcp__plugin_<plugin>_<server>__. */
export function mcpToolPrefix(server: string, plugin?: string): string {
  return plugin ? `mcp__plugin_${norm(plugin)}_${norm(server)}__` : `mcp__${norm(server)}__`
}

/** The server part of an MCP tool name (mcp__<server>__<tool>), or null. */
function mcpServerOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const end = tool.indexOf('__', 5)
  return end > 5 ? tool.slice(5, end) : null
}

/** A plugin's state in this project: true on, false switched off here, null not part of it. */
function pluginState(p: PluginItem, projectPath: string): boolean | null {
  if (p.scope !== 'user' && p.projectPath !== projectPath) return null
  const here = p.projectEnables.find(e => e.path === projectPath)?.enabled
  if (here !== undefined) return here
  return p.userEnabled === true ? true : null
}

const ORIGIN_ORDER: OriginKind[] = ['user', 'project', 'local', 'claude-ai', 'plugin', 'builtin', 'missing']
const ORIGIN_LABELS: Record<Exclude<OriginKind, 'plugin'>, string> = {
  user: '~/.claude',
  project: '.claude (project)',
  local: 'local scope',
  'claude-ai': 'claude.ai',
  builtin: 'Claude Code built-in',
  missing: 'Bundled or removed',
}

type Counter = (s: SessionStats) => number

export function buildProjectMap(input: MapInput): ProjectMapData {
  const { path: projectPath, state } = input
  const disabledMcp = new Set(state?.disabledMcpServers ?? [])

  const origins = new Map<string, MapOrigin>()
  const origin = (kind: Exclude<OriginKind, 'plugin'>): string => {
    if (!origins.has(kind))
      origins.set(kind, {
        id: kind,
        kind,
        label: ORIGIN_LABELS[kind],
        enabled: null,
        contextTokens: null,
        pluginId: null,
      })
    return kind
  }

  const plugins = new Map<string, { plugin: PluginItem; on: boolean; originId: string }>()
  for (const p of input.plugins) {
    const on = pluginState(p, projectPath)
    if (on === null) continue
    const originId = `plugin:${p.id}`
    plugins.set(p.id, { plugin: p, on, originId })
    origins.set(originId, {
      id: originId,
      kind: 'plugin',
      label: p.name,
      enabled: on,
      contextTokens: p.contextTokens?.alwaysOn ?? null,
      pluginId: p.id,
    })
  }

  const drafts: { item: Omit<MapItem, 'uses' | 'sessions' | 'lastUsedAt'>; count: Counter | null }[] = []
  const add = (item: (typeof drafts)[number]['item'], count: Counter | null) => drafts.push({ item, count })
  /** Where a component of a given source belongs, or null when it doesn't apply here. */
  const placeOf = (source: string, owner: string | null): { originId: string; enabled: boolean } | null => {
    if (source === 'user' || source === 'user-local') return { originId: origin('user'), enabled: true }
    if (source === 'claude-ai') return { originId: origin('claude-ai'), enabled: true }
    if (source === 'project' || source === 'project-local')
      return owner === projectPath ? { originId: origin('project'), enabled: true } : null
    if (source === 'plugin' && owner) {
      const p = plugins.get(owner)
      return p ? { originId: p.originId, enabled: p.on } : null
    }
    return null
  }

  // MCP servers
  const mcpPrefixes: string[] = []
  for (const m of input.mcp) {
    let originId: string
    let enabled: boolean | null
    let prefix: string
    if (m.scope === 'user') {
      originId = origin('user')
      enabled = !disabledMcp.has(m.name)
      prefix = mcpToolPrefix(m.name)
    } else if (m.scope === 'claude-ai') {
      originId = origin('claude-ai')
      enabled = disabledMcp.has(m.name) ? false : null
      prefix = mcpToolPrefix(m.name)
    } else if (m.scope === 'local' || m.scope === 'project') {
      if (m.origin !== projectPath) continue
      originId = origin(m.scope)
      enabled = disabledMcp.has(m.name) ? false : m.enabled
      prefix = mcpToolPrefix(m.name)
    } else {
      const p = plugins.get(m.origin)
      if (!p) continue
      originId = p.originId
      enabled = p.on && !disabledMcp.has(m.name) && !disabledMcp.has(`plugin:${p.plugin.name}:${m.name}`)
      prefix = mcpToolPrefix(m.name, p.plugin.name)
    }
    mcpPrefixes.push(prefix)
    add(
      {
        id: `mcp:${m.id}`,
        kind: 'mcp',
        label: m.name.replace(/^claude\.ai /, ''),
        origin: originId,
        enabled,
        ref: null,
      },
      s => {
        let n = 0
        for (const [tool, count] of Object.entries(s.toolCalls)) if (tool.startsWith(prefix)) n += count
        return n
      },
    )
  }

  // Skills (~/.agents/skills is only read through links into ~/.claude/skills, which list as user skills)
  const skillKeys = new Set<string>()
  for (const sk of input.skills) {
    if (sk.source === 'agents') continue
    const place = placeOf(sk.source, sk.owner)
    if (!place) continue
    const keys = [sk.qualifiedName]
    if ((sk.source === 'user' || sk.source === 'project') && sk.name !== sk.qualifiedName) keys.push(sk.name)
    for (const k of keys) skillKeys.add(k)
    add(
      {
        id: `skill:${sk.id}`,
        kind: 'skill',
        label: sk.name,
        origin: place.originId,
        enabled: place.enabled,
        ref: sk.id,
      },
      s => keys.reduce((n, k) => n + (s.skillCalls[k] ?? 0) + (s.commandCalls[`/${k}`] ?? 0), 0),
    )
  }

  // Agents
  const agentKeys = new Set<string>()
  for (const a of input.agents) {
    const place = placeOf(a.source, a.owner)
    if (!place) continue
    const p = a.source === 'plugin' && a.owner ? plugins.get(a.owner) : undefined
    const key = p ? `${p.plugin.name}:${a.name}` : a.name
    agentKeys.add(key)
    add(
      { id: `agent:${a.id}`, kind: 'agent', label: a.name, origin: place.originId, enabled: place.enabled, ref: a.id },
      s => s.agentCalls[key] ?? 0,
    )
  }

  // Commands (built-in slash commands aren't in the setup and are left out)
  for (const c of input.commands) {
    const place = placeOf(c.source, c.owner)
    if (!place) continue
    add(
      {
        id: `command:${c.id}`,
        kind: 'command',
        label: c.name,
        origin: place.originId,
        enabled: place.enabled,
        ref: c.id,
      },
      s => s.commandCalls[c.name] ?? 0,
    )
  }

  // Hooks
  for (const h of input.hooks) {
    const place = placeOf(h.source, h.origin)
    if (!place) continue
    add(
      {
        id: `hook:${h.id}`,
        kind: 'hook',
        label: h.matcher ? `${h.event} · ${h.matcher}` : h.event,
        origin: place.originId,
        enabled: place.enabled && h.enabled,
        ref: null,
      },
      null,
    )
  }

  // Called by this project's sessions but not in its setup: built-ins, bundled skills, removed things.
  const usedMcp = new Set<string>()
  const usedSkills = new Set<string>()
  const usedAgents = new Set<string>()
  for (const s of input.sessions) {
    for (const tool of Object.keys(s.toolCalls)) {
      const server = mcpServerOf(tool)
      if (server && !mcpPrefixes.some(p => tool.startsWith(p))) usedMcp.add(server)
    }
    for (const k of Object.keys(s.skillCalls)) if (!skillKeys.has(k)) usedSkills.add(k)
    for (const k of Object.keys(s.agentCalls)) if (!agentKeys.has(k)) usedAgents.add(k)
  }
  for (const server of usedMcp) {
    const prefix = `mcp__${server}__`
    add(
      {
        id: `mcp:gone:${server}`,
        kind: 'mcp',
        label: server,
        origin: origin(BUILTIN_MCP.has(server) ? 'builtin' : 'missing'),
        enabled: null,
        ref: null,
      },
      s => {
        let n = 0
        for (const [tool, count] of Object.entries(s.toolCalls)) if (tool.startsWith(prefix)) n += count
        return n
      },
    )
  }
  for (const k of usedSkills)
    add(
      { id: `skill:gone:${k}`, kind: 'skill', label: k, origin: origin('missing'), enabled: null, ref: null },
      s => s.skillCalls[k] ?? 0,
    )
  for (const k of usedAgents)
    add(
      {
        id: `agent:gone:${k}`,
        kind: 'agent',
        label: k,
        origin: origin(BUILTIN_AGENTS.has(k) ? 'builtin' : 'missing'),
        enabled: null,
        ref: null,
      },
      s => s.agentCalls[k] ?? 0,
    )

  const items: MapItem[] = drafts.map(({ item, count }) => {
    if (!count) return { ...item, uses: null, sessions: 0, lastUsedAt: null }
    let uses = 0
    let sessions = 0
    let lastUsedAt: number | null = null
    for (const s of input.sessions) {
      const n = count(s)
      if (n === 0) continue
      uses += n
      sessions++
      if (s.lastAt !== null && (lastUsedAt === null || s.lastAt > lastUsedAt)) lastUsedAt = s.lastAt
    }
    return { ...item, uses, sessions, lastUsedAt }
  })

  const rank = (o: MapOrigin) => ORIGIN_ORDER.indexOf(o.kind)
  const usesOf = (id: string) => items.reduce((n, i) => n + (i.origin === id ? (i.uses ?? 0) : 0), 0)
  const sorted = [...origins.values()]
    .filter(o => o.kind === 'plugin' || items.some(i => i.origin === o.id))
    .sort((a, b) => rank(a) - rank(b) || usesOf(b.id) - usesOf(a.id) || a.label.localeCompare(b.label))
  return { origins: sorted, items }
}
