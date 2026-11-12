// What a project's own folder contributes to the setup: CLAUDE.md /
// AGENTS.md, .claude/settings*.json, .mcp.json, and .claude/{commands,
// agents,skills}. Only the project root is looked at (not nested repos).
// Raw objects stay on the server; routes expose redacted views.
import path from 'node:path'
import { cached, TTL } from './cache.ts'
import { isDir, lstatSafe, type Obj, readJsonObj, statSafe } from './fs.ts'
import { claudeDir } from './paths.ts'

export interface InstructionFileRef {
  path: string
  kind: 'CLAUDE.md' | 'AGENTS.md' | 'CLAUDE.local.md' | '.claude/CLAUDE.md'
  bytes: number
  isSymlink: boolean
}

export interface ProjectConfig {
  root: string
  exists: boolean
  instructions: InstructionFileRef[]
  settings: Obj | null
  settingsLocal: Obj | null
  mcpJson: Obj | null
  hasDotClaude: boolean
  commandsDir: string | null
  agentsDir: string | null
  skillsDir: string | null
  hooksDir: string | null
}

const INSTRUCTION_FILES: InstructionFileRef['kind'][] = [
  'CLAUDE.md',
  'AGENTS.md',
  'CLAUDE.local.md',
  '.claude/CLAUDE.md',
]

async function load(root: string): Promise<ProjectConfig> {
  const exists = await isDir(root)
  const empty: ProjectConfig = {
    root,
    exists,
    instructions: [],
    settings: null,
    settingsLocal: null,
    mcpJson: null,
    hasDotClaude: false,
    commandsDir: null,
    agentsDir: null,
    skillsDir: null,
    hooksDir: null,
  }
  // ~/.claude opened as a project: its CLAUDE.md is the global one, shown as such.
  if (!exists || path.resolve(root) === path.resolve(claudeDir())) return empty
  const instructions: InstructionFileRef[] = []
  // When the project is the home folder, its .claude folder *is* ~/.claude:
  // that is user-level config, shown elsewhere, not project config.
  const dotClaude = path.join(root, '.claude')
  const isUserDir = path.resolve(dotClaude) === path.resolve(claudeDir())
  for (const kind of INSTRUCTION_FILES) {
    if (isUserDir && kind === '.claude/CLAUDE.md') continue
    const file = path.join(root, kind)
    const l = await lstatSafe(file)
    if (!l) continue
    const isSymlink = l.isSymbolicLink()
    // Symlinked files: size of the target.
    const bytes = isSymlink ? ((await statSafe(file))?.size ?? 0) : l.size
    instructions.push({ path: file, kind, bytes, isSymlink })
  }
  const hasDotClaude = !isUserDir && (await isDir(dotClaude))
  const sub = async (name: string) => ((await isDir(path.join(dotClaude, name))) ? path.join(dotClaude, name) : null)
  return {
    ...empty,
    instructions,
    settings: hasDotClaude ? await readJsonObj(path.join(dotClaude, 'settings.json')) : null,
    settingsLocal: hasDotClaude ? await readJsonObj(path.join(dotClaude, 'settings.local.json')) : null,
    mcpJson: await readJsonObj(path.join(root, '.mcp.json')),
    hasDotClaude,
    commandsDir: hasDotClaude ? await sub('commands') : null,
    agentsDir: hasDotClaude ? await sub('agents') : null,
    skillsDir: hasDotClaude ? await sub('skills') : null,
    hooksDir: hasDotClaude ? await sub('hooks') : null,
  }
}

export function projectConfig(root: string): Promise<ProjectConfig> {
  return cached(`project-config:${root}`, TTL.config * 3, () => load(root))
}
