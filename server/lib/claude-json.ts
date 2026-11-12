// ~/.claude.json holds account data (OAuth, email, org, device ids) next to
// the parts worth showing. Only the keys listed here are ever read out of
// the parsed object; everything else is dropped right after parsing.
import { cached, TTL } from './cache.ts'
import { isObj, num, type Obj, readJsonObj, str, strArray } from './fs.ts'
import { claudeJsonPath } from './paths.ts'

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
}

export interface ProjectState {
  path: string
  allowedTools: string[]
  /** Raw MCP server configs (local scope). Never returned as-is: go through mcpServerView. */
  mcpServersRaw: Obj
  enabledMcpjsonServers: string[]
  disabledMcpjsonServers: string[]
  disabledMcpServers: string[]
  hasTrustDialogAccepted: boolean
  lastSessionId: string | null
  lastCost: number | null
  lastDuration: number | null
  lastAPIDuration: number | null
  lastLinesAdded: number | null
  lastLinesRemoved: number | null
  lastTotalInputTokens: number | null
  lastTotalOutputTokens: number | null
  lastTotalCacheReadInputTokens: number | null
  lastTotalCacheCreationInputTokens: number | null
  lastModelUsage: Record<string, ModelUsage>
}

export interface UsageEntry {
  usageCount: number
  lastUsedAt: number | null
}

export interface ClaudeJson {
  found: boolean
  numStartups: number | null
  firstStartTime: string | null
  installMethod: string | null
  autoUpdates: boolean | null
  /** User-scope MCP servers, raw. Never returned as-is. */
  mcpServersRaw: Obj
  projects: Record<string, ProjectState>
  skillUsage: Record<string, UsageEntry>
  pluginUsage: Record<string, UsageEntry>
  githubRepoPaths: Record<string, string[]>
  claudeAiMcpEverConnected: string[]
}

const n = (v: unknown) => num(v) ?? 0

function modelUsage(v: unknown): Record<string, ModelUsage> {
  if (!isObj(v)) return {}
  const out: Record<string, ModelUsage> = {}
  for (const [model, u] of Object.entries(v)) {
    if (!isObj(u)) continue
    out[model] = {
      inputTokens: n(u.inputTokens),
      outputTokens: n(u.outputTokens),
      cacheReadInputTokens: n(u.cacheReadInputTokens),
      cacheCreationInputTokens: n(u.cacheCreationInputTokens),
      webSearchRequests: n(u.webSearchRequests),
      costUSD: n(u.costUSD),
    }
  }
  return out
}

function projectState(path: string, p: Obj): ProjectState {
  // lastSessionFirstPrompt, exampleFiles, metrics and caches are intentionally not read.
  return {
    path,
    allowedTools: strArray(p.allowedTools),
    mcpServersRaw: isObj(p.mcpServers) ? p.mcpServers : {},
    enabledMcpjsonServers: strArray(p.enabledMcpjsonServers),
    disabledMcpjsonServers: strArray(p.disabledMcpjsonServers),
    disabledMcpServers: strArray(p.disabledMcpServers),
    hasTrustDialogAccepted: p.hasTrustDialogAccepted === true,
    lastSessionId: str(p.lastSessionId),
    lastCost: num(p.lastCost),
    lastDuration: num(p.lastDuration),
    lastAPIDuration: num(p.lastAPIDuration),
    lastLinesAdded: num(p.lastLinesAdded),
    lastLinesRemoved: num(p.lastLinesRemoved),
    lastTotalInputTokens: num(p.lastTotalInputTokens),
    lastTotalOutputTokens: num(p.lastTotalOutputTokens),
    lastTotalCacheReadInputTokens: num(p.lastTotalCacheReadInputTokens),
    lastTotalCacheCreationInputTokens: num(p.lastTotalCacheCreationInputTokens),
    lastModelUsage: modelUsage(p.lastModelUsage),
  }
}

function usageMap(v: unknown): Record<string, UsageEntry> {
  if (!isObj(v)) return {}
  const out: Record<string, UsageEntry> = {}
  for (const [name, u] of Object.entries(v)) {
    if (isObj(u))
      out[name] = {
        usageCount: n(u.usageCount),
        lastUsedAt: num(u.lastUsedAt),
      }
  }
  return out
}

async function load(): Promise<ClaudeJson> {
  const raw = await readJsonObj(claudeJsonPath())
  if (!raw) {
    return {
      found: false,
      numStartups: null,
      firstStartTime: null,
      installMethod: null,
      autoUpdates: null,
      mcpServersRaw: {},
      projects: {},
      skillUsage: {},
      pluginUsage: {},
      githubRepoPaths: {},
      claudeAiMcpEverConnected: [],
    }
  }
  const projects: Record<string, ProjectState> = {}
  if (isObj(raw.projects)) {
    for (const [path, p] of Object.entries(raw.projects)) if (isObj(p)) projects[path] = projectState(path, p)
  }
  const repoPaths: Record<string, string[]> = {}
  if (isObj(raw.githubRepoPaths)) {
    for (const [repo, paths] of Object.entries(raw.githubRepoPaths)) repoPaths[repo] = strArray(paths)
  }
  return {
    found: true,
    numStartups: num(raw.numStartups),
    firstStartTime: str(raw.firstStartTime),
    installMethod: str(raw.installMethod),
    autoUpdates: typeof raw.autoUpdates === 'boolean' ? raw.autoUpdates : null,
    mcpServersRaw: isObj(raw.mcpServers) ? raw.mcpServers : {},
    projects,
    skillUsage: usageMap(raw.skillUsage),
    pluginUsage: usageMap(raw.pluginUsage),
    githubRepoPaths: repoPaths,
    claudeAiMcpEverConnected: strArray(raw.claudeAiMcpEverConnected),
  }
}

export function readClaudeJson(): Promise<ClaudeJson> {
  return cached('claude-json', TTL.config, load)
}
