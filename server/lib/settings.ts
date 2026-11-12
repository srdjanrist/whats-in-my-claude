// User settings (redacted) and the permission rules spread across every
// project's .claude/settings*.json.
import { cached, TTL } from './cache.ts'
import { exists, isObj, readJsonObj, str, strArray } from './fs.ts'
import { claudePath } from './paths.ts'
import { projectConfig } from './project-config.ts'
import { maskTokens, redactSettings } from './redact.ts'

const MANAGED = '/Library/Application Support/ClaudeCode/managed-settings.json'

export interface SettingsFile {
  label: string
  path: string
  exists: boolean
  /** Redacted copy of the whole file. */
  content: unknown
}

export interface PermissionRule {
  rule: string
  kind: 'allow' | 'deny' | 'ask'
  /** The tool the rule is for: Bash, WebFetch, mcp__server__tool… */
  tool: string
  projects: string[]
}

export interface PermissionSummary {
  rules: PermissionRule[]
  defaultModes: { path: string; mode: string }[]
  additionalDirectories: { path: string; dirs: string[] }[]
  filesScanned: number
}

async function settingsFile(label: string, file: string): Promise<SettingsFile> {
  const data = await readJsonObj(file)
  return {
    label,
    path: file,
    exists: data !== null || (await exists(file)),
    content: data ? redactSettings(data) : null,
  }
}

async function loadUser(): Promise<SettingsFile[]> {
  return Promise.all([
    settingsFile('User settings', claudePath('settings.json')),
    settingsFile('User local settings', claudePath('settings.local.json')),
    settingsFile('Managed settings', MANAGED),
    settingsFile('Keybindings', claudePath('keybindings.json')),
  ])
}

export function readUserSettings() {
  return cached('user-settings', TTL.config, loadUser)
}

function toolOf(rule: string): string {
  return /^([A-Za-z0-9_]+)/.exec(rule)?.[1] ?? rule
}

async function loadPermissions(projectRoots: string[]): Promise<PermissionSummary> {
  const rules = new Map<string, PermissionRule>()
  const defaultModes: PermissionSummary['defaultModes'] = []
  const additionalDirectories: PermissionSummary['additionalDirectories'] = []
  let filesScanned = 0
  const collect = (settings: unknown, owner: string) => {
    if (!isObj(settings) || !isObj(settings.permissions)) return
    filesScanned++
    const p = settings.permissions
    for (const kind of ['allow', 'deny', 'ask'] as const) {
      for (const raw of strArray(p[kind])) {
        const rule = maskTokens(raw)
        const key = `${kind}:${rule}`
        const existing = rules.get(key) ?? {
          rule,
          kind,
          tool: toolOf(rule),
          projects: [],
        }
        if (!existing.projects.includes(owner)) existing.projects.push(owner)
        rules.set(key, existing)
      }
    }
    const mode = str(p.defaultMode)
    if (mode) defaultModes.push({ path: owner, mode })
    const dirs = strArray(p.additionalDirectories)
    if (dirs.length) additionalDirectories.push({ path: owner, dirs })
  }
  collect(await readJsonObj(claudePath('settings.json')), '~/.claude/settings.json')
  collect(await readJsonObj(claudePath('settings.local.json')), '~/.claude/settings.local.json')
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    collect(cfg.settings, root)
    collect(cfg.settingsLocal, root)
  }
  return {
    rules: [...rules.values()].sort((a, b) => b.projects.length - a.projects.length || a.rule.localeCompare(b.rule)),
    defaultModes,
    additionalDirectories,
    filesScanned,
  }
}

export function readPermissions(projectRoots: string[]) {
  return cached('permissions', TTL.config * 3, () => loadPermissions(projectRoots))
}
