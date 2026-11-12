// Display formatting. ago / duration / shortCount are adapted from
// claude-visualizer (src/format.ts); they take epoch ms here.

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (ms === null || ms === undefined) return '—'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`
  if (s < 86400 * 730) return `${Math.floor(s / (86400 * 30))}mo ago`
  return `${Math.floor(s / (86400 * 365))}y ago`
}

/** A duration such as 45s, 1m12s, 30m or 2h05m. */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const pad = (n: number) => String(n).padStart(2, '0')
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? `${pad(s % 60)}s` : ''}`
  const m = Math.floor(s / 60) % 60
  if (s < 86400 * 2) return `${Math.floor(s / 3600)}h${m ? `${pad(m)}m` : ''}`
  return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h`
}

const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.0$/, '')

/** A count for display: 950, 12.5k, 640k, 1.2M, 3.4B. */
export function shortCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1e6) return `${trim(n / 1e3, abs < 1e4 ? 1 : 0)}k`
  if (abs < 1e9) return `${trim(n / 1e6, abs < 1e7 ? 1 : 0)}M`
  return `${trim(n / 1e9, abs < 1e10 ? 1 : 0)}B`
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${trim(v, v < 10 ? 1 : 0)} ${units[i]}`
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })}`
}

export function date(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const d = new Date(ms)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
}

export function dateTime(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const d = new Date(ms)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`
}

export interface Tokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const totalTokens = (t: Tokens | null | undefined) => (t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0)

/** Short model label: claude-opus-5-5 → opus 5.5. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!m) return model
  return `${m[1]} ${m[2]}${m[3] && m[3].length <= 2 ? `.${m[3]}` : ''}`
}
