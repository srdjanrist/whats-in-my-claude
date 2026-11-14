// Maps times to horizontal positions (0–100 %) for the session timeline. A
// resumed session can sit idle for hours or days between bursts of work, so
// long idle gaps collapse into narrow breaks and the width goes to the
// stretches where something happened. No imports, so it is easy to test.

export interface Span {
  from: number
  to: number
}

/** A stretch of time and where it sits horizontally, in %. */
export interface Band extends Span {
  x0: number
  x1: number
}

export interface Tick {
  at: number
  x: number
  label: string
}

export interface Scale {
  x: (t: number) => number
  /** Where something happened, in time order. */
  stretches: Band[]
  /** Collapsed idle gaps between stretches. */
  breaks: Band[]
  ticks: Tick[]
  /** The session runs over more than one calendar day (ticks then carry dates). */
  multiDay: boolean
  empty: boolean
}

export interface ScaleOptions {
  /** Gaps longer than this become breaks. */
  breakAfterMs?: number
  /** Width of one break, in %. */
  breakPct?: number
  /** The narrowest a stretch gets, as a share of the width, in %. */
  minStretchPct?: number
  /** Roughly how far apart ticks are, in %. */
  tickEveryPct?: number
  label?: (t: number, withDate: boolean) => string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY]
/** An instant is drawn as a minute, so it has some width. */
const PAD = 30_000

function defaultLabel(t: number, withDate: boolean): string {
  const d = new Date(t)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return withDate ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}` : time
}

const dayOf = (t: number) => new Date(t).toDateString()

export function buildScale(spans: Span[], options: ScaleOptions = {}): Scale {
  const breakAfter = options.breakAfterMs ?? 30 * MIN
  const breakPct = options.breakPct ?? 3
  const minStretchPct = options.minStretchPct ?? 3
  const tickEvery = options.tickEveryPct ?? 12
  const label = options.label ?? defaultLabel

  const valid = spans
    .filter(s => Number.isFinite(s.from) && Number.isFinite(s.to))
    .map(s => (s.from <= s.to ? { ...s } : { from: s.to, to: s.from }))
    .sort((a, b) => a.from - b.from)
  if (valid.length === 0) return { x: () => 0, stretches: [], breaks: [], ticks: [], multiDay: false, empty: true }

  const merged: Span[] = []
  for (const s of valid) {
    const last = merged.at(-1)
    if (last && s.from - last.to <= breakAfter) last.to = Math.max(last.to, s.to)
    else merged.push(s)
  }
  const raw = merged.map(s => {
    if (s.to - s.from >= 2 * PAD) return s
    const mid = (s.from + s.to) / 2
    return { from: mid - PAD, to: mid + PAD }
  })

  const gaps = raw.length - 1
  const gapPct = gaps ? Math.min(breakPct, 30 / gaps) : 0
  const avail = 100 - gaps * gapPct
  const total = raw.reduce((n, s) => n + (s.to - s.from), 0)
  const weights = raw.map(s => Math.max(s.to - s.from, (total * minStretchPct) / 100))
  const weightSum = weights.reduce((a, b) => a + b, 0)

  const stretches: Band[] = []
  const breaks: Band[] = []
  const bands: Band[] = []
  let x = 0
  raw.forEach((s, i) => {
    const w = (avail * (weights[i] ?? 0)) / weightSum
    const stretch = { ...s, x0: x, x1: i === raw.length - 1 ? 100 : x + w }
    stretches.push(stretch)
    bands.push(stretch)
    x = stretch.x1
    const next = raw[i + 1]
    if (next) {
      const gap = { from: s.to, to: next.from, x0: x, x1: x + gapPct }
      breaks.push(gap)
      bands.push(gap)
      x = gap.x1
    }
  })

  const first = bands[0] as Band
  const last = bands.at(-1) as Band
  const xOf = (t: number): number => {
    if (t <= first.from) return 0
    if (t >= last.to) return 100
    let lo = 0
    let hi = bands.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((bands[mid] as Band).from <= t) lo = mid
      else hi = mid - 1
    }
    const b = bands[lo] as Band
    const span = b.to - b.from
    return span > 0 ? b.x0 + ((b.x1 - b.x0) * (t - b.from)) / span : b.x0
  }

  const multiDay = dayOf(first.from) !== dayOf(last.to)
  const ticks: Tick[] = []
  let lastX = Number.NEGATIVE_INFINITY
  let lastLength = 0
  let lastDay = ''
  const add = (at: number) => {
    const px = xOf(at)
    const day = dayOf(at)
    const text = label(at, multiDay && day !== lastDay)
    // Labels need room: about 1.3 % per character on a ~550 px track (the narrowest it gets).
    if (px - lastX < Math.max(6, lastLength * 1.3)) return false
    ticks.push({ at, x: px, label: text })
    lastX = px
    lastLength = text.length
    lastDay = day
    return true
  }
  for (const s of stretches) {
    const n = Math.max(1, Math.round((s.x1 - s.x0) / tickEvery))
    const step = STEPS.find(v => v >= (s.to - s.from) / n) ?? Math.ceil((s.to - s.from) / n / DAY) * DAY
    // Align to the local clock (10:15, not 10:13).
    const offset = new Date(s.from).getTimezoneOffset() * MIN
    let at = Math.ceil((s.from - offset) / step) * step + offset
    let placed = 0
    for (; at <= s.to; at += step) if (add(at)) placed++
    if (placed === 0) add(s.from)
  }
  ticks.sort((a, b) => a.at - b.at)

  return { x: xOf, stretches, breaks, ticks, multiDay, empty: false }
}
