// What is running now: Claude Code processes (sessions/<pid>.json), IDE
// connections (ide/<port>.lock), background jobs and claude-visualizer
// receivers. Only listed fields are read: the .key files, IDE auth tokens and
// receiver tokens next to them are never sent anywhere.
import path from 'node:path'
import { cached } from './cache.ts'
import { isObj, listDir, num, readJsonObj, str, strArray } from './fs.ts'
import { claudePath, tildify } from './paths.ts'
import { oneLine } from './transcript/prompts.ts'

export function isAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface RunningSession {
  pid: number | null
  alive: boolean
  sessionId: string | null
  cwd: string | null
  displayCwd: string | null
  name: string | null
  status: string | null
  version: string | null
  kind: string | null
  entrypoint: string | null
  startedAt: number | null
  updatedAt: number | null
}

export interface RuntimeReport {
  sessions: RunningSession[]
  ides: {
    port: string
    pid: number | null
    alive: boolean
    ideName: string | null
    workspaceFolders: string[]
  }[]
  jobs: {
    id: string
    name: string | null
    state: string | null
    cwd: string | null
    detail: string | null
    updatedAt: string | null
  }[]
  visualizers: {
    pid: number | null
    alive: boolean
    port: number | null
    workspace: string | null
  }[]
  daemon: {
    supervisorPid: number | null
    alive: boolean
    workers: number
  } | null
}

async function load(): Promise<RuntimeReport> {
  const sessions: RunningSession[] = []
  for (const e of await listDir(claudePath('sessions'))) {
    // <pid>.json only; <pid>.<hash>.key files hold peer tokens and are skipped.
    if (!/^\d+\.json$/.test(e.name)) continue
    const s = await readJsonObj(claudePath('sessions', e.name))
    if (!s) continue
    const pid = num(s.pid)
    const cwd = str(s.cwd)
    sessions.push({
      pid,
      alive: isAlive(pid),
      sessionId: str(s.sessionId),
      cwd,
      displayCwd: cwd ? tildify(cwd) : null,
      name: str(s.name),
      status: str(s.status),
      version: str(s.version),
      kind: str(s.kind),
      entrypoint: str(s.entrypoint),
      startedAt: num(s.startedAt),
      updatedAt: num(s.updatedAt) ?? num(s.statusUpdatedAt),
    })
  }
  sessions.sort((a, b) => Number(b.alive) - Number(a.alive) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  const ides: RuntimeReport['ides'] = []
  for (const e of await listDir(claudePath('ide'))) {
    if (!e.name.endsWith('.lock')) continue
    const lock = await readJsonObj(claudePath('ide', e.name))
    if (!lock) continue
    const pid = num(lock.pid)
    // authToken is deliberately not read.
    ides.push({
      port: e.name.replace(/\.lock$/, ''),
      pid,
      alive: isAlive(pid),
      ideName: str(lock.ideName),
      workspaceFolders: strArray(lock.workspaceFolders).map(tildify),
    })
  }

  const jobs: RuntimeReport['jobs'] = []
  for (const e of await listDir(claudePath('jobs'))) {
    if (!e.isDirectory()) continue
    // state.json also holds providerEnv; only the fields below are read.
    const state = await readJsonObj(path.join(claudePath('jobs', e.name), 'state.json'))
    if (!state) continue
    const detail = str(state.detail)
    jobs.push({
      id: e.name,
      name: str(state.name),
      state: str(state.state),
      cwd: str(state.cwd) ? tildify(state.cwd as string) : null,
      detail: detail ? oneLine(detail, 200) : null,
      updatedAt: str(state.updatedAt),
    })
  }

  const visualizers: RuntimeReport['visualizers'] = []
  for (const e of await listDir(claudePath('claude-visualizer', 'instances'))) {
    if (!e.name.endsWith('.json')) continue
    const inst = await readJsonObj(claudePath('claude-visualizer', 'instances', e.name))
    if (!inst) continue
    const pid = num(inst.pid)
    // token is deliberately not read.
    visualizers.push({
      pid,
      alive: isAlive(pid),
      port: num(inst.port),
      workspace: str(inst.workspace) ? tildify(inst.workspace as string) : null,
    })
  }

  const roster = await readJsonObj(claudePath('daemon', 'roster.json'))
  const supervisorPid = roster ? num(roster.supervisorPid) : null
  return {
    sessions,
    ides,
    jobs,
    visualizers,
    daemon: roster
      ? {
          supervisorPid,
          alive: isAlive(supervisorPid),
          workers: isObj(roster.workers) ? Object.keys(roster.workers).length : 0,
        }
      : null,
  }
}

export function readRuntime(): Promise<RuntimeReport> {
  return cached('runtime', 3_000, load)
}
