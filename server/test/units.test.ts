import { describe, expect, it } from 'vitest'
import { isLocalHost, isLocalOrigin } from '../app.ts'
import { mcpToolPrefix } from '../lib/graph.ts'
import { findImports } from '../lib/instructions.ts'
import { encodeProjectDir } from '../lib/paths.ts'
import {
  inlineSecrets,
  maskTokens,
  mcpServerView,
  REDACTED,
  redactArgs,
  redactSettings,
  redactUrl,
} from '../lib/redact.ts'
import { buildSessionMap, type MapAgentInput } from '../lib/session-map.ts'
import { commandName, isHumanPrompt } from '../lib/transcript/prompts.ts'
import { parseRecord, type UserRecord } from '../lib/transcript/records.ts'
import { emptyStats } from '../lib/transcript/stats.ts'
import type { AgentMeta } from '../lib/transcript/subagents.ts'
import {
  emptyTimeline,
  type FileEvent,
  type FileKind,
  mergeTimes,
  parseFileHistory,
  type Timeline,
} from '../lib/transcript/timeline.ts'
import { hookScripts } from '../lib/warnings.ts'

describe('redaction', () => {
  it('masks well-known token shapes in free text', () => {
    const text = maskTokens('key sk-ant-api03-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuvwxyz123456 ok')
    expect(text).not.toContain('abcdefghijklmnop1234')
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz')
    expect(maskTokens('OPENAI_API_KEY=hunter2hunter2')).toBe(`OPENAI_API_KEY=${REDACTED}`)
    expect(maskTokens('curl -H "Authorization: Bearer abc.def.ghi"')).toContain(`Bearer ${REDACTED}`)
    expect(maskTokens('plain text stays')).toBe('plain text stays')
  })

  it('masks secret args but keeps ordinary ones', () => {
    expect(redactArgs(['-y', 'server', '--api-key', 'abc123', '--token=xyz', 'API_KEY=foo'])).toEqual([
      '-y',
      'server',
      '--api-key',
      REDACTED,
      `--token=${REDACTED}`,
      `API_KEY=${REDACTED}`,
    ])
    expect(redactArgs(['@playwright/mcp@latest'])).toEqual(['@playwright/mcp@latest'])
  })

  it('masks URL credentials and query values', () => {
    const url = redactUrl('https://user:pw@host.example.com/mcp?token=abc&x=1')
    expect(url).not.toContain('pw@')
    expect(url).not.toContain('abc')
    expect(url).toContain('host.example.com/mcp')
  })

  it('reports inline secrets but not ${VAR} references', () => {
    expect(
      inlineSecrets({
        env: { OPENROUTER_API_KEY: 'sk-or-v1-0000000000000000000000', MODE: 'fast', TOKEN: '${TOKEN}' },
      }),
    ).toEqual([{ key: 'OPENROUTER_API_KEY', field: 'env' }])
  })

  it('keeps env key names and drops their values', () => {
    const view = mcpServerView('x', { command: 'npx', env: { A_KEY: 'secret', B: 'plain' } })
    expect(view.envKeys).toEqual(['A_KEY', 'B'])
    expect(JSON.stringify(view)).not.toContain('secret')
    expect(view.transport).toBe('stdio')
  })

  it('redacts env maps and secret-named fields in settings', () => {
    expect(
      redactSettings({ env: { X: 'y' }, apiToken: 'abc', apiKeyHelper: '/bin/key', nested: [{ password: 'p' }] }),
    ).toEqual({
      env: { X: REDACTED },
      apiToken: REDACTED,
      apiKeyHelper: '/bin/key',
      nested: [{ password: REDACTED }],
    })
  })
})

describe('parsing', () => {
  it('encodes project paths the way Claude Code names transcript folders', () => {
    expect(encodeProjectDir('/Users/me/.claude')).toBe('-Users-me--claude')
    expect(encodeProjectDir('/Users/me/my_app v2')).toBe('-Users-me-my-app-v2')
  })

  it('finds @imports outside code fences only', () => {
    expect(findImports('Use @AGENTS.md\n```\n@Decorator()\n```\nmail a@b.com and @docs/x.md')).toEqual([
      'AGENTS.md',
      'docs/x.md',
    ])
  })

  it('tells typed prompts from injected messages', () => {
    const rec = (v: object) => parseRecord(JSON.stringify({ type: 'user', ...v })) as UserRecord
    expect(isHumanPrompt(rec({ origin: { kind: 'human' }, message: { content: 'hi' } }))).toBe(true)
    expect(isHumanPrompt(rec({ origin: { kind: 'task-notification' }, message: { content: 'x' } }))).toBe(false)
    expect(isHumanPrompt(rec({ message: { content: 'old style prompt' } }))).toBe(true)
    expect(isHumanPrompt(rec({ message: { content: '<system-reminder>x</system-reminder>' } }))).toBe(false)
    expect(isHumanPrompt(rec({ isMeta: true, message: { content: 'injected' } }))).toBe(false)
  })

  it('never throws on broken lines', () => {
    expect(parseRecord('{"type":"user",')).toBeNull()
    expect(parseRecord('')).toBeNull()
    expect(parseRecord('{"type":"api-request","id":"x"}')).toBeNull()
    expect(parseRecord('{"type":"something-new"}')).toEqual({ type: 'other', name: 'something-new' })
  })

  it('resolves hook script paths, including $CLAUDE_PROJECT_DIR', () => {
    expect(hookScripts('"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh', '/repo')).toEqual(['/repo/.claude/hooks/x.sh'])
    expect(hookScripts('node scripts/check.js', '/repo')).toEqual(['/repo/scripts/check.js'])
    expect(hookScripts('node scripts/check.js', null)).toEqual([])
    expect(hookScripts('"/opt/bin/node" "/abs/hook.cjs"', null)).toEqual(['/abs/hook.cjs'])
  })
})

describe('localhost guard', () => {
  it('accepts only local hosts and origins', () => {
    expect(isLocalHost('localhost:5173')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('[::1]:4317')).toBe(true)
    expect(isLocalHost('localhost.evil.com')).toBe(false)
    expect(isLocalHost('192.168.1.5:4317')).toBe(false)
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalOrigin(undefined)).toBe(true)
    expect(isLocalOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isLocalOrigin('https://attacker.example')).toBe(false)
  })
})

describe('project map', () => {
  it('names MCP tools the way Claude Code does', () => {
    expect(mcpToolPrefix('claude.ai Gmail')).toBe('mcp__claude_ai_Gmail__')
    expect(mcpToolPrefix('claude-in-chrome')).toBe('mcp__claude-in-chrome__')
    expect(mcpToolPrefix('vercel', 'vercel')).toBe('mcp__plugin_vercel_vercel__')
  })

  it('reads the slash command a message ran', () => {
    expect(commandName('<command-name>/review</command-name>\n<command-args>12</command-args>')).toBe('/review')
    expect(commandName('<command-name>ns:do</command-name>')).toBe('/ns:do')
    expect(commandName('just text')).toBeNull()
  })
})

describe('session map', () => {
  it('reads file-history snapshots and deltas, and nothing else', () => {
    const snapshot = parseFileHistory({
      type: 'file-history-snapshot',
      snapshot: {
        timestamp: '2026-11-01T10:05:00.000Z',
        trackedFileBackups: {
          'src/a.ts': {
            backupFileName: 'abc@v2',
            version: 2,
            backupTime: '2026-11-01T10:04:00.000Z',
            realParentDir: '/p/src',
          },
          'new.md': { backupFileName: null, version: 1, backupTime: '2026-11-01T10:03:00.000Z' },
          'broken.md': { backupFileName: 'x@v1' },
        },
      },
    })
    expect(snapshot).toEqual([
      { path: 'src/a.ts', realParentDir: '/p/src', version: 2, at: Date.UTC(2026, 10, 1, 10, 4), exists: true },
      { path: 'new.md', realParentDir: null, version: 1, at: Date.UTC(2026, 10, 1, 10, 3), exists: false },
    ])
    expect(
      parseFileHistory({
        type: 'file-history-delta',
        trackingPath: '/abs/b.ts',
        backup: { backupFileName: 'b@v1', version: 1 },
        timestamp: '2026-11-01T10:06:00.000Z',
      }),
    ).toEqual([{ path: '/abs/b.ts', realParentDir: null, version: 1, at: Date.UTC(2026, 10, 1, 10, 6), exists: true }])
    expect(parseFileHistory({ type: 'file-history-snapshot' })).toEqual([])
    expect(parseFileHistory({ type: 'user', snapshot: {} })).toEqual([])
  })

  it('splits activity at long gaps', () => {
    const min = 60_000
    expect(mergeTimes([30 * min, 0, 5 * min])).toEqual([
      { from: 0, to: 5 * min },
      { from: 30 * min, to: 30 * min },
    ])
    expect(mergeTimes([])).toEqual([])
  })

  const tl = (p: Partial<Timeline>): Timeline => ({ ...emptyTimeline(), ...p })
  const ev = (id: string, at: number, kind: FileKind, file: string, failed = false): FileEvent => ({
    id,
    at,
    tool: kind === 'read' ? 'Read' : kind === 'edit' ? 'Edit' : 'Write',
    kind,
    path: file,
    failed,
  })
  const agent = (
    agentId: string,
    meta: Partial<AgentMeta>,
    timeline: Partial<Timeline>,
    toolCalls: Record<string, number> = {},
  ): MapAgentInput => ({
    agentId,
    meta: {
      agentType: null,
      description: null,
      toolUseId: null,
      spawnDepth: null,
      model: null,
      isFork: false,
      finished: null,
      ...meta,
    },
    timeline: tl(timeline),
    stats: { ...emptyStats(), toolCalls },
    bytes: 0,
    mtimeMs: 0,
  })
  const call = (id: string, at: number, type: string) => ({ id, at, type, description: null })

  const map = buildSessionMap({
    cwd: '/p',
    home: '/h',
    now: Date.now(),
    main: {
      timeline: tl({
        firstAt: 100,
        lastAt: 1200,
        prompts: [
          { at: 100, text: 'go' },
          { at: 1000, text: 'more' },
        ],
        agentCalls: [call('L1', 200, 'general-purpose'), call('LF', 1100, 'fork')],
        fileEvents: [ev('m1', 150, 'read', '/p/src/a.ts'), ev('m2', 160, 'edit', '/p/src/a.ts', true)],
        backups: [
          { path: 'src/a.ts', realParentDir: '/p/src', version: 1, at: 155, exists: true },
          // Relative to a folder whose real path differs: found through realParentDir.
          { path: 'b.ts', realParentDir: '/real/p', version: 1, at: 300, exists: false },
        ],
      }),
      stats: emptyStats(),
    },
    agents: [
      agent('U', { agentType: 'Explore', toolUseId: 'nope' }, { firstAt: 500 }),
      agent(
        'F',
        { isFork: true, toolUseId: 'LF' },
        {
          firstAt: 1100,
          // A fork's transcript starts with a copy of its parent's last message.
          agentCalls: [call('LF', 1100, 'fork')],
          fileEvents: [ev('m1', 150, 'read', '/p/src/a.ts')],
        },
        { Agent: 1, Read: 2 },
      ),
      agent(
        'B',
        { agentType: 'Explore', toolUseId: 'L2' },
        {
          firstAt: 320,
          fileEvents: [ev('b1', 320, 'read', '/h/notes/x.md')],
        },
      ),
      agent(
        'A',
        { agentType: 'general-purpose', toolUseId: 'L1' },
        {
          firstAt: 210,
          agentCalls: [call('L2', 300, 'Explore')],
          fileEvents: [ev('a1', 310, 'write', '/real/p/b.ts')],
        },
      ),
      // Each claims to be launched by the other.
      agent('C1', { toolUseId: 'K2' }, { firstAt: 600, agentCalls: [call('K1', 610, 'Explore')] }),
      agent('C2', { toolUseId: 'K1' }, { firstAt: 640, agentCalls: [call('K2', 650, 'Explore')] }),
    ],
    stored: [],
    linked: { continuedIn: null, continuedFrom: [], continuedFromPartial: false, plans: [] },
  })
  const byId = (id: string) => map.agents.find(a => a.id === id)

  it('finds who launched each agent, in tree order', () => {
    expect(map.agents.map(a => `${a.id}:${a.depth}`)).toEqual(['A:1', 'B:2', 'U:1', 'C1:1', 'C2:2', 'F:1'])
    expect(byId('A')).toMatchObject({ parent: 'main', parentKnown: true, afterPrompt: 1, children: ['B'] })
    expect(byId('B')).toMatchObject({ parent: 'A', parentKnown: true, afterPrompt: null, launchedAt: 300 })
    expect(byId('U')).toMatchObject({ parent: 'main', parentKnown: false, launchedAt: 500 })
    expect(byId('C1')).toMatchObject({ parent: 'main', parentKnown: false })
    expect(byId('C2')).toMatchObject({ parent: 'C1', parentKnown: true })
  })

  it("credits a fork's copied launch to its parent", () => {
    expect(byId('F')).toMatchObject({ parent: 'main', parentKnown: true, isFork: true, type: 'fork', afterPrompt: 2 })
    expect(byId('F')?.toolCalls).toEqual({ Read: 2 })
    expect(map.launches.find(l => l.id === 'LF')).toMatchObject({ by: 'main', agentId: 'F' })
    expect(map.launches.find(l => l.id === 'L2')).toMatchObject({ by: 'A', agentId: 'B' })
    expect(map.summary.unmatchedLaunches).toBe(0)
  })

  it('groups file events by path, with versions and display paths', () => {
    const file = (id: string) => map.files.find(f => f.id === id)
    // The fork's copy of m1 is dropped; the failed edit isn't counted.
    expect(file('src/a.ts')).toMatchObject({ inCwd: true, dir: 'src/', name: 'a.ts', reads: 1, edits: 0 })
    expect(file('src/a.ts')?.events.map(e => `${e.who}:${e.kind}:${e.failed}`)).toEqual([
      'main:read:false',
      'main:edit:true',
    ])
    expect(file('src/a.ts')?.versions).toEqual([{ version: 1, at: 155, exists: true }])
    expect(file('/real/p/b.ts')).toMatchObject({ inCwd: false, created: true, edits: 1 })
    expect(file('~/notes/x.md')?.events.map(e => e.who)).toEqual(['B'])
    expect(map.summary).toMatchObject({ filesRead: 2, filesEdited: 1, filesCreated: 1, nested: 2, forks: 1 })
  })
})
