// A year of daily counts as a GitHub-style grid (weeks × weekdays).
import { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const LEVELS = ['bg-muted', 'bg-chart-1/25', 'bg-chart-1/50', 'bg-chart-1/75', 'bg-chart-1']

export function Heatmap({ days, unit = 'prompts' }: { days: { day: string; count: number }[]; unit?: string }) {
  const { weeks, max, total, months } = useMemo(() => {
    const counts = new Map(days.map(d => [d.day, d.count]))
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - 52 * 7 - end.getDay())
    const weeks: { day: string; count: number; future: boolean }[][] = []
    const months: { col: number; label: string }[] = []
    let cursor = new Date(start)
    let lastMonth = -1
    while (cursor <= end) {
      const week: { day: string; count: number; future: boolean }[] = []
      for (let i = 0; i < 7; i++) {
        const k = key(cursor)
        week.push({ day: k, count: counts.get(k) ?? 0, future: cursor > end })
        if (i === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth()
          months.push({ col: weeks.length, label: cursor.toLocaleDateString(undefined, { month: 'short' }) })
        }
        cursor = new Date(cursor)
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(week)
    }
    const values = days.map(d => d.count)
    return { weeks, max: Math.max(1, ...values), total: values.reduce((a, b) => a + b, 0), months }
  }, [days])

  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((Math.sqrt(n) / Math.sqrt(max)) * 4)))

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks.length}, 11px)` }}>
          {weeks.map((_, col) => {
            const m = months.find(x => x.col === col)
            return (
              <div key={`m${col}`} className="h-3 text-[9px] leading-3 whitespace-nowrap text-muted-foreground">
                {m?.label ?? ''}
              </div>
            )
          })}
          {Array.from({ length: 7 }, (_, row) =>
            weeks.map((week, col) => {
              const cell = week[row]
              if (!cell || cell.future) return <div key={`${row}-${col}`} className="size-[11px]" />
              return (
                <Tooltip key={cell.day}>
                  <TooltipTrigger
                    render={
                      <div role="img" className={`size-[11px] ${LEVELS[level(cell.count)]}`} aria-label={cell.day} />
                    }
                  />
                  <TooltipContent>
                    {cell.count.toLocaleString()} {unit} · {new Date(cell.day).toDateString()}
                  </TooltipContent>
                </Tooltip>
              )
            }),
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {total.toLocaleString()} {unit} in the last year
        </span>
        <span className="flex items-center gap-1">
          less
          {LEVELS.map(l => (
            <span key={l} className={`size-[10px] ${l}`} />
          ))}
          more
        </span>
      </div>
    </div>
  )
}
