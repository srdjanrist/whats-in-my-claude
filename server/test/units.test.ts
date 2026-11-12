import { describe, expect, it } from 'vitest'
import { isLocalHost, isLocalOrigin } from '../app.ts'
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
import { isHumanPrompt } from '../lib/transcript/prompts.ts'
import { parseRecord, type UserRecord } from '../lib/transcript/records.ts'
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
