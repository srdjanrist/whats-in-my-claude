// Plugins: installed_plugins.json says what is installed where; enabledPlugins
// in user and project settings says what is on; each plugin's install dir
// (and, for manifest-less plugins such as the LSP ones, its marketplace
// entry) says what it contributes.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { readClaudeJson } from './claude-json.ts'
import {
  isDir,
  isObj,
  listDir,
  listFilesRecursive,
  listSubdirs,
  num,
  type Obj,
  readFrontmatter,
  readJsonObj,
  str,
  strArray,
} from './fs.ts'
import { claudePath } from './paths.ts'
import { projectConfig } from './project-config.ts'
import { type McpServerView, maskTokens, mcpServerView } from './redact.ts'

export interface HookDef {
  event: string
  matcher: string | null
  type: string
  command: string
  timeout: number | null
  async: boolean
  statusMessage: string | null
}

/** Flattens a `hooks` map (settings.json / hooks.json shape) into rows. */
export function flattenHooks(hooks: unknown): HookDef[] {
  if (!isObj(hooks)) return []
  const out: HookDef[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isObj(group)) continue
      for (const h of Array.isArray(group.hooks) ? group.hooks : []) {
        if (!isObj(h)) continue
        out.push({
          event,
          matcher: str(group.matcher),
          type: str(h.type) ?? 'command',
          command: maskTokens(str(h.command) ?? str(h.prompt) ?? ''),
          timeout: num(h.timeout),
          async: h.async === true,
          statusMessage: str(h.statusMessage),
        })
      }
    }
  }
  return out
}

export interface ComponentFile {
  name: string
  file: string
  description: string | null
}

export interface PluginItem {
  id: string
  name: string
  marketplace: string
  version: string | null
  scope: string
  projectPath: string | null
  installPath: string | null
  installedAt: string | null
  lastUpdated: string | null
  gitCommitSha: string | null
  /** enabledPlugins in ~/.claude/settings.json: true / false / not listed. */
  userEnabled: boolean | null
  /** Projects whose .claude/settings*.json enable or disable it. */
  projectEnables: { path: string; enabled: boolean }[]
  enabled: boolean
  description: string | null
  author: string | null
  homepage: string | null
  category: string | null
  hasManifest: boolean
  components: {
    skills: ComponentFile[]
    agents: ComponentFile[]
    commands: ComponentFile[]
    hooks: HookDef[]
    mcpServers: McpServerView[]
    lspServers: string[]
  }
  usage: { usageCount: number; lastUsedAt: number | null } | null
  contextTokens: {
    alwaysOn: number
    onInvoke: number
    model: string
    asOf: string | null
  } | null
  otherVersions: string[]
}

export interface Marketplace {
  name: string
  source: string
  installLocation: string | null
  lastUpdated: string | null
  pluginCount: number | null
}

async function marketplaceEntries(mkt: string): Promise<Map<string, Obj>> {
  return cached(`marketplace:${mkt}`, TTL.storage, async () => {
    const data = await readJsonObj(claudePath('plugins', 'marketplaces', mkt, '.claude-plugin', 'marketplace.json'))
    const map = new Map<string, Obj>()
    for (const p of Array.isArray(data?.plugins) ? data.plugins : [])
      if (isObj(p) && str(p.name)) map.set(p.name as string, p)
    return map
  })
}

async function catalog(): Promise<{ fetchedAt: string | null; plugins: Obj }> {
  return cached('plugin-catalog', TTL.storage, async () => {
    const data = await readJsonObj(claudePath('plugins', 'plugin-catalog-cache.json'))
    const cat = isObj(data?.catalog) ? data.catalog : {}
    return {
      fetchedAt: str(data?.fetchedAt) ?? str(cat.generated_at),
      plugins: isObj(cat.plugins) ? cat.plugins : {},
    }
  })
}

async function mdComponents(
  dir: string,
  explicit: string[] | null,
  root: string,
  recursive = false,
): Promise<ComponentFile[]> {
  let files: string[]
  if (explicit) files = explicit.map(f => path.resolve(root, f)).filter(f => f.endsWith('.md'))
  else if (await isDir(dir))
    files = (await listFilesRecursive(dir, '.md', recursive ? 3 : 0)).map(f => path.join(dir, f))
  else files = []
  const out: ComponentFile[] = []
  for (const file of files) {
    const base = path.basename(file)
    if (base.startsWith('_') || base === 'README.md') continue
    const fm = await readFrontmatter(file)
    if (!fm) continue
    out.push({
      name: str(fm.data.name) ?? base.replace(/\.md$/, ''),
      file,
      description: str(fm.data.description),
    })
  }
  return out
}

async function skillComponents(skillsDir: string): Promise<ComponentFile[]> {
  const out: ComponentFile[] = []
  for (const name of await listSubdirs(skillsDir)) {
    const file = path.join(skillsDir, name, 'SKILL.md')
    const fm = await readFrontmatter(file)
    if (fm)
      out.push({
        name: str(fm.data.name) ?? name,
        file,
        description: str(fm.data.description),
      })
  }
  return out
}

function pathList(v: unknown): string[] | null {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return strArray(v)
  return null
}

async function components(installPath: string | null, entry: Obj | undefined) {
  const result: PluginItem['components'] = {
    skills: [],
    agents: [],
    commands: [],
    hooks: [],
    mcpServers: [],
    lspServers: [],
  }
  if (entry && isObj(entry.lspServers)) result.lspServers = Object.keys(entry.lspServers)
  if (!installPath || !(await isDir(installPath))) return { result, manifest: null as Obj | null }
  const manifest = await readJsonObj(path.join(installPath, '.claude-plugin', 'plugin.json'))
  result.commands = await mdComponents(
    path.join(installPath, 'commands'),
    pathList(manifest?.commands),
    installPath,
    true,
  )
  result.agents = await mdComponents(path.join(installPath, 'agents'), pathList(manifest?.agents), installPath)
  for (const skillsPath of pathList(manifest?.skills) ?? ['skills']) {
    result.skills.push(...(await skillComponents(path.resolve(installPath, skillsPath))))
  }
  const hooksFile =
    typeof manifest?.hooks === 'string'
      ? path.resolve(installPath, manifest.hooks)
      : path.join(installPath, 'hooks', 'hooks.json')
  const hooksJson = isObj(manifest?.hooks) ? { hooks: manifest.hooks } : await readJsonObj(hooksFile)
  result.hooks = flattenHooks(hooksJson?.hooks).map(h => ({
    ...h,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal variable name Claude Code expands
    command: h.command.replaceAll(installPath, '${CLAUDE_PLUGIN_ROOT}'),
  }))
  let mcp: unknown = null
  if (typeof manifest?.mcpServers === 'string')
    mcp = (await readJsonObj(path.resolve(installPath, manifest.mcpServers)))?.mcpServers
  else if (isObj(manifest?.mcpServers)) mcp = manifest.mcpServers
  else mcp = (await readJsonObj(path.join(installPath, '.mcp.json')))?.mcpServers
  if (isObj(mcp)) result.mcpServers = Object.entries(mcp).map(([name, cfg]) => mcpServerView(name, cfg))
  if (isObj(manifest?.lspServers)) result.lspServers = Object.keys(manifest.lspServers)
  return { result, manifest }
}

async function load(projectRoots: string[]): Promise<{ plugins: PluginItem[]; marketplaces: Marketplace[] }> {
  const installed = await readJsonObj(claudePath('plugins', 'installed_plugins.json'))
  const settings = await readJsonObj(claudePath('settings.json'))
  const userEnabled = isObj(settings?.enabledPlugins) ? settings.enabledPlugins : {}
  const claudeJson = await readClaudeJson()
  const cat = await catalog()

  const projectEnables = new Map<string, { path: string; enabled: boolean }[]>()
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    for (const s of [cfg.settings, cfg.settingsLocal]) {
      if (!isObj(s?.enabledPlugins)) continue
      for (const [id, on] of Object.entries(s.enabledPlugins)) {
        if (typeof on !== 'boolean') continue
        const list = projectEnables.get(id) ?? []
        list.push({ path: root, enabled: on })
        projectEnables.set(id, list)
      }
    }
  }

  const plugins: PluginItem[] = []
  const entries = isObj(installed?.plugins) ? installed.plugins : {}
  for (const [id, installs] of Object.entries(entries)) {
    const [name = id, marketplace = ''] = id.split('@')
    const install = Array.isArray(installs) && isObj(installs[0]) ? installs[0] : {}
    const installPath = str(install.installPath)
    const entry = (await marketplaceEntries(marketplace)).get(name)
    const { result, manifest } = await components(installPath, entry)
    const versionsDir = installPath ? path.dirname(installPath) : null
    const versions = versionsDir ? await listSubdirs(versionsDir) : []
    const user = typeof userEnabled[id] === 'boolean' ? (userEnabled[id] as boolean) : null
    const projects = projectEnables.get(id) ?? []
    const cat0 = isObj(cat.plugins[id]) ? (cat.plugins[id] as Obj) : null
    let contextTokens: PluginItem['contextTokens'] = null
    if (cat0 && isObj(cat0.tokens)) {
      const [model, t] = Object.entries(cat0.tokens)[0] ?? []
      if (model && isObj(t))
        contextTokens = {
          model,
          alwaysOn: num(t.always_on) ?? 0,
          onInvoke: num(t.on_invoke) ?? 0,
          asOf: cat.fetchedAt,
        }
    }
    const author = manifest?.author ?? entry?.author
    plugins.push({
      id,
      name,
      marketplace,
      version: str(install.version),
      scope: str(install.scope) ?? 'user',
      projectPath: str(install.projectPath),
      installPath,
      installedAt: str(install.installedAt),
      lastUpdated: str(install.lastUpdated),
      gitCommitSha: str(install.gitCommitSha),
      userEnabled: user,
      projectEnables: projects,
      enabled: user === true || projects.some(p => p.enabled),
      description: str(manifest?.description) ?? str(entry?.description),
      author: isObj(author) ? str(author.name) : str(author),
      homepage: str(manifest?.homepage) ?? str(entry?.homepage),
      category: str(entry?.category),
      hasManifest: manifest !== null,
      components: result,
      usage: claudeJson.pluginUsage[id] ?? null,
      contextTokens,
      otherVersions: versions.filter(v => installPath && v !== path.basename(installPath)),
    })
  }

  const known = await readJsonObj(claudePath('plugins', 'known_marketplaces.json'))
  const marketplaces: Marketplace[] = []
  for (const [mkt, info] of Object.entries(known ?? {})) {
    if (!isObj(info)) continue
    const src = isObj(info.source) ? info.source : {}
    marketplaces.push({
      name: mkt,
      source: str(src.repo) ?? str(src.url) ?? str(src.source) ?? 'unknown',
      installLocation: str(info.installLocation),
      lastUpdated: str(info.lastUpdated),
      pluginCount: (await marketplaceEntries(mkt)).size || null,
    })
  }
  // Marketplace checkouts not listed in known_marketplaces.json.
  for (const entry of await listDir(claudePath('plugins', 'marketplaces'))) {
    if (entry.isDirectory() && !marketplaces.some(m => m.name === entry.name)) {
      marketplaces.push({
        name: entry.name,
        source: 'local',
        installLocation: null,
        lastUpdated: null,
        pluginCount: null,
      })
    }
  }
  return {
    plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
    marketplaces,
  }
}

export function readPlugins(projectRoots: string[]) {
  return cached('plugins', TTL.config * 3, () => load(projectRoots))
}
