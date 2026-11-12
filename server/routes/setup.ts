// The configuration views: memories, skills, agents & commands, plugins, MCP,
// hooks, settings, instructions, plans.
import { Hono } from 'hono'
import { readDefinitions } from '../lib/agents.ts'
import { readFrontmatter } from '../lib/fs.ts'
import { readHookActivity, readHooks } from '../lib/hooks.ts'
import { readInstructionContent, readInstructions } from '../lib/instructions.ts'
import { readMcpServers } from '../lib/mcp.ts'
import { readMemories, readMemory } from '../lib/memories.ts'
import { tildify } from '../lib/paths.ts'
import { readPlan, readPlans } from '../lib/plans.ts'
import { maskTokens } from '../lib/redact.ts'
import { readPermissions, readUserSettings } from '../lib/settings.ts'
import { setupContext } from '../lib/setup.ts'
import { readSkills } from '../lib/skills.ts'
import { query, z } from './util.ts'

const byId = query(z.object({ id: z.string() }))

/** Reads a markdown file that was found by one of the scanners (never an arbitrary path). */
async function markdownView(file: string) {
  const fm = await readFrontmatter(file)
  if (!fm) return null
  return {
    file: tildify(file),
    frontmatter: JSON.parse(maskTokens(JSON.stringify(fm.data))) as unknown,
    body: maskTokens(fm.body),
  }
}

export const setupRoute = new Hono()
  .get('/memories', async c => {
    const [{ dirs, items }, { projects }] = await Promise.all([readMemories(), setupContext()])
    const names = new Map(projects.map(p => [p.id, p.displayPath]))
    return c.json({
      dirs: dirs.map(d => ({
        ...d,
        dir: tildify(d.dir),
        project: names.get(d.projectId) ?? d.projectId,
      })),
      items: items.map(m => ({
        ...m,
        project: names.get(m.projectId) ?? m.projectId,
      })),
    })
  })
  .get('/memories/:projectId/:file', async c => {
    const memory = await readMemory(c.req.param('projectId'), c.req.param('file'))
    if (!memory) return c.json({ error: 'not-found' as const }, 404)
    return c.json({ ...memory, path: tildify(memory.path) })
  })
  .get('/skills', async c => {
    const { plugins, roots } = await setupContext()
    const skills = await readSkills(plugins, roots)
    return c.json({
      skills: skills.map(s => ({
        ...s,
        dir: tildify(s.dir),
        file: tildify(s.file),
        realPath: s.realPath ? tildify(s.realPath) : null,
        owner: s.owner && s.source === 'project' ? tildify(s.owner) : s.owner,
      })),
    })
  })
  .get('/skills/content', byId, async c => {
    const { plugins, roots } = await setupContext()
    const { id } = c.req.valid('query')
    const skill = (await readSkills(plugins, roots)).find(s => s.id === id)
    const view = skill ? await markdownView(skill.file) : null
    return view ? c.json(view) : c.json({ error: 'not-found' as const }, 404)
  })
  .get('/agents', async c => {
    const { plugins, roots } = await setupContext()
    const { agents, commands } = await readDefinitions(plugins, roots)
    const display = <T extends { file: string; owner: string | null; source: string }>(x: T) => ({
      ...x,
      file: tildify(x.file),
      owner: x.owner && x.source === 'project' ? tildify(x.owner) : x.owner,
    })
    return c.json({
      agents: agents.map(display),
      commands: commands.map(display),
    })
  })
  .get('/agents/content', byId, async c => {
    const { plugins, roots } = await setupContext()
    const { agents, commands } = await readDefinitions(plugins, roots)
    const { id } = c.req.valid('query')
    const item = agents.find(a => a.id === id) ?? commands.find(a => a.id === id)
    const view = item ? await markdownView(item.file) : null
    return view ? c.json(view) : c.json({ error: 'not-found' as const }, 404)
  })
  .get('/plugins', async c => {
    const { plugins, marketplaces } = await setupContext()
    return c.json({
      plugins: plugins.map(p => ({
        ...p,
        installPath: p.installPath ? tildify(p.installPath) : null,
      })),
      marketplaces,
    })
  })
  .get('/mcp', async c => {
    const { plugins, roots } = await setupContext()
    const servers = await readMcpServers(plugins, roots)
    return c.json({
      servers: servers.map(s => ({ ...s, origin: tildify(s.origin) })),
    })
  })
  .get('/hooks', async c => {
    const { plugins, roots } = await setupContext()
    const [hooks, activity] = await Promise.all([readHooks(plugins, roots), readHookActivity()])
    return c.json({
      hooks: hooks.map(h => ({ ...h, origin: tildify(h.origin) })),
      activity,
    })
  })
  .get('/settings', async c => {
    const { roots } = await setupContext()
    const [files, permissions] = await Promise.all([readUserSettings(), readPermissions(roots)])
    return c.json({
      files: files.map(f => ({ ...f, path: tildify(f.path) })),
      permissions: {
        ...permissions,
        rules: permissions.rules.map(r => ({
          ...r,
          projects: r.projects.map(tildify),
        })),
        defaultModes: permissions.defaultModes.map(d => ({
          ...d,
          path: tildify(d.path),
        })),
        additionalDirectories: permissions.additionalDirectories.map(d => ({
          ...d,
          path: tildify(d.path),
        })),
      },
    })
  })
  .get('/instructions', async c => {
    const { roots } = await setupContext()
    const files = await readInstructions(roots)
    return c.json({
      files: files.map(f => ({
        ...f,
        project: f.project ? tildify(f.project) : null,
      })),
    })
  })
  .get('/instructions/content', query(z.object({ path: z.string() })), async c => {
    const { roots } = await setupContext()
    const file = await readInstructionContent(roots, c.req.valid('query').path)
    return file ? c.json(file) : c.json({ error: 'not-found' as const }, 404)
  })
  .get('/plans', async c =>
    c.json({
      plans: (await readPlans()).map(p => ({ ...p, file: tildify(p.file) })),
    }),
  )
  .get('/plans/:slug', async c => {
    const plan = await readPlan(c.req.param('slug'))
    return plan ? c.json({ ...plan, file: tildify(plan.file) }) : c.json({ error: 'not-found' as const }, 404)
  })
