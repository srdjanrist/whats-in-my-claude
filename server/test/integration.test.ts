// End-to-end tests of the data layer and API against a generated fake home.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app.ts'
import { readMemories } from '../lib/memories.ts'
import { readProjects } from '../lib/projects.ts'
import { setupContext } from '../lib/setup.ts'
import { readSkills } from '../lib/skills.ts'
import { getListings, scanTranscripts, statsFor } from '../lib/transcript/indexer.ts'
import { computeStats } from '../lib/transcript/stats.ts'
import { readWarnings } from '../lib/warnings.ts'
import { createFixture, type Fixture, LEAK } from './fixture.ts'

let fx: Fixture
let cacheDir: string

beforeAll(() => {
  fx = createFixture()
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-in-my-claude-cache-'))
  process.env.WIMC_HOME = fx.home
  process.env.WIMC_CACHE_DIR = cacheDir
  delete process.env.CLAUDE_CONFIG_DIR
})

afterAll(() => {
  fx.cleanup()
  fs.rmSync(cacheDir, { recursive: true, force: true })
})

const get = (route: string, host = 'localhost:4317') => app.request(`http://localhost${route}`, { headers: { host } })

describe('transcripts', () => {
  it('finds sessions and subagents, not counting subagents as sessions', () => {
    const inv = scanTranscripts()
    expect(inv.sessions.map(s => s.id)).toEqual([fx.sessionId])
    expect(inv.subagents.map(s => s.agentId)).toEqual([fx.agentId])
    expect(inv.projectDirs).toContain('-old-deleted-proj')
  })

  it('reads the latest title, cwd and first prompt from the head and tail', () => {
    const [listing] = getListings()
    expect(listing?.title).toBe('Build and test the thing')
    expect(listing?.cwd).toBe(fx.project)
    expect(listing?.prompt).toBe('build the thing')
    expect(listing?.slug).toBe('brave-blue-fox')
  })

  it('counts tokens once per message id and skips api-request / synthetic lines', async () => {
    const file = path.join(fx.claude, 'projects', fx.projectDir, `${fx.sessionId}.jsonl`)
    const s = await computeStats(file)
    expect(s.assistantMessages).toBe(2) // msg_1 (two lines) + msg_2; the synthetic error is not a response
    expect(s.tokens).toEqual({ input: 20, output: 40, cacheRead: 200, cacheWrite: 10 })
    expect(s.models['claude-opus-5-5']?.messages).toBe(2)
    expect(s.models['<synthetic>']).toBeUndefined()
    expect(s.apiErrors).toBe(1)
    expect(s.humanPrompts).toBe(2)
    expect(s.toolCalls).toEqual({ Bash: 1 })
    expect(s.skippedLines).toBe(2)
    expect(s.workMs).toBe(60_000)
    expect(s.cost?.costUSD).toBe(0.5)
    expect(s.prLinks).toHaveLength(1)
  })
})

describe('setup', () => {
  it('merges projects from transcripts, ~/.claude.json and history, recovering paths', async () => {
    const projects = await readProjects()
    const acme = projects.find(p => p.path === fx.project)
    expect(acme?.sessionCount).toBe(1)
    expect(acme?.subagentCount).toBe(1)
    expect(acme?.memoryCount).toBe(2)
    expect(acme?.promptCount).toBe(2)
    expect(acme?.instructionFiles).toEqual(['CLAUDE.md', 'AGENTS.md'])
    expect(acme?.sources.sort()).toEqual(['claude-json', 'history', 'memory', 'transcripts'])
    // No transcripts left: the path comes from the legacy sessions-index.json.
    const old = projects.find(p => p.id === '-old-deleted-proj')
    expect(old?.path).toBe('/old/deleted/proj')
    expect(old?.exists).toBe(false)
  })

  it('labels symlinked skills and joins usage counts', async () => {
    const { plugins, roots } = await setupContext()
    const skills = await readSkills(plugins, roots)
    const linked = skills.find(s => s.source === 'user' && s.name === 'shared')
    expect(linked?.isSymlink).toBe(true)
    expect(linked?.duplicates).toBe(1) // also in ~/.agents/skills
    expect(skills.find(s => s.name === 'my-skill')?.usageCount).toBe(3)
    expect(skills.find(s => s.source === 'plugin')?.qualifiedName).toBe('demo:demo-skill')
  })

  it('cross-checks MEMORY.md against the memory files', async () => {
    const { dirs, items } = await readMemories()
    expect(dirs[0]?.dead).toEqual(['gone.md'])
    expect(dirs[0]?.orphans).toEqual(['fact-two.md'])
    expect(items.find(m => m.name === 'fact-two')?.type).toBe('project') // old top-level `type`
    expect(items.find(m => m.name === 'fact-one')?.brokenLinks).toEqual(['missing-one'])
  })

  it('warns about inline credentials, missing hook scripts and old plugin versions', async () => {
    const ids = (await readWarnings()).map(w => w.id)
    expect(ids).toContain(`mcp-secret:${fx.project}`)
    expect(ids.some(id => id.startsWith('hook-missing:'))).toBe(true)
    expect(ids).toContain('plugin-versions:demo@mkt')
    expect(ids).toContain('stats-cache-stale')
  })
})

describe('api', () => {
  it('refuses non-local hosts and origins, and anything but GET', async () => {
    expect((await get('/api/health', 'evil.example.com')).status).toBe(403)
    const origin = await app.request('http://localhost/api/health', {
      headers: { host: 'localhost:4317', origin: 'https://evil.example.com' },
    })
    expect(origin.status).toBe(403)
    const post = await app.request('http://localhost/api/health', {
      method: 'POST',
      headers: { host: '127.0.0.1:4317' },
    })
    expect(post.status).toBe(405)
    expect((await get('/api/health')).status).toBe(200)
  })

  it('refuses to read files that were not found by a scanner', async () => {
    expect((await get(`/api/instructions/content?path=${encodeURIComponent('/etc/passwd')}`)).status).toBe(404)
    expect((await get('/api/memories/..%2F..%2F/settings.json')).status).toBe(404)
    expect((await get('/api/plans/..%2Fsettings')).status).toBe(404)
  })

  it('never sends a secret value to the browser, from any route', async () => {
    const { sessionId, agentId, project } = fx
    const projects = (await (await get('/api/projects')).json()) as { projects: { id: string }[] }
    const skills = (await (await get('/api/skills')).json()) as { skills: { id: string }[] }
    const defs = (await (await get('/api/agents')).json()) as { agents: { id: string }[]; commands: { id: string }[] }
    const routes = [
      '/api/health',
      '/api/index/status',
      '/api/overview',
      '/api/projects',
      ...projects.projects.map(p => `/api/projects/${encodeURIComponent(p.id)}`),
      ...projects.projects.map(p => `/api/projects/${encodeURIComponent(p.id)}/graph`),
      '/api/sessions',
      `/api/sessions/${sessionId}`,
      `/api/sessions/${sessionId}/conversation?offset=0&limit=200`,
      `/api/sessions/${sessionId}/conversation?agent=${agentId}`,
      ...Array.from({ length: 8 }, (_, i) => `/api/sessions/${sessionId}/entry/${i}`),
      '/api/memories',
      `/api/memories/${fx.projectDir}/fact-one.md`,
      '/api/skills',
      ...skills.skills.map(s => `/api/skills/content?id=${encodeURIComponent(s.id)}`),
      '/api/agents',
      ...[...defs.agents, ...defs.commands].map(d => `/api/agents/content?id=${encodeURIComponent(d.id)}`),
      '/api/plugins',
      '/api/mcp',
      '/api/hooks',
      '/api/settings',
      '/api/instructions',
      `/api/instructions/content?path=${encodeURIComponent(path.join(project, 'CLAUDE.md'))}`,
      '/api/plans',
      '/api/plans/brave-blue-fox',
      '/api/history',
      '/api/storage',
      '/api/runtime',
      '/api/search?q=th',
      '/api/search?q=mcp',
    ]
    for (const route of routes) {
      const res = await get(route)
      const body = await res.text()
      expect(res.status, route).toBeLessThan(500)
      expect(
        body.includes(LEAK),
        `${route} leaked: ${body.slice(Math.max(0, body.indexOf(LEAK) - 80), body.indexOf(LEAK) + 40)}`,
      ).toBe(false)
    }
    // Key names are still visible.
    const mcp = await (await get('/api/mcp')).text()
    expect(mcp).toContain('OPENROUTER_API_KEY')
    expect(mcp).toContain('API_TOKEN')
  })

  it('maps what a project has configured against what its sessions used', async () => {
    const inv = scanTranscripts()
    for (const t of [...inv.sessions, ...inv.subagents]) await statsFor(t)
    const sub = await computeStats(inv.subagents[0]?.file ?? '')
    expect(sub.skillCalls).toEqual({ 'my-skill': 1 })
    expect(sub.agentCalls).toEqual({ helper: 1, Explore: 1 })
    expect(sub.commandCalls).toEqual({ '/ns:do': 1 })
    const res = await get(`/api/projects/${encodeURIComponent(fx.projectDir)}/graph`)
    expect(res.status).toBe(200)
    const map = (await res.json()) as {
      origins: { id: string; kind: string }[]
      items: {
        kind: string
        label: string
        origin: string
        enabled: boolean | null
        uses: number | null
        sessions: number
      }[]
      coverage: { transcripts: number; indexed: number }
    }
    const item = (kind: string, label: string) => map.items.find(i => i.kind === kind && i.label === label)
    expect(map.coverage).toMatchObject({ transcripts: 2, indexed: 2 })
    expect(map.origins.map(o => o.id)).toEqual([
      'user',
      'project',
      'local',
      'claude-ai',
      'plugin:demo@mkt',
      'builtin',
      'missing',
    ])
    // Subagent calls count toward their session: one session used each.
    expect(item('skill', 'my-skill')).toMatchObject({ origin: 'user', uses: 1, sessions: 1 })
    expect(item('mcp', 'search')).toMatchObject({ origin: 'user', uses: 2 })
    expect(item('mcp', 'demo')).toMatchObject({ origin: 'plugin:demo@mkt', uses: 1 })
    expect(item('agent', 'helper')).toMatchObject({ origin: 'user', uses: 1 })
    expect(item('command', '/ns:do')).toMatchObject({ origin: 'user', uses: 1 })
    // Configured, never used.
    expect(item('skill', 'demo-skill')).toMatchObject({ origin: 'plugin:demo@mkt', uses: 0, sessions: 0 })
    expect(item('mcp', 'zen')).toMatchObject({ origin: 'project', uses: 0, enabled: null })
    expect(item('mcp', 'remote')).toMatchObject({ origin: 'local', uses: 0 })
    expect(item('mcp', 'Gmail')).toMatchObject({ origin: 'claude-ai', uses: 0 })
    // Used, not in the setup.
    expect(item('mcp', 'gone')).toMatchObject({ origin: 'missing', uses: 1 })
    expect(item('agent', 'Explore')).toMatchObject({ origin: 'builtin', uses: 1 })
    // ~/.agents/skills only counts through its link in ~/.claude/skills.
    expect(map.items.filter(i => i.label === 'shared').map(i => i.origin)).toEqual(['user'])
    // Hooks can't be counted, and only their event and matcher are shown.
    const hooks = map.items.filter(i => i.kind === 'hook')
    expect(hooks.map(h => h.label).sort()).toEqual(['PreToolUse · Bash', 'SessionStart', 'Stop'])
    expect(hooks.every(h => h.uses === null)).toBe(true)
  })

  it('serves the conversation with responses grouped by message id', async () => {
    const page = (await (await get(`/api/sessions/${fx.sessionId}/conversation`)).json()) as {
      total: number
      entries: { kind: string; blocks?: { type: string }[] }[]
    }
    expect(page.entries.map(e => e.kind)).toEqual([
      'prompt',
      'assistant',
      'tool-result',
      'assistant',
      'prompt',
      'assistant',
    ])
    expect(page.entries[1]?.blocks?.map(b => b.type)).toEqual(['text', 'tool_use'])
  })
})
