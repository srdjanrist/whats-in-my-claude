// Records of Claude Code's session transcripts, one JSON object per line.
// Ported from claude-visualizer (src/transcript/records.ts) and extended with
// the metadata records whats-in-my-claude shows (agent-name, pr-link, tools-used,
// continued-in, summary). The format is internal and changes between
// versions, so every field is checked before use, records of a type we don't
// use come back as 'other', and nothing here throws.
import { isObj, type Obj, str } from '../fs.ts'

/** One part of a message's content: text, thinking, tool_use, tool_result… */
export interface Block {
  type: string
  [key: string]: unknown
}

export interface Usage {
  /** Uncached input tokens. */
  input: number
  /** Input tokens written to the prompt cache. */
  cacheWrite: number
  /** Input tokens read from the prompt cache. */
  cacheRead: number
  output: number
}

export interface CostTotals {
  costUSD: number
  apiMs: number
  toolMs: number
  linesAdded: number
  linesRemoved: number
}

/** Fields most records carry. */
interface Common {
  /** Epoch ms, or null when the record has no usable timestamp. */
  at: number | null
  uuid: string | null
  cwd: string | null
  version: string | null
  gitBranch: string | null
  /** Plan-file slug: plans/<slug>.md. */
  slug: string | null
  isSidechain: boolean
}

export interface UserRecord extends Common {
  type: 'user'
  content: string | Block[]
  /** Added by Claude Code rather than typed (caveats, skill bodies…). */
  isMeta: boolean
  /** Where the message came from: human, task-notification, peer…; null on older versions. */
  origin: string | null
  isCompactSummary: boolean
  hasToolResult: boolean
}

export interface AssistantRecord extends Common {
  type: 'assistant'
  /** The API message id; the blocks of one response share it (one line per block). */
  messageId: string | null
  requestId: string | null
  model: string | null
  content: Block[]
  usage: Usage | null
  isApiError: boolean
}

export interface AttachmentRecord extends Common {
  type: 'attachment'
  kind: string
}

export interface SystemRecord extends Common {
  type: 'system'
  /** turn_duration, compact_boundary, away_summary… */
  subtype: string | null
  content: string | null
  durationMs: number | null
  preTokens: number | null
}

export interface PermissionModeRecord {
  type: 'permission-mode'
  mode: string
}

export interface TitleRecord {
  type: 'ai-title'
  title: string
}

export interface AgentNameRecord {
  type: 'agent-name'
  name: string
}

export interface SummaryRecord {
  type: 'summary'
  summary: string
}

export interface CostRecord {
  type: 'cost-state'
  startTime: number | null
  totals: CostTotals
}

export interface PrLinkRecord {
  type: 'pr-link'
  number: number | null
  url: string
  repository: string | null
}

export interface ToolsUsedRecord {
  type: 'tools-used'
  tools: string[]
}

export interface ContinuedInRecord {
  type: 'continued-in'
  sessionId: string
}

/** A record of a type this reader doesn't use. */
export interface OtherRecord {
  type: 'other'
  name: string
}

export type TranscriptRecord =
  | UserRecord
  | AssistantRecord
  | AttachmentRecord
  | SystemRecord
  | PermissionModeRecord
  | TitleRecord
  | AgentNameRecord
  | SummaryRecord
  | CostRecord
  | PrLinkRecord
  | ToolsUsedRecord
  | ContinuedInRecord
  | OtherRecord

const numOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const blocks = (v: unknown): Block[] =>
  Array.isArray(v) ? v.filter((b): b is Block => isObj(b) && typeof b.type === 'string') : []

export function time(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function common(r: Obj): Common {
  return {
    at: time(r.timestamp),
    uuid: str(r.uuid),
    cwd: str(r.cwd),
    version: str(r.version),
    gitBranch: str(r.gitBranch),
    slug: str(r.slug),
    isSidechain: r.isSidechain === true,
  }
}

function usage(v: unknown): Usage | null {
  if (!isObj(v)) return null
  return {
    input: numOr0(v.input_tokens),
    cacheWrite: numOr0(v.cache_creation_input_tokens),
    cacheRead: numOr0(v.cache_read_input_tokens),
    output: numOr0(v.output_tokens),
  }
}

export function parseObject(r: Obj): TranscriptRecord | null {
  const type = str(r.type)
  if (!type) return null
  switch (type) {
    case 'user': {
      const message = isObj(r.message) ? r.message : {}
      const content = typeof message.content === 'string' ? message.content : blocks(message.content)
      return {
        type,
        ...common(r),
        content,
        isMeta: r.isMeta === true,
        origin: isObj(r.origin) ? str(r.origin.kind) : null,
        isCompactSummary: r.isCompactSummary === true,
        hasToolResult: typeof content !== 'string' && content.some(b => b.type === 'tool_result'),
      }
    }
    case 'assistant': {
      const message = isObj(r.message) ? r.message : {}
      return {
        type,
        ...common(r),
        messageId: str(message.id),
        requestId: str(r.requestId),
        model: str(message.model),
        content: blocks(message.content),
        usage: usage(message.usage),
        isApiError: r.isApiErrorMessage === true || message.model === '<synthetic>',
      }
    }
    case 'attachment': {
      const kind = isObj(r.attachment) ? str(r.attachment.type) : null
      return { type, ...common(r), kind: kind ?? 'unknown' }
    }
    case 'system': {
      const meta = isObj(r.compactMetadata) ? r.compactMetadata : {}
      return {
        type,
        ...common(r),
        subtype: str(r.subtype),
        content: str(r.content),
        durationMs: numOrNull(r.durationMs),
        preTokens: numOrNull(meta.preTokens),
      }
    }
    case 'permission-mode': {
      const mode = str(r.permissionMode)
      return mode ? { type, mode } : null
    }
    case 'ai-title': {
      const title = str(r.aiTitle)
      return title ? { type, title } : null
    }
    case 'agent-name': {
      const name = str(r.agentName)
      return name ? { type, name } : null
    }
    case 'summary': {
      const summary = str(r.summary)
      return summary ? { type, summary } : null
    }
    case 'cost-state':
      return {
        type,
        startTime: numOrNull(r.startTime),
        totals: {
          costUSD: numOr0(r.totalCostUSD),
          apiMs: numOr0(r.totalAPIDuration),
          toolMs: numOr0(r.totalToolDuration),
          linesAdded: numOr0(r.totalLinesAdded),
          linesRemoved: numOr0(r.totalLinesRemoved),
        },
      }
    case 'pr-link': {
      const url = str(r.prUrl)
      return url
        ? {
            type,
            url,
            number: numOrNull(r.prNumber),
            repository: str(r.prRepository),
          }
        : null
    }
    case 'tools-used':
      return {
        type,
        tools: Array.isArray(r.tools) ? r.tools.filter((t): t is string => typeof t === 'string') : [],
      }
    case 'continued-in': {
      const sessionId = str(r.continuedInSessionId)
      return sessionId ? { type, sessionId } : null
    }
    default:
      return { type: 'other', name: type }
  }
}

/**
 * Lines that are never parsed: API request payloads (system prompts and tool
 * schemas, ~65% of a transcript's bytes) and account/org identity records.
 * They all start with their type, so a prefix check skips them cheaply.
 */
const SKIPPED_PREFIXES = ['{"type":"api-request', '{"type":"session-owner', '{"type":"bridge-session']

export function isSkippedLine(line: string): boolean {
  return SKIPPED_PREFIXES.some(p => line.startsWith(p))
}

/** The record on one transcript line, or null when the line isn't a usable record. */
export function parseRecord(line: string): TranscriptRecord | null {
  if (line.trim() === '' || isSkippedLine(line)) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  return isObj(value) ? parseObject(value) : null
}

/** The text parts of a message's content. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(part =>
      isObj(part) && typeof part.text === 'string' ? [part.text] : typeof part === 'string' ? [part] : [],
    )
    .join('\n')
}
