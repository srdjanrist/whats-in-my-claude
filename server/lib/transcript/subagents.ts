// A session's subagents: <session id>/subagents/agent-<id>.jsonl plus a
// .meta.json next to each. Adapted from claude-visualizer
// (src/transcript/read.ts: listSubagents, readAgentMeta). Older Claude Code
// versions wrote agent-*.jsonl at the top of the project folder instead.
import fs from 'node:fs'
import path from 'node:path'
import { isObj, str } from '../fs.ts'

export interface SubagentFile {
  agentId: string
  file: string
  meta: string
}

export interface AgentMeta {
  agentType: string | null
  description: string | null
  /** The Agent tool call that launched it. */
  toolUseId: string | null
  spawnDepth: number | null
  model: string | null
  isFork: boolean
  finished: boolean | null
}

export function subagentsDir(transcript: string): string {
  return path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents')
}

export function listSubagents(transcript: string): SubagentFile[] {
  const dir = subagentsDir(transcript)
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap(name => {
    const match = /^agent-(.+)\.jsonl$/.exec(name)
    return match?.[1]
      ? [
          {
            agentId: match[1],
            file: path.join(dir, name),
            meta: path.join(dir, `agent-${match[1]}.meta.json`),
          },
        ]
      : []
  })
}

export function readAgentMeta(file: string): AgentMeta | null {
  try {
    const meta: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isObj(meta)) return null
    return {
      agentType: str(meta.agentType),
      description: str(meta.description),
      toolUseId: str(meta.toolUseId),
      spawnDepth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : null,
      model: str(meta.model) ?? str(meta.pickedEffortModel),
      isFork: meta.isFork === true,
      finished: typeof meta.finished === 'boolean' ? meta.finished : null,
    }
  } catch {
    return null
  }
}
