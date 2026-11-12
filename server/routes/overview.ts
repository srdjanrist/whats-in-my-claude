import { Hono } from 'hono'
import { readDefinitions } from '../lib/agents.ts'
import { readClaudeJson } from '../lib/claude-json.ts'
import { readJsonObj, str } from '../lib/fs.ts'
import { historyByDay, readHistory, searchHistory } from '../lib/history.ts'
import { readHooks } from '../lib/hooks.ts'
import { readInstructions } from '../lib/instructions.ts'
import { readMcpServers } from '../lib/mcp.ts'
import { readMemories } from '../lib/memories.ts'
import { claudePath, tildify } from '../lib/paths.ts'
import { readPlans } from '../lib/plans.ts'
import { readRuntime } from '../lib/runtime.ts'
import { setupContext } from '../lib/setup.ts'
import { readSkills } from '../lib/skills.ts'
import { readStorage } from '../lib/storage.ts'
import { cachedStats, ensureIndexing, getInventory, getListings, indexStatus } from '../lib/transcript/indexer.ts'
import { addStats, emptyStats } from '../lib/transcript/stats.ts'
import { readWarnings } from '../lib/warnings.ts'
import { int, query, z } from './util.ts'

const DAY = 86_400_000

export const overviewRoute = new Hono()
  .get('/index/status', c => {
    ensureIndexing()
    return c.json(indexStatus())
  })
  .get('/overview', async c => {
    ensureIndexing()
    const { projects, roots, plugins, marketplaces } = await setupContext()
    const [
      memories,
      skills,
      defs,
      mcp,
      hooks,
      instructions,
      plans,
      history,
      days,
      runtime,
      warnings,
      claudeJson,
      storage,
    ] = await Promise.all([
      readMemories(),
      readSkills(plugins, roots),
      readDefinitions(plugins, roots),
      readMcpServers(plugins, roots),
      readHooks(plugins, roots),
      readInstructions(roots),
      readPlans(),
      readHistory(),
      historyByDay(),
      readRuntime(),
      readWarnings(),
      readClaudeJson(),
      readStorage(),
    ])
    const inv = getInventory()

    // Totals over everything indexed so far (sessions + subagents).
    const totals = emptyStats()
    let indexed = 0
    for (const t of [...inv.sessions, ...inv.subagents]) {
      const s = cachedStats(t)
      if (!s) continue
      indexed++
      addStats(totals, s)
    }

    const statsCache = await readJsonObj(claudePath('stats-cache.json'))
    const since = Date.now() - 371 * DAY
    return c.json({
      counts: {
        projects: projects.length,
        projectsOnDisk: projects.filter(p => p.exists).length,
        projectsWithSessions: projects.filter(p => p.sessionCount > 0).length,
        sessions: inv.sessions.length,
        subagents: inv.subagents.length,
        memories: memories.items.length,
        memoryDirs: memories.dirs.length,
        skills: skills.length,
        uniqueSkills: new Set(skills.map(s => s.name)).size,
        agents: defs.agents.length,
        commands: defs.commands.length,
        plugins: plugins.length,
        pluginsEnabled: plugins.filter(p => p.enabled).length,
        marketplaces: marketplaces.length,
        mcpServers: mcp.length,
        hooks: hooks.length,
        hookEvents: new Set(hooks.map(h => h.event)).size,
        instructionFiles: instructions.length,
        plans: plans.length,
        prompts: history.length,
      },
      activity: Object.entries(days)
        .filter(([day]) => Date.parse(day) >= since)
        .map(([day, count]) => ({ day, count })),
      tokens: {
        indexedFiles: indexed,
        totalFiles: inv.sessions.length + inv.subagents.length,
        totals: totals.tokens,
        byModel: Object.entries(totals.models)
          .map(([model, m]) => ({ model, ...m }))
          .sort((a, b) => b.output - a.output),
        topTools: Object.entries(totals.toolCalls)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([tool, count]) => ({ tool, count })),
        prompts: totals.humanPrompts,
        workMs: totals.workMs,
      },
      storage: {
        total: storage.total,
        entries: storage.entries.slice(0, 10).map(e => ({ name: e.name, bytes: e.bytes })),
      },
      recentSessions: getListings()
        .slice(0, 8)
        .map(l => ({
          id: l.id,
          title: l.title,
          cwd: l.cwd ? tildify(l.cwd) : null,
          lastAt: l.lastAt,
          size: l.size,
        })),
      running: runtime.sessions.filter(s => s.alive),
      warnings,
      install: {
        numStartups: claudeJson.numStartups,
        firstStartTime: claudeJson.firstStartTime,
        installMethod: claudeJson.installMethod,
        latestVersion: getListings().find(l => l.version)?.version ?? null,
      },
      claudeStatsCache: statsCache
        ? {
            lastComputedDate: str(statsCache.lastComputedDate),
            totalSessions: typeof statsCache.totalSessions === 'number' ? statsCache.totalSessions : null,
            totalMessages: typeof statsCache.totalMessages === 'number' ? statsCache.totalMessages : null,
          }
        : null,
    })
  })
  .get(
    '/history',
    query(
      z.object({
        q: z.string().optional(),
        project: z.string().optional(),
        limit: int(50, 1, 200),
        offset: int(0, 0, 1_000_000),
      }),
    ),
    async c => {
      const params = c.req.valid('query')
      const result = await searchHistory({
        ...params,
        project: params.project || undefined,
      })
      const projects = new Map<string, number>()
      for (const e of await readHistory()) if (e.project) projects.set(e.project, (projects.get(e.project) ?? 0) + 1)
      return c.json({
        ...result,
        items: result.items.map(i => ({
          ...i,
          displayProject: i.project ? tildify(i.project) : null,
        })),
        projects: [...projects.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([path, count]) => ({ path, display: tildify(path), count })),
      })
    },
  )
  .get('/storage', async c => {
    const s = await readStorage()
    return c.json({
      ...s,
      root: tildify(s.root),
      cleanup: s.cleanup.map(x => ({ ...x, paths: x.paths.map(tildify) })),
    })
  })
  .get('/runtime', async c => c.json(await readRuntime()))
