// Telling typed prompts apart from injected ones. Ported from
// claude-visualizer (src/transcript/fold.ts: isHumanPrompt, promptText).
import { type Block, textOf, type UserRecord } from './records.ts'

export const PROMPT_MAX = 300

/** Collapses whitespace to single spaces and cuts to `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Whether a user record is something a person typed (or a slash command they ran). */
export function isHumanPrompt(r: UserRecord): boolean {
  if (r.origin !== null) return r.origin === 'human' && !r.isMeta && !r.hasToolResult
  // Older versions don't say where a message came from.
  if (r.isMeta || r.isCompactSummary || r.hasToolResult) return false
  const text = textOf(r.content).trimStart()
  return text !== '' && !/^(<system-reminder>|<task-notification>|\[Request interrupted|<local-command)/.test(text)
}

/** A prompt as one line: slash commands as `/name args`, without injected reminders. */
export function promptText(content: string | Block[], max = PROMPT_MAX): string {
  const parts =
    typeof content === 'string'
      ? [content]
      : content.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
  const text = parts
    .map(t => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
    .filter(t => t.trim() !== '')
    .join(' ')
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)
    return oneLine(`${command[1]} ${args?.[1] ?? ''}`, max)
  }
  return oneLine(text, max)
}
