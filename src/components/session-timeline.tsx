// The session map's timeline: the main session, every subagent and (folded
// away by default) every file on one time axis. Each row is a button that
// selects it; positions are percentages from a scale that collapses long idle
// gaps into hatched breaks.
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { client, Res } from '@/lib/api'
import { clock, date, duration } from '@/lib/format'
import type { Scale } from '@/lib/timeline-scale'
import { cn } from '@/lib/utils'

export type MapData = Res<(typeof client.api.sessions)[':id']['map']['$get']>
export type MapAgent = MapData['agents'][number]
export type MapFile = MapData['files'][number]

export type Selection = { agent: string } | { file: string } | null

/** What a selection keeps lit; everything else is dimmed. */
export interface Focus {
  /** Agent rows that stay lit. */
  agents: Set<string>
  /** Whose file dots stay lit ('main' or agent ids); null = every dot in a lit file. */
  whos: Set<string> | null
  files: Set<string>
  main: boolean
}

// Literal class names, so Tailwind sees them.
const TYPE_CLASS = {
  main: { bg: 'bg-foreground', border: 'border-foreground' },
  Explore: { bg: 'bg-chart-3', border: 'border-chart-3' },
  Plan: { bg: 'bg-chart-5', border: 'border-chart-5' },
  'general-purpose': { bg: 'bg-chart-2', border: 'border-chart-2' },
  fork: { bg: 'bg-chart-1', border: 'border-chart-1' },
  other: { bg: 'bg-chart-4', border: 'border-chart-4' },
} as const

export type TypeKey = keyof typeof TYPE_CLASS

export function typeKey(type: string, isFork = false): TypeKey {
  if (isFork) return 'fork'
  return type in TYPE_CLASS ? (type as TypeKey) : 'other'
}

export function typeClass(type: string, isFork = false) {
  return TYPE_CLASS[typeKey(type, isFork)]
}

export const TYPE_LABEL: Record<TypeKey, string> = {
  main: 'main session',
  Explore: 'Explore',
  Plan: 'Plan',
  'general-purpose': 'general-purpose',
  fork: 'fork',
  other: 'other agents',
}

export function TypeTag({ type, isFork = false }: { type: string; isFork?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 border bg-background px-1.5 py-px text-[10px]">
      <span className={cn('size-2 rounded-full', typeClass(type, isFork).bg)} />
      {isFork && type !== 'fork' ? `${type} · fork` : type}
    </span>
  )
}

/** Who did something: 'main' or an agent, by its description. */
export function whoName(data: MapData, who: string): string {
  if (who === 'main') return 'Main session'
  const a = data.agents.find(x => x.id === who)
  return a ? (a.description ?? a.type) : who
}

export function whoClass(data: MapData, who: string) {
  if (who === 'main') return TYPE_CLASS.main
  const a = data.agents.find(x => x.id === who)
  return a ? typeClass(a.type, a.isFork) : TYPE_CLASS.other
}

const ROW = 'grid w-full grid-cols-[14rem_minmax(0,1fr)_3.5rem] items-center text-left text-xs'
const FILE_LIMIT = 50

export function SessionTimeline({
  data,
  scale,
  focus,
  selection,
  onSelect,
}: {
  data: MapData
  scale: Scale
  focus: Focus | null
  selection: Selection
  onSelect: (s: Selection) => void
}) {
  // Files start folded away, unless the page opened on a selected file.
  const [filesOpen, setFilesOpen] = useState(() => selection !== null && 'file' in selection)
  const [allFiles, setAllFiles] = useState(
    () => selection !== null && 'file' in selection && data.files.findIndex(f => f.id === selection.file) >= FILE_LIMIT,
  )
  const filesId = useId()
  const { main } = data
  const x = scale.x
  /** left / width for a bar from `from` to `to`, at least `min` % wide. */
  const bar = (from: number, to: number, min: number) => {
    const width = Math.max(min, x(to) - x(from))
    return { left: `${Math.min(x(from), 100 - width)}%`, width: `${width}%` }
  }
  const selectedAgent = selection && 'agent' in selection ? selection.agent : null
  const selectedFile = selection && 'file' in selection ? selection.file : null
  const toggle = (agent: string) => onSelect(agent === selectedAgent ? null : { agent })
  const toggleFile = (file: string) => onSelect(file === selectedFile ? null : { file })

  // Prompt numbers only where there's room; crowded ones are drawn as dots.
  let lastPromptX = Number.NEGATIVE_INFINITY
  const prompts = main.prompts.flatMap(p => {
    if (p.at === null) return []
    const px = x(p.at)
    const labelled = px - lastPromptX >= 3.5
    if (labelled) lastPromptX = px
    return [{ ...p, px, labelled }]
  })
  const files = allFiles ? data.files : data.files.slice(0, FILE_LIMIT)

  return (
    <div className="min-w-0 border">
      <div className="overflow-x-auto">
        <div className="relative min-w-[640px]">
          {/* Tick lines and collapsed gaps, behind the rows. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-14 left-56">
            {scale.ticks.map(t => (
              <span key={t.at} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${t.x}%` }} />
            ))}
            {scale.breaks.map(b => (
              <span
                key={b.from}
                className="absolute inset-y-0 border-x bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_5px)]"
                style={{ left: `${b.x0}%`, width: `${b.x1 - b.x0}%` }}
              />
            ))}
          </div>

          <div className={cn(ROW, 'relative h-7 border-b bg-muted/40')}>
            <span className="truncate px-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              {scale.multiDay ? 'Time' : date(main.firstAt)}
            </span>
            <span className="relative block h-7">
              {scale.ticks.map(t => (
                <span
                  key={t.at}
                  className="absolute bottom-1.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                  style={{
                    left: `${t.x}%`,
                    transform:
                      t.align === 'end' ? 'translateX(-100%)' : t.align === 'start' ? 'none' : 'translateX(-50%)',
                  }}
                >
                  {t.label}
                </span>
              ))}
              {scale.breaks.map(b => (
                <span
                  key={b.from}
                  title={`${duration(b.to - b.from)} with nothing happening`}
                  className="absolute inset-y-0"
                  style={{ left: `${b.x0}%`, width: `${b.x1 - b.x0}%` }}
                />
              ))}
            </span>
            <span />
          </div>

          <button
            type="button"
            aria-pressed={selectedAgent === 'main'}
            onClick={() => toggle('main')}
            className={cn(
              ROW,
              'relative min-h-12 hover:bg-muted/40',
              selectedAgent === 'main' && 'bg-muted/60',
              focus && !focus.main && 'opacity-40',
            )}
          >
            <span className="flex min-w-0 items-center gap-2 px-3">
              <TypeTag type="main" />
              <span className="truncate font-medium">Main session</span>
            </span>
            <span className="relative block h-12">
              {main.firstAt !== null && main.lastAt !== null ? (
                <span className="absolute top-[22px] h-px bg-foreground/30" style={bar(main.firstAt, main.lastAt, 0)} />
              ) : null}
              {main.segments.map(s => (
                <span key={s.from} className="absolute top-5 h-1 bg-foreground" style={bar(s.from, s.to, 0.3)} />
              ))}
              {data.launches.map(l => {
                if (l.by !== 'main' || l.at === null) return null
                const launched = l.agentId ? data.agents.find(a => a.id === l.agentId) : undefined
                const lit = !focus || (l.agentId !== null && focus.agents.has(l.agentId))
                return (
                  <span
                    key={l.id}
                    title={`${clock(l.at)} · launched ${launched?.description ?? l.type ?? 'an agent'}`}
                    className={cn(
                      'absolute top-8 h-3 w-0.5 -translate-x-1/2',
                      launched ? typeClass(launched.type, launched.isFork).bg : 'bg-muted-foreground',
                      !lit && 'opacity-25',
                    )}
                    style={{ left: `${x(l.at)}%` }}
                  />
                )
              })}
              {/* Crowded prompts first, as plain dots, so numbered ones sit on top. */}
              {[...prompts.filter(p => !p.labelled), ...prompts.filter(p => p.labelled)].map(p => (
                <span
                  key={p.n}
                  title={`Prompt ${p.n} · ${clock(p.at)}\n${p.text}`}
                  className={cn(
                    'absolute flex -translate-x-1/2 items-center justify-center rounded-full bg-foreground font-semibold text-[9px] text-background',
                    p.labelled ? 'top-[14px] size-4 ring-2 ring-background' : 'top-[18px] size-2',
                  )}
                  style={{ left: `${p.px}%` }}
                >
                  {p.labelled ? p.n : null}
                </span>
              ))}
            </span>
            <span className="pr-3 text-right text-[11px] text-muted-foreground">
              {main.firstAt !== null && main.lastAt !== null ? duration(main.lastAt - main.firstAt) : '—'}
            </span>
          </button>

          <SectionRow>
            Subagents · {data.agents.length}
            {data.summary.unmatchedLaunches ? (
              <span className="font-normal normal-case tracking-normal">
                {' '}
                ({data.summary.unmatchedLaunches} more launched, with no transcript on disk)
              </span>
            ) : null}
          </SectionRow>
          {data.agents.length === 0 ? (
            <p className="relative px-3 py-2 text-[11px] text-muted-foreground">This session ran no subagents.</p>
          ) : null}
          {data.agents.map(a => {
            const selected = selectedAgent === a.id
            const lit = !focus || focus.agents.has(a.id)
            const c = typeClass(a.type, a.isFork)
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(a.id)}
                className={cn(ROW, 'relative min-h-10 border-t hover:bg-muted/40', selected && 'bg-muted/60')}
              >
                <span
                  className={cn('flex min-w-0 items-center gap-2 pr-3', !lit && 'opacity-35')}
                  style={{ paddingLeft: `${0.75 + (a.depth - 1) * 1.25}rem` }}
                >
                  {a.depth > 1 ? (
                    <span aria-hidden="true" className="text-muted-foreground">
                      └
                    </span>
                  ) : null}
                  <TypeTag type={a.type} isFork={a.isFork} />
                  <span className="truncate">{a.description ?? a.id}</span>
                </span>
                <span className="relative block h-10">
                  {a.firstAt !== null && a.lastAt !== null ? (
                    <span
                      title={`${clock(a.firstAt)} – ${clock(a.lastAt)}${a.status === 'running' ? ' · still running' : ''}`}
                      className={cn(
                        'absolute top-3 h-4 overflow-hidden',
                        c.bg,
                        selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                        !lit && 'opacity-25',
                      )}
                      style={bar(a.firstAt, a.lastAt, 0.5)}
                    >
                      {a.status === 'running' ? (
                        <span className="absolute inset-y-0 right-0 w-3 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-background)_3px_5px)]" />
                      ) : null}
                    </span>
                  ) : (
                    <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-muted-foreground">
                      no timestamps
                    </span>
                  )}
                </span>
                <span className={cn('pr-3 text-right text-[11px] text-muted-foreground', !lit && 'opacity-35')}>
                  {a.firstAt !== null && a.lastAt !== null ? duration(a.lastAt - a.firstAt) : '—'}
                </span>
              </button>
            )
          })}

          <button
            type="button"
            aria-expanded={filesOpen}
            aria-controls={filesId}
            onClick={() => setFilesOpen(!filesOpen)}
            className="relative flex w-full items-center gap-1.5 border-t bg-muted/40 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/70"
          >
            <ChevronRight className={cn('size-3 transition-transform', filesOpen && 'rotate-90')} />
            Files · {data.files.length}
            {filesOpen ? null : (
              <span className="font-normal normal-case tracking-normal">
                {' '}
                (read or changed with Claude Code’s file tools; click to show)
              </span>
            )}
          </button>
          {filesOpen ? (
            <div id={filesId}>
              {data.files.length === 0 ? (
                <p className="relative px-3 py-2 text-[11px] text-muted-foreground">No file was read or changed.</p>
              ) : null}
              {files.map(f => {
                const selected = selectedFile === f.id
                const lit = !focus || focus.files.has(f.id)
                const lastVersion = f.versions.at(-1)?.version
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleFile(f.id)}
                    className={cn(ROW, 'relative min-h-9 border-t hover:bg-muted/40', selected && 'bg-muted/60')}
                  >
                    <span
                      className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden px-3', !lit && 'opacity-35')}
                      title={f.id}
                    >
                      <span className="flex min-w-0">
                        <span className="min-w-0 shrink-[999] truncate text-muted-foreground">{f.dir}</span>
                        <span className="max-w-full shrink-0 truncate">{f.name}</span>
                      </span>
                      {f.created ? (
                        <span className="shrink-0 bg-emerald-500/10 px-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                          new
                        </span>
                      ) : null}
                    </span>
                    {/* A dimmed row fades as a whole, so overlapping dots don't stack their opacity. */}
                    <span className={cn('relative block h-9', !lit && 'opacity-15')}>
                      {f.events.map((e, i) => {
                        if (e.at === null) return null
                        const on = !lit || !focus?.whos || focus.whos.has(e.who)
                        const c = whoClass(data, e.who)
                        return (
                          <span
                            key={i}
                            title={`${clock(e.at)} · ${e.failed ? 'failed ' : ''}${e.tool} by ${whoName(data, e.who)}`}
                            className={cn(
                              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                              c.border,
                              e.kind === 'read' ? 'bg-background' : c.bg,
                              focus && lit && on ? 'size-3' : 'size-2.5',
                              e.failed && 'opacity-40',
                              !on && 'opacity-15',
                            )}
                            style={{ left: `${x(e.at)}%` }}
                          />
                        )
                      })}
                    </span>
                    <span className={cn('pr-3 text-right text-[11px] text-muted-foreground', !lit && 'opacity-35')}>
                      {lastVersion ? `v${lastVersion}` : f.edits ? 'edited' : 'read'}
                    </span>
                  </button>
                )
              })}
              {data.files.length > FILE_LIMIT ? (
                <div className="relative border-t px-3 py-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setAllFiles(!allFiles)}>
                    {allFiles ? `Show the first ${FILE_LIMIT}` : `Show all ${data.files.length} files`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SectionRow({ children }: { children: ReactNode }) {
  return (
    <div className="relative border-t bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}
