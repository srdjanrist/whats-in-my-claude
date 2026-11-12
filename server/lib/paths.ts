// Where Claude Code keeps its files. Adapted from claude-visualizer's
// src/paths.ts. Everything is computed on each call so tests can point
// WIMC_HOME / CLAUDE_CONFIG_DIR at a fixture before reading.
import os from 'node:os'
import path from 'node:path'

/** The home directory to read from: WIMC_HOME (tests) or the real one. */
export function homeDir(): string {
  return process.env.WIMC_HOME || os.homedir()
}

/** Claude Code's config dir: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(homeDir(), '.claude')
}

/** The global state file: ~/.claude.json, or inside CLAUDE_CONFIG_DIR when that is set. */
export function claudeJsonPath(): string {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(homeDir(), '.claude.json')
}

/** The shared agent-skills dir used by the `skills` CLI: ~/.agents. */
export function agentsDir(): string {
  return path.join(homeDir(), '.agents')
}

export const claudePath = (...parts: string[]) => path.join(claudeDir(), ...parts)

/** Claude Code names a project's transcript folder after its path, with every other character turned into '-'. */
export function encodeProjectDir(p: string): string {
  return p.replace(/[^A-Za-z0-9]/g, '-')
}

/** Shortens paths under the home dir to ~/… for display. */
export function tildify(p: string): string {
  const home = homeDir()
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p
}

/** Where whats-in-my-claude keeps its own cache: never inside ~/.claude. */
export function appCacheDir(): string {
  return process.env.WIMC_CACHE_DIR || path.resolve(import.meta.dirname, '../../.cache')
}
