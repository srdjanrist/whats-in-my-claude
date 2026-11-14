import { describe, expect, it } from 'vitest'
import { buildScale } from './timeline-scale'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const start = Date.UTC(2026, 10, 1, 10, 0)
const label = (t: number, withDate: boolean) => `${withDate ? 'D' : ''}${t}`

describe('timeline scale', () => {
  it('collapses a gap of days into one narrow break', () => {
    const s = buildScale(
      [
        { from: start, to: start + HOUR },
        { from: start + 3 * DAY, to: start + 3 * DAY + HOUR },
      ],
      { label },
    )
    expect(s.stretches).toHaveLength(2)
    expect(s.breaks).toHaveLength(1)
    const gap = s.breaks[0]
    expect(gap && gap.x1 - gap.x0).toBeCloseTo(3)
    // Both hours of work share the rest of the width equally.
    expect(s.x(start + HOUR)).toBeCloseTo(48.5)
    expect(s.x(start + 3 * DAY)).toBeCloseTo(51.5)
    expect(s.multiDay).toBe(true)
  })

  it('maps times monotonically into 0–100, continuous across breaks', () => {
    const s = buildScale(
      [
        { from: start, to: start + 20 * MIN },
        { from: start + 25 * MIN, to: start + 40 * MIN },
        { from: start + 5 * HOUR, to: start + 6 * HOUR },
      ],
      { label },
    )
    expect(s.stretches).toHaveLength(2)
    let prev = -1
    for (let t = start - HOUR; t <= start + 7 * HOUR; t += 7 * MIN) {
      const x = s.x(t)
      expect(x).toBeGreaterThanOrEqual(prev)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      prev = x
    }
    expect(s.x(start - DAY)).toBe(0)
    expect(s.x(start + DAY)).toBe(100)
  })

  it('handles no times and a single instant', () => {
    expect(buildScale([]).empty).toBe(true)
    expect(buildScale([{ from: Number.NaN, to: 1 }]).empty).toBe(true)
    const s = buildScale([{ from: start, to: start }], { label })
    expect(s.empty).toBe(false)
    expect(s.x(start)).toBeCloseTo(50)
    expect(s.ticks.length).toBeGreaterThan(0)
  })

  it('puts sorted ticks inside the stretches', () => {
    const s = buildScale(
      [
        { from: start, to: start + 2 * HOUR },
        { from: start + DAY, to: start + DAY + 30 * MIN },
      ],
      { label },
    )
    const ats = s.ticks.map(t => t.at)
    expect(ats).toEqual([...ats].sort((a, b) => a - b))
    for (const t of s.ticks) expect(s.stretches.some(b => t.at >= b.from && t.at <= b.to)).toBe(true)
    // The first tick of each day carries its date.
    expect(s.ticks[0]?.label.startsWith('D')).toBe(true)
  })
})
