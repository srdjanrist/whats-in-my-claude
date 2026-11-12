// MCP servers from every scope Claude Code reads them from. Every config is
// turned into a McpServerView (env/header values dropped, secret-looking args
// and URL query values masked) before it can leave this module.
import { cached, TTL } from './cache.ts'
import { readClaudeJson } from './claude-json.ts'
import { isObj, strArray } from './fs.ts'
import { claudeJsonPath } from './paths.ts'
import type { PluginItem } from './plugins.ts'
import { projectConfig } from './project-config.ts'
import { type McpServerView, mcpServerView } from './redact.ts'

export type McpScope = 'user' | 'local' | 'project' | 'plugin' | 'claude-ai'

export interface McpServerItem extends McpServerView {
  id: string
  scope: McpScope
  /** The project path, plugin id or config file it comes from. */
  origin: string
  /** true / false when a setting decides; null when Claude Code would ask (project .mcp.json not yet approved). */
  enabled: boolean | null
}

async function load(plugins: PluginItem[], projectRoots: string[]): Promise<McpServerItem[]> {
  const cj = await readClaudeJson()
  const out: McpServerItem[] = []
  for (const [name, cfg] of Object.entries(cj.mcpServersRaw)) {
    out.push({
      ...mcpServerView(name, cfg),
      id: `user:${name}`,
      scope: 'user',
      origin: claudeJsonPath(),
      enabled: true,
    })
  }
  for (const [projectPath, state] of Object.entries(cj.projects)) {
    for (const [name, cfg] of Object.entries(state.mcpServersRaw)) {
      out.push({
        ...mcpServerView(name, cfg),
        id: `local:${projectPath}:${name}`,
        scope: 'local',
        origin: projectPath,
        enabled: !state.disabledMcpServers.includes(name),
      })
    }
  }
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    const servers = isObj(cfg.mcpJson?.mcpServers) ? cfg.mcpJson.mcpServers : {}
    if (Object.keys(servers).length === 0) continue
    const state = cj.projects[root]
    const local = cfg.settingsLocal ?? {}
    const enableAll = local.enableAllProjectMcpServers === true || cfg.settings?.enableAllProjectMcpServers === true
    const enabledList = [...(state?.enabledMcpjsonServers ?? []), ...strArray(local.enabledMcpjsonServers)]
    const disabledList = [...(state?.disabledMcpjsonServers ?? []), ...strArray(local.disabledMcpjsonServers)]
    for (const [name, raw] of Object.entries(servers)) {
      const explicitlyOff = isObj(raw) && raw.enabled === false
      out.push({
        ...mcpServerView(name, raw),
        id: `project:${root}:${name}`,
        scope: 'project',
        origin: root,
        enabled:
          explicitlyOff || disabledList.includes(name) ? false : enableAll || enabledList.includes(name) ? true : null,
      })
    }
  }
  for (const plugin of plugins) {
    for (const server of plugin.components.mcpServers) {
      out.push({
        ...server,
        id: `plugin:${plugin.id}:${server.name}`,
        scope: 'plugin',
        origin: plugin.id,
        enabled: plugin.enabled,
      })
    }
  }
  for (const name of cj.claudeAiMcpEverConnected) {
    out.push({
      ...mcpServerView(name, {}),
      transport: 'claude.ai',
      id: `claude-ai:${name}`,
      scope: 'claude-ai',
      origin: 'claude.ai connectors',
      enabled: null,
    })
  }
  return out
}

export function readMcpServers(plugins: PluginItem[], projectRoots: string[]) {
  return cached('mcp', TTL.config * 3, () => load(plugins, projectRoots))
}
