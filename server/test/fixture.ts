// Builds a small, realistic fake home folder (~/.claude, ~/.claude.json,
// ~/.agents and one project) in a temp dir. Every value that must never reach
// the browser contains the marker LEAK, so a test can call every API route
// and assert the marker never appears in a response.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LEAK = 'LEAK'

export interface Fixture {
  home: string
  claude: string
  project: string
  projectDir: string
  sessionId: string
  agentId: string
  cleanup: () => void
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`
const jsonl = (lines: unknown[]) => `${lines.map(l => JSON.stringify(l)).join('\n')}\n`

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

export function createFixture(): Fixture {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whats-in-my-claude-test-')))
  const claude = path.join(home, '.claude')
  const project = path.join(home, 'Clients', 'acme.app')
  const projectDir = project.replace(/[^A-Za-z0-9]/g, '-')
  const sessionId = '11111111-2222-3333-4444-555555555555'
  const agentId = 'a1b2c3d4e5'
  const t = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min)).toISOString()
  const common = {
    cwd: project,
    sessionId,
    version: '2.1.300',
    gitBranch: 'main',
    slug: 'brave-blue-fox',
    isSidechain: false,
  }

  // ---------------------------------------------------------------- ~/.claude.json
  write(
    path.join(home, '.claude.json'),
    json({
      numStartups: 42,
      firstStartTime: '2025-01-01T00:00:00.000Z',
      installMethod: 'native',
      userID: `${LEAK}-USER-ID`,
      oauthAccount: { emailAddress: `${LEAK}-email@example.com`, accountUuid: `${LEAK}-ACCOUNT` },
      mcpServers: {
        search: {
          command: 'npx',
          args: ['search-mcp', '--api-key', `sk-ant-${LEAK}0123456789abcdef`],
          env: { API_TOKEN: `${LEAK}-ENV-VALUE` },
        },
      },
      projects: {
        [project]: {
          allowedTools: [],
          mcpServers: {
            remote: {
              type: 'http',
              url: `https://mcp.example.com/mcp?token=${LEAK}-URL`,
              headers: { Authorization: `Bearer ${LEAK}-HEADER` },
            },
          },
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          lastSessionId: sessionId,
          lastCost: 1.25,
          lastSessionFirstPrompt: `${LEAK}-FIRST-PROMPT`,
          lastModelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 20, costUSD: 1.25 } },
        },
      },
      skillUsage: { 'my-skill': { usageCount: 3, lastUsedAt: 1_790_000_000_000 } },
      pluginUsage: { 'demo@mkt': { usageCount: 2, lastUsedAt: 1_790_000_000_000 } },
      claudeAiMcpEverConnected: ['claude.ai Gmail'],
    }),
  )

  // ---------------------------------------------------------------- ~/.claude basics
  write(
    path.join(claude, 'settings.json'),
    json({
      permissions: { defaultMode: 'acceptEdits', allow: ['Bash(git status)'] },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo done', timeout: 5 }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `/does/not/exist/check.sh` }] }],
      },
      enabledPlugins: { 'demo@mkt': true },
      env: { SECRET_THING: `${LEAK}-SETTINGS-ENV` },
    }),
  )
  write(path.join(claude, 'CLAUDE.md'), '# Global rules\n\nBe brief.\n')
  write(
    path.join(claude, 'history.jsonl'),
    jsonl([
      { display: 'build the thing', timestamp: Date.parse(t(0)), project, sessionId, pastedContents: {} },
      {
        display: 'now test it',
        timestamp: Date.parse(t(5)),
        project,
        sessionId,
        pastedContents: { 1: { id: 1, type: 'text' } },
      },
      { display: 'something elsewhere', timestamp: Date.parse(t(9)), project: '/old/deleted/proj', pastedContents: {} },
    ]),
  )
  write(
    path.join(claude, 'skills', 'my-skill', 'SKILL.md'),
    '---\nname: my-skill\ndescription: >\n  Does my thing.\nallowed-tools:\n  - Read\n---\n# My skill\n',
  )
  write(
    path.join(home, '.agents', 'skills', 'shared', 'SKILL.md'),
    '---\nname: shared\ndescription: Shared skill\n---\nbody\n',
  )
  fs.symlinkSync('../../.agents/skills/shared', path.join(claude, 'skills', 'shared'))
  write(
    path.join(claude, 'agents', 'helper.md'),
    '---\nname: helper\ndescription: "Helps.\\n<example>long</example>"\nmodel: sonnet\ntools: Read, Grep\n---\nYou help.\n',
  )
  write(
    path.join(claude, 'commands', 'ns', 'do.md'),
    '---\ndescription: Does it\nargument-hint: <what>\n---\nDo $ARGUMENTS\n',
  )
  write(path.join(claude, 'plans', 'brave-blue-fox.md'), '# Plan: build the thing\n\nSteps.\n')

  // Secrets that must never be opened or shown.
  write(
    path.join(claude, 'sessions', '123.json'),
    json({ pid: 999_999_99, sessionId, cwd: project, status: 'idle', name: 'acme-1' }),
  )
  write(path.join(claude, 'sessions', '123.abcdef.key'), `${LEAK}-PEER-KEY`)
  write(
    path.join(claude, 'ide', '5555.lock'),
    json({ pid: 999_999_98, ideName: 'VS Code', workspaceFolders: [project], authToken: `${LEAK}-IDE` }),
  )
  write(path.join(claude, 'daemon', 'control.key'), `${LEAK}-CONTROL`)
  write(path.join(claude, 'session-env', sessionId, 'sessionstart-hook-1.sh'), `export X=${LEAK}-SESSION-ENV\n`)
  write(path.join(claude, 'shell-snapshots', 'snapshot-zsh-1-abcdef.sh'), `export TOKEN=${LEAK}-SHELL\n`)
  write(
    path.join(claude, 'backups', '.claude.json.backup.1'),
    json({ oauthAccount: { emailAddress: `${LEAK}-BACKUP` } }),
  )
  write(
    path.join(claude, 'jobs', 'abcd1234', 'state.json'),
    json({ name: 'job', state: 'done', providerEnv: { KEY: `${LEAK}-JOB-ENV` } }),
  )
  write(
    path.join(claude, 'stats-cache.json'),
    json({ version: 3, lastComputedDate: '2025-01-01', totalSessions: 1, totalMessages: 2 }),
  )

  // ---------------------------------------------------------------- a plugin
  const installPath = path.join(claude, 'plugins', 'cache', 'mkt', 'demo', '1.0.0')
  write(
    path.join(claude, 'plugins', 'installed_plugins.json'),
    json({
      version: 2,
      plugins: { 'demo@mkt': [{ scope: 'user', installPath, version: '1.0.0', installedAt: t(0), lastUpdated: t(0) }] },
    }),
  )
  write(
    path.join(claude, 'plugins', 'known_marketplaces.json'),
    json({ mkt: { source: { source: 'github', repo: 'acme/mkt' }, installLocation: '', lastUpdated: t(0) } }),
  )
  write(
    path.join(installPath, '.claude-plugin', 'plugin.json'),
    json({ name: 'demo', description: 'Demo plugin', author: { name: 'Acme' } }),
  )
  write(
    path.join(installPath, 'skills', 'demo-skill', 'SKILL.md'),
    '---\nname: demo-skill\ndescription: Demo skill\n---\n',
  )
  write(
    path.join(installPath, '.mcp.json'),
    json({
      mcpServers: {
        demo: { type: 'http', url: 'https://demo.example.com/mcp', headers: { 'X-Key': `${LEAK}-PLUGIN-HEADER` } },
      },
    }),
  )
  write(
    path.join(installPath, 'hooks', 'hooks.json'),
    json({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${installPath}/hooks/start.sh` }] }] } }),
  )
  fs.mkdirSync(path.join(claude, 'plugins', 'cache', 'mkt', 'demo', '0.9.0'), { recursive: true })

  // ---------------------------------------------------------------- the project folder
  write(
    path.join(project, 'CLAUDE.md'),
    '# Acme\n\nSee @AGENTS.md and @docs/style.md.\n\n```ts\n@Decorator()\nclass X {}\n```\nMail me@example.com\n',
  )
  write(path.join(project, 'AGENTS.md'), '# Agents\n')
  write(
    path.join(project, '.mcp.json'),
    json({
      mcpServers: {
        zen: {
          command: 'npx',
          args: ['zen-mcp'],
          env: { OPENROUTER_API_KEY: `sk-or-v1-${LEAK}000000000000000000`, MODE: '${MODE}' },
        },
      },
    }),
  )
  write(
    path.join(project, '.claude', 'settings.local.json'),
    json({ permissions: { allow: ['Bash(npm run:*)', 'Bash(git status)'] } }),
  )

  // ---------------------------------------------------------------- transcripts
  const dir = path.join(claude, 'projects', projectDir)
  const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }
  write(
    path.join(dir, `${sessionId}.jsonl`),
    jsonl([
      { type: 'session-owner', accountUuid: `${LEAK}-OWNER` },
      {
        parentUuid: null,
        ...common,
        type: 'user',
        uuid: 'u1',
        timestamp: t(0),
        origin: { kind: 'human' },
        message: { role: 'user', content: 'build the thing' },
      },
      {
        type: 'api-request',
        id: 'r1',
        timestamp: t(1),
        params: { model: 'claude-opus-5-5', system: `${LEAK}-SYSTEM-PROMPT` },
      },
      // One response, written as two lines (one per content block) that repeat the same usage.
      {
        parentUuid: 'u1',
        ...common,
        type: 'assistant',
        uuid: 'a1',
        timestamp: t(1),
        requestId: 'req1',
        message: { id: 'msg_1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'On it.' }], usage },
      },
      {
        parentUuid: 'a1',
        ...common,
        type: 'assistant',
        uuid: 'a2',
        timestamp: t(1),
        requestId: 'req1',
        message: {
          id: 'msg_1',
          model: 'claude-opus-5-5',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
          usage,
        },
      },
      {
        parentUuid: 'a2',
        ...common,
        type: 'user',
        uuid: 'u2',
        timestamp: t(2),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file.txt' }] },
      },
      {
        parentUuid: 'u2',
        ...common,
        type: 'assistant',
        uuid: 'a3',
        timestamp: t(3),
        requestId: 'req2',
        message: { id: 'msg_2', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }], usage },
      },
      { parentUuid: 'a3', ...common, type: 'system', subtype: 'turn_duration', durationMs: 60_000, timestamp: t(3) },
      {
        parentUuid: 'a3',
        ...common,
        type: 'user',
        uuid: 'u3',
        timestamp: t(5),
        origin: { kind: 'human' },
        message: { role: 'user', content: 'now test it' },
      },
      {
        parentUuid: 'u3',
        ...common,
        type: 'assistant',
        uuid: 'a4',
        timestamp: t(6),
        requestId: 'req3',
        message: {
          id: 'msg_3',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'API Error' }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        isApiErrorMessage: true,
      },
      { type: 'ai-title', aiTitle: 'Old title', sessionId },
      { type: 'ai-title', aiTitle: 'Build and test the thing', sessionId },
      {
        type: 'cost-state',
        totalCostUSD: 0.5,
        totalAPIDuration: 1000,
        totalToolDuration: 10,
        totalLinesAdded: 3,
        totalLinesRemoved: 1,
        startTime: Date.parse(t(0)),
      },
      { type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/acme/app/pull/7', prRepository: 'acme/app' },
    ]),
  )
  write(
    path.join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`),
    jsonl([
      {
        parentUuid: null,
        ...common,
        isSidechain: true,
        agentId,
        type: 'user',
        uuid: 's1',
        timestamp: t(2),
        message: { role: 'user', content: 'explore' },
      },
      {
        parentUuid: 's1',
        ...common,
        isSidechain: true,
        agentId,
        type: 'assistant',
        uuid: 's2',
        timestamp: t(2),
        message: { id: 'msg_s1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Found it.' }], usage },
      },
    ]),
  )
  write(
    path.join(dir, sessionId, 'subagents', `agent-${agentId}.meta.json`),
    json({ agentType: 'Explore', description: 'Look around', toolUseId: 'toolu_x' }),
  )

  write(
    path.join(dir, 'memory', 'MEMORY.md'),
    '- [Fact one](fact-one.md) — the first fact\n- [Gone](gone.md) — deleted\n',
  )
  write(
    path.join(dir, 'memory', 'fact-one.md'),
    '---\nname: fact-one\ndescription: The first fact\nmetadata:\n  type: feedback\n---\nSee [[fact-two]] and [[missing-one]].\n',
  )
  write(
    path.join(dir, 'memory', 'fact-two.md'),
    '---\nname: fact-two\ndescription: Second\ntype: project\n---\nOld-style frontmatter.\n',
  )

  // A project folder whose transcripts were deleted: only its legacy index is left.
  write(
    path.join(claude, 'projects', '-old-deleted-proj', 'sessions-index.json'),
    json({ version: 1, originalPath: '/old/deleted/proj', entries: [] }),
  )

  return {
    home,
    claude,
    project,
    projectDir,
    sessionId,
    agentId,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  }
}
