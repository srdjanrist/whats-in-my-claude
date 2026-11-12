import { Hono } from 'hono'
import { readDefinitions } from '../lib/agents.ts'
import { readClaudeJson } from '../lib/claude-json.ts'
import { readHooks } from '../lib/hooks.ts'
import { readInstructions } from '../lib/instructions.ts'
import { readMcpServers } from '../lib/mcp.ts'
import { readMemories } from '../lib/memories.ts'
import { tildify } from '../lib/paths.ts'
import { projectConfig } from '../lib/project-config.ts'
import { findProject, readProjects } from '../lib/projects.ts'
import { redactSettings } from '../lib/redact.ts'
import { setupContext } from '../lib/setup.ts'
import { readSkills } from '../lib/skills.ts'
import { cachedStats, getInventory, getListings } from '../lib/transcript/indexer.ts'

export const projectsRoute = new Hono()
  .get('/', async c => c.json({ projects: await readProjects() }))
  .get('/:id', async c => {
    const project = await findProject(c.req.param('id'))
    if (!project) return c.json({ error: 'not-found' as const }, 404)
    const { roots, plugins } = await setupContext()
    const subCounts = new Map<string, number>()
    for (const s of getInventory().subagents) subCounts.set(s.parentId, (subCounts.get(s.parentId) ?? 0) + 1)
    const sessions = getListings()
      .filter(l => l.projectDir === project.id)
      .map(l => {
        const stats = cachedStats(l)
        return {
          id: l.id,
          title: l.title,
          prompt: l.prompt,
          startedAt: l.startedAt,
          lastAt: l.lastAt,
          size: l.size,
          gitBranch: l.gitBranch,
          subagents: subCounts.get(l.id) ?? 0,
          tokens: stats?.tokens ?? null,
          prompts: stats?.humanPrompts ?? null,
          costUSD: stats?.cost?.costUSD ?? null,
        }
      })
    const memories = await readMemories()
    const path = project.path
    const config = path ? await projectConfig(path) : null
    const [instructions, mcp, defs, skills, hooks, claudeJson] = await Promise.all([
      readInstructions(roots),
      readMcpServers(plugins, roots),
      readDefinitions(plugins, roots),
      readSkills(plugins, roots),
      readHooks(plugins, roots),
      readClaudeJson(),
    ])
    const state = path ? claudeJson.projects[path] : undefined
    return c.json({
      project,
      sessions,
      memory: {
        dir: memories.dirs.find(d => d.projectId === project.id) ?? null,
        items: memories.items.filter(m => m.projectId === project.id),
      },
      config: {
        instructions: instructions.filter(i => i.project === path),
        settings: config?.settings ? redactSettings(config.settings) : null,
        settingsLocal: config?.settingsLocal ? redactSettings(config.settingsLocal) : null,
        mcp: mcp.filter(m => m.origin === path && (m.scope === 'project' || m.scope === 'local')),
        agents: defs.agents.filter(a => a.owner === path),
        commands: defs.commands.filter(a => a.owner === path),
        skills: skills.filter(s => s.owner === path),
        hooks: hooks.filter(h => h.origin === path),
        plugins: plugins
          .filter(p => p.projectPath === path || p.projectEnables.some(e => e.path === path))
          .map(p => ({
            id: p.id,
            name: p.name,
            enabled: p.projectEnables.find(e => e.path === path)?.enabled ?? null,
          })),
      },
      state: state
        ? {
            lastSessionId: state.lastSessionId,
            lastCost: state.lastCost,
            lastDuration: state.lastDuration,
            lastAPIDuration: state.lastAPIDuration,
            lastLinesAdded: state.lastLinesAdded,
            lastLinesRemoved: state.lastLinesRemoved,
            lastModelUsage: state.lastModelUsage,
            allowedTools: state.allowedTools,
            hasTrustDialogAccepted: state.hasTrustDialogAccepted,
          }
        : null,
      displayPath: path ? tildify(path) : project.id,
    })
  })
