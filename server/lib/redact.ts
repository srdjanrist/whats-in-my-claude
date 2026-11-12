// Secret handling. Every value that reaches the browser from a config file
// that can hold credentials (MCP env/headers/args/urls, hook commands,
// settings env) goes through here. Key names stay visible so the user can see
// *what* is configured; values never leave the server.
import { isObj, type Obj, str, strArray } from './fs.ts'

export const REDACTED = '•••'

/** Token shapes common enough to mask wherever they show up in free text. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-(?:ant|or|proj|live|test)?-?[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI / OpenRouter / Stripe style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(?:PMAK|vcp|vck)_[A-Za-z0-9_-]{20,}/g, // Postman / Vercel
]

const SECRET_NAME =
  /(key|token|secret|passw(or)?d|pwd|auth|credential|bearer|cookie|session|private|signature|api[-_]?key)/i

/** Masks well-known token shapes inside arbitrary text (commands, transcript output). */
export function maskTokens(text: string): string {
  let out = text
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, m => `${m.slice(0, 4)}${REDACTED}`)
  // KEY=value / KEY: value assignments where the key looks secret.
  out = out.replace(
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']{6,})\3/g,
    (_m, name: string, sep: string, quote: string) => `${name}${sep}${quote}${REDACTED}${quote}`,
  )
  // Authorization headers.
  out = out.replace(/(Authorization:\s*(?:Bearer|Basic|token)\s+)[^\s"']+/gi, `$1${REDACTED}`)
  return out
}

/** Whether a single value looks like a credential. */
export function looksSecret(value: string): boolean {
  if (TOKEN_PATTERNS.some(p => new RegExp(p.source).test(value))) return true
  // Long, high-entropy, no path/url separators: probably a token.
  if (value.length >= 32 && /^[A-Za-z0-9_\-+=/.]+$/.test(value) && !value.includes('/') && !value.includes('.')) {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter(r => r.test(value)).length
    return classes >= 2
  }
  return false
}

/** True when an env/header value is a reference (${VAR}) rather than an inline literal. */
export function isReference(value: string): boolean {
  return /^\$\{[^}]+\}$/.test(value.trim()) || /^\$[A-Z_][A-Z0-9_]*$/.test(value.trim())
}

/** Masks query-string values and user:password in a URL. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.password) url.password = REDACTED
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, REDACTED)
    return decodeURI(url.toString())
  } catch {
    return maskTokens(raw)
  }
}

const SECRET_FLAG = /^--?(api[-_]?key|key|token|secret|password|pass|auth|access[-_]?token|bearer|header)$/i

/** Masks args that are, or follow a flag naming, a secret. */
export function redactArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    const prev = i > 0 ? (args[i - 1] as string) : ''
    if (SECRET_FLAG.test(prev)) {
      out.push(REDACTED)
      continue
    }
    const eq = /^(--?[A-Za-z0-9_-]+)=(.+)$/.exec(arg)
    if (eq && SECRET_FLAG.test(eq[1] as string)) {
      out.push(`${eq[1]}=${REDACTED}`)
      continue
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg)
    if (assignment && SECRET_NAME.test(assignment[1] as string)) {
      out.push(`${assignment[1]}=${REDACTED}`)
      continue
    }
    out.push(looksSecret(arg) ? REDACTED : maskTokens(arg))
  }
  return out
}

/** Key names of a string map; the values are dropped. */
export function keysOf(v: unknown): string[] {
  return isObj(v) ? Object.keys(v).sort() : []
}

export interface InlineSecret {
  key: string
  /** env or headers */
  field: string
}

/** env/header entries set to an inline literal under a secret-looking name, or whose value looks like a token. */
export function inlineSecrets(server: Obj): InlineSecret[] {
  const found: InlineSecret[] = []
  for (const field of ['env', 'headers'] as const) {
    const map = server[field]
    if (!isObj(map)) continue
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== 'string' || value.trim() === '' || isReference(value)) continue
      if (SECRET_NAME.test(key) || looksSecret(value)) found.push({ key, field })
    }
  }
  for (const arg of strArray(server.args)) if (looksSecret(arg)) found.push({ key: 'args', field: 'args' })
  const url = str(server.url)
  if (url && /[?&][^=]*(key|token|secret)[^=]*=/i.test(url)) found.push({ key: 'url', field: 'url' })
  return found
}

export interface McpServerView {
  name: string
  transport: string
  command: string | null
  args: string[]
  url: string | null
  envKeys: string[]
  headerKeys: string[]
  /** Inline literals that look like credentials (names only). */
  inlineSecrets: InlineSecret[]
  note: string | null
}

/** The browser-safe view of one MCP server config. */
export function mcpServerView(name: string, raw: unknown): McpServerView {
  const server = isObj(raw) ? raw : {}
  const url = str(server.url)
  const command = str(server.command)
  const type = str(server.type) ?? (url ? 'http' : 'stdio')
  return {
    name,
    transport: type,
    command: command ? maskTokens(command) : null,
    args: redactArgs(strArray(server.args)),
    url: url ? redactUrl(url) : null,
    envKeys: keysOf(server.env),
    headerKeys: keysOf(server.headers),
    inlineSecrets: inlineSecrets(server),
    note: str(server.note),
  }
}

/** Deep copy of a settings object with every `env` map's values and secret-named string fields masked. */
export function redactSettings(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map(v => redactSettings(v, parentKey))
  if (isObj(value)) {
    const out: Obj = {}
    for (const [key, v] of Object.entries(value)) {
      if ((key === 'env' || key === 'headers') && isObj(v)) {
        out[key] = Object.fromEntries(Object.keys(v).map(k => [k, REDACTED]))
      } else if (typeof v === 'string' && SECRET_NAME.test(key) && !/^(apiKeyHelper|statusMessage)$/.test(key)) {
        out[key] = REDACTED
      } else {
        out[key] = redactSettings(v, key)
      }
    }
    return out
  }
  if (typeof value === 'string') return maskTokens(value)
  return value
}
