// Hooks from user settings, project settings and enabled plugins, plus the
// activity log the claude-visualizer hook writes (when it is installed).
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { isObj, readJsonObj, readText, str } from './fs.ts'
import { dayOf } from './history.ts'
import { claudePath } from './paths.ts'
import { flattenHooks, type HookDef, type PluginItem } from './plugins.ts'
import { projectConfig } from './project-config.ts'

export type HookSource = 'user' | 'user-local' | 'project' | 'project-local' | 'plugin'

export interface HookItem extends HookDef {
  id: string
  source: HookSource
  origin: string
  enabled: boolean
}

async function load(plugins: PluginItem[], projectRoots: string[]): Promise<HookItem[]> {
  const out: HookItem[] = []
  const add = (hooks: HookDef[], source: HookSource, origin: string, enabled: boolean) => {
    hooks.forEach((h, i) => {
      out.push({
        ...h,
        id: `${source}:${origin}:${h.event}:${i}`,
        source,
        origin,
        enabled,
      })
    })
  }

  const userSettings = claudePath('settings.json')
  add(flattenHooks((await readJsonObj(userSettings))?.hooks), 'user', userSettings, true)
  const userLocal = claudePath('settings.local.json')
  add(flattenHooks((await readJsonObj(userLocal))?.hooks), 'user-local', userLocal, true)
  for (const root of projectRoots) {
    const cfg = await projectConfig(root)
    add(flattenHooks(cfg.settings?.hooks), 'project', root, true)
    add(flattenHooks(cfg.settingsLocal?.hooks), 'project-local', root, true)
  }
  for (const plugin of plugins) add(plugin.components.hooks, 'plugin', plugin.id, plugin.enabled)
  return out
}

export function readHooks(plugins: PluginItem[], projectRoots: string[]) {
  return cached('hooks', TTL.config * 3, () => load(plugins, projectRoots))
}

export interface HookActivity {
  available: boolean
  total: number
  byDay: { day: string; count: number }[]
  byEvent: Record<string, number>
  byTool: Record<string, number>
}

/** Events per day from ~/.claude/claude-visualizer/logs/hooks*.jsonl ({ts, event, session, cwd, tool}). */
async function loadActivity(): Promise<HookActivity> {
  const dir = claudePath('claude-visualizer', 'logs')
  const texts = await Promise.all(['hooks.1.jsonl', 'hooks.jsonl'].map(f => readText(path.join(dir, f))))
  if (texts.every(t => t === null)) return { available: false, total: 0, byDay: [], byEvent: {}, byTool: {} }
  const days = new Map<string, number>()
  const byEvent: Record<string, number> = {}
  const byTool: Record<string, number> = {}
  let total = 0
  for (const text of texts) {
    for (const line of text?.split('\n') ?? []) {
      if (!line) continue
      let v: unknown
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObj(v)) continue
      const at = typeof v.ts === 'number' ? v.ts : typeof v.ts === 'string' ? Date.parse(v.ts) : Number.NaN
      if (Number.isNaN(at)) continue
      total++
      const day = dayOf(at)
      days.set(day, (days.get(day) ?? 0) + 1)
      const event = str(v.event) ?? 'unknown'
      byEvent[event] = (byEvent[event] ?? 0) + 1
      const tool = str(v.tool)
      if (tool) byTool[tool] = (byTool[tool] ?? 0) + 1
    }
  }
  return {
    available: true,
    total,
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
    byEvent,
    byTool,
  }
}

export function readHookActivity(): Promise<HookActivity> {
  return cached('hook-activity', 60_000, loadActivity)
}
