// Things in the setup worth a look: inline credentials, disabled or stale
// plugins, broken or duplicated skills, memory index drift, hooks pointing at
// missing scripts, stale caches.
import { readDefinitions } from './agents.ts'
import { cached, TTL } from './cache.ts'
import { exists, listDir, readJsonObj, str } from './fs.ts'
import { readHooks } from './hooks.ts'
import { readMcpServers } from './mcp.ts'
import { readMemories } from './memories.ts'
import { claudePath, tildify } from './paths.ts'
import { setupContext } from './setup.ts'
import { readSkills } from './skills.ts'

export interface Warning {
  id: string
  severity: 'security' | 'warning' | 'info'
  title: string
  detail: string
  paths: string[]
  /** An app route to look at it. */
  link: string | null
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Script files a hook command runs, as absolute paths. $CLAUDE_PROJECT_DIR and
 * relative paths resolve against the project root; for user hooks relative
 * paths are ambiguous (they depend on the session's cwd) and are skipped.
 */
export function hookScripts(command: string, projectRoot: string | null): string[] {
  const home = process.env.WIMC_HOME || process.env.HOME || ''
  let cmd = command
  if (projectRoot) cmd = cmd.replace(/"?\$\{?CLAUDE_PROJECT_DIR\}?"?/g, projectRoot)
  else if (/\$\{?CLAUDE_PROJECT_DIR/.test(cmd)) return []
  const out: string[] = []
  for (const raw of cmd.split(/\s+/)) {
    const token = raw.replace(/^["']|["';]+$/g, '')
    if (!/\.(c?js|mjs|ts|sh|py|rb)$/.test(token) || token.includes('$') || token.includes('*')) continue
    if (token.startsWith('/')) out.push(token)
    else if (token.startsWith('~/')) out.push(home + token.slice(1))
    else if (projectRoot && !token.startsWith('-')) out.push(`${projectRoot}/${token}`)
  }
  return out
}

async function load(): Promise<Warning[]> {
  const { projects, roots, plugins } = await setupContext()
  const [mcp, skills, hooks, memories] = await Promise.all([
    readMcpServers(plugins, roots),
    readSkills(plugins, roots),
    readHooks(plugins, roots),
    readMemories(),
    readDefinitions(plugins, roots),
  ])
  const out: Warning[] = []

  // Inline credentials in MCP configs, grouped by the file they live in.
  const secretsByOrigin = new Map<string, { scope: string; entries: string[] }>()
  for (const s of mcp) {
    if (s.inlineSecrets.length === 0) continue
    const g = secretsByOrigin.get(s.origin) ?? { scope: s.scope, entries: [] }
    g.entries.push(...s.inlineSecrets.map(x => `${s.name} → ${x.field}.${x.key}`))
    secretsByOrigin.set(s.origin, g)
  }
  for (const [origin, g] of secretsByOrigin) {
    const file = g.scope === 'project' ? `${origin}/.mcp.json` : origin
    out.push({
      id: `mcp-secret:${origin}`,
      severity: 'security',
      title: `Credential stored inline in ${g.scope === 'project' ? '.mcp.json' : 'an MCP config'}`,
      detail: `${tildify(file)} sets ${g.entries.join(', ')} as a literal value. Prefer \${ENV_VAR} references; a project .mcp.json is often committed to git.`,
      paths: [file],
      link: '/mcp',
    })
  }

  for (const p of plugins) {
    if (!p.enabled) {
      out.push({
        id: `plugin-disabled:${p.id}`,
        severity: 'info',
        title: `Plugin ${p.name} is installed but not enabled`,
        detail:
          p.scope === 'project'
            ? `Installed for ${p.projectPath ? tildify(p.projectPath) : 'a project'}, not enabled in user settings or any scanned project.`
            : 'It is not listed (or set to false) in enabledPlugins.',
        paths: p.installPath ? [p.installPath] : [],
        link: `/plugins/${encodeURIComponent(p.id)}`,
      })
    }
    if (p.otherVersions.length > 0) {
      out.push({
        id: `plugin-versions:${p.id}`,
        severity: 'info',
        title: `Old ${p.name} versions still on disk`,
        detail: `${p.otherVersions.join(', ')} next to the installed ${p.version ?? 'version'}.`,
        paths: [],
        link: `/plugins/${encodeURIComponent(p.id)}`,
      })
    }
  }

  for (const s of skills.filter(s => s.broken)) {
    out.push({
      id: `skill-broken:${s.id}`,
      severity: 'warning',
      title: `Skill ${s.name} is broken`,
      detail: s.isSymlink ? `Symlink to ${s.symlinkTarget} doesn't resolve to a SKILL.md.` : 'No readable SKILL.md.',
      paths: [s.dir],
      link: '/skills',
    })
  }
  const copies = new Map<string, string[]>()
  for (const s of skills) {
    if (s.source !== 'user' && s.source !== 'agents') continue
    copies.set(s.name, [...(copies.get(s.name) ?? []), s.realPath ?? s.dir])
  }
  for (const [name, paths] of copies) {
    if (new Set(paths).size > 1) {
      out.push({
        id: `skill-copies:${name}`,
        severity: 'info',
        title: `Skill ${name} exists as separate copies`,
        detail:
          'It is in ~/.claude/skills and ~/.agents/skills as two real folders rather than one symlink, so they can drift apart.',
        paths,
        link: '/skills',
      })
    }
  }

  for (const d of memories.dirs) {
    if (d.dead.length === 0 && d.orphans.length === 0) continue
    out.push({
      id: `memory-index:${d.projectId}`,
      severity: 'info',
      title: `Memory index out of sync for ${projects.find(p => p.id === d.projectId)?.displayPath ?? d.projectId}`,
      detail: [
        d.dead.length ? `${d.dead.length} MEMORY.md entries point at missing files` : '',
        d.orphans.length ? `${d.orphans.length} memory files aren't in MEMORY.md` : '',
      ]
        .filter(Boolean)
        .join('; '),
      paths: [d.dir],
      link: '/memories',
    })
  }

  // Hook commands whose script file doesn't exist.
  for (const h of hooks) {
    if (h.source === 'plugin') continue
    const projectRoot = h.source === 'project' || h.source === 'project-local' ? h.origin : null
    for (const file of hookScripts(h.command, projectRoot)) {
      if (!(await exists(file))) {
        out.push({
          id: `hook-missing:${h.id}`,
          severity: 'warning',
          title: `${h.event} hook points at a missing script`,
          detail: `${tildify(file)} (from ${tildify(h.origin)}) doesn't exist; the hook fails every time it runs.`,
          paths: [h.origin],
          link: '/hooks',
        })
      }
    }
  }

  const statsCache = await readJsonObj(claudePath('stats-cache.json'))
  const computed = str(statsCache?.lastComputedDate)
  if (computed && Date.now() - Date.parse(computed) > 30 * DAY) {
    out.push({
      id: 'stats-cache-stale',
      severity: 'info',
      title: "Claude Code's own stats cache is stale",
      detail: `stats-cache.json was last computed on ${computed}. This dashboard computes its numbers from transcripts instead.`,
      paths: [claudePath('stats-cache.json')],
      link: null,
    })
  }

  const backups = (await listDir(claudePath('backups'))).filter(e => e.name.startsWith('.claude.json.backup'))
  if (backups.length > 0) {
    out.push({
      id: 'claude-json-backups',
      severity: 'info',
      title: `${backups.length} copies of ~/.claude.json in backups/`,
      detail: 'Each holds the full account section (OAuth, email, org). Keep them out of anything you sync or share.',
      paths: [claudePath('backups')],
      link: '/storage',
    })
  }

  const orphanDirs = projects.filter(p => p.transcriptDir && p.sessionCount === 0 && p.memoryCount === 0)
  if (orphanDirs.length > 0) {
    out.push({
      id: 'empty-project-dirs',
      severity: 'info',
      title: `${orphanDirs.length} project folders have no transcripts or memory`,
      detail: 'Their sessions were deleted (only an old sessions-index.json or empty folders remain).',
      paths: orphanDirs.map(p => claudePath('projects', p.transcriptDir as string)),
      link: '/storage',
    })
  }

  const order = { security: 0, warning: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

export function readWarnings(): Promise<Warning[]> {
  return cached('warnings', TTL.config * 3, load)
}
