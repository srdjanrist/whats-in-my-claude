// A radial map of one project's setup against its usage. The project sits in
// the center, the places its setup comes from (~/.claude, the project's
// .claude, claude.ai, each plugin…) on the inner ring, and every MCP server,
// skill, agent, command and hook on the outer ring. A line's width shows how
// often this project's sessions called the item; dashed lines were never used.
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type KeyboardEvent, type ReactElement, type ReactNode, useMemo, useState } from 'react'
import { Dot, Empty, KeyValues, QueryView, Section, Tag } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type client, q, type Res } from '@/lib/api'
import { ago, date, shortCount } from '@/lib/format'
import { cn } from '@/lib/utils'

type MapData = Res<(typeof client.api.projects)[':id']['graph']['$get']>
type Origin = MapData['origins'][number]
type Item = MapData['items'][number]
type Kind = Item['kind']

const KINDS: Kind[] = ['mcp', 'skill', 'agent', 'command', 'hook']
const KIND_LABEL: Record<Kind, [one: string, many: string]> = {
  mcp: ['MCP', 'MCP'],
  skill: ['skill', 'skills'],
  agent: ['agent', 'agents'],
  command: ['command', 'commands'],
  hook: ['hook', 'hooks'],
}
const KIND_CLASS: Record<Kind, { fill: string; stroke: string; bg: string }> = {
  mcp: { fill: 'fill-chart-3', stroke: 'stroke-chart-3', bg: 'bg-chart-3' },
  skill: { fill: 'fill-chart-2', stroke: 'stroke-chart-2', bg: 'bg-chart-2' },
  agent: { fill: 'fill-chart-5', stroke: 'stroke-chart-5', bg: 'bg-chart-5' },
  command: { fill: 'fill-chart-4', stroke: 'stroke-chart-4', bg: 'bg-chart-4' },
  hook: { fill: 'fill-chart-1', stroke: 'stroke-chart-1', bg: 'bg-chart-1' },
}
/** Plugins with more items than this start folded into one node. */
const FOLD_OVER = 8
const R_CENTER = 44
const R_HUB = 150
const R_LEAF = 320
const GAP_SLOTS = 1.5
const LABEL_MAX = 22

const cut = (s: string, max = LABEL_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const kindCount = (n: number, kind: Kind) => `${n} ${KIND_LABEL[kind][n === 1 ? 0 : 1]}`
const isUnplaced = (o: Origin | undefined) => o?.kind === 'builtin' || o?.kind === 'missing'

interface Leaf {
  key: string
  originId: string
  /** null for a folded plugin. */
  item: Item | null
  kind: Kind | 'fold'
  label: string
  uses: number | null
  enabled: boolean | null
  angle: number
}

interface Hub {
  origin: Origin
  angle: number
  uses: number
  foldable: boolean
  folded: boolean
}

type Selection = { type: 'item'; key: string } | { type: 'origin'; id: string } | null

function usesOf(items: Item[]): number | null {
  return items.every(i => i.uses === null) ? null : items.reduce((n, i) => n + (i.uses ?? 0), 0)
}

function foldLabel(items: Item[]): string {
  return KINDS.flatMap(k => {
    const n = items.filter(i => i.kind === k).length
    return n ? [kindCount(n, k)] : []
  }).join(' · ')
}

function layout(data: MapData, kinds: Set<Kind>, hideUnused: boolean, unfolded: Set<string>) {
  const visible = data.items.filter(i => kinds.has(i.kind) && !(hideUnused && i.uses === 0))
  const groups = data.origins
    .map(origin => {
      const items = visible
        .filter(i => i.origin === origin.id)
        .sort(
          (a, b) =>
            KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
            (b.uses ?? -1) - (a.uses ?? -1) ||
            a.label.localeCompare(b.label),
        )
      const foldable = origin.kind === 'plugin' && items.length > FOLD_OVER
      return { origin, items, foldable, folded: foldable && !unfolded.has(origin.id) }
    })
    .filter(g => g.items.length > 0)

  const slots = groups.reduce((n, g) => n + (g.folded ? 1 : g.items.length), 0) + GAP_SLOTS * groups.length
  const step = (2 * Math.PI) / Math.max(slots, 1)
  const leaves: Leaf[] = []
  const hubs: Hub[] = []
  let cursor = -Math.PI / 2 + (GAP_SLOTS * step) / 2
  for (const g of groups) {
    const first = leaves.length
    const place = (leaf: Omit<Leaf, 'angle'>) => {
      leaves.push({ ...leaf, angle: cursor + step / 2 })
      cursor += step
    }
    if (g.folded)
      place({
        key: `fold:${g.origin.id}`,
        originId: g.origin.id,
        item: null,
        kind: 'fold',
        label: `${g.items.length} items`,
        uses: usesOf(g.items),
        enabled: g.origin.enabled,
      })
    else
      for (const item of g.items)
        place({
          key: item.id,
          originId: g.origin.id,
          item,
          kind: item.kind,
          label: item.label,
          uses: item.uses,
          enabled: item.enabled,
        })
    const mine = leaves.slice(first)
    hubs.push({
      origin: g.origin,
      angle: ((mine[0]?.angle ?? cursor) + (mine[mine.length - 1]?.angle ?? cursor)) / 2,
      uses: g.items.reduce((n, i) => n + (i.uses ?? 0), 0),
      foldable: g.foldable,
      folded: g.folded,
    })
    cursor += GAP_SLOTS * step
  }
  const max = Math.max(1, ...leaves.map(l => l.uses ?? 0), ...hubs.map(h => h.uses))
  return { leaves, hubs, max }
}

const xy = (angle: number, r: number) => [r * Math.cos(angle), r * Math.sin(angle)] as const
const pt = (angle: number, r: number) =>
  xy(angle, r)
    .map(v => v.toFixed(1))
    .join(' ')

/** A curve between two polar points, bending along the radius (like d3.linkRadial). */
function radialLink(a0: number, r0: number, a1: number, r1: number): string {
  const rm = (r0 + r1) / 2
  return `M${pt(a0, r0)} C${pt(a0, rm)} ${pt(a1, rm)} ${pt(a1, r1)}`
}

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

export function ProjectMap({ id }: { id: string }) {
  const query = useQuery(q.projectGraph(id))
  return <QueryView query={query}>{data => <MapBody data={data} />}</QueryView>
}

function MapBody({ data }: { data: MapData }) {
  const [kinds, setKinds] = useState<Kind[]>(['mcp', 'skill', 'agent', 'command'])
  const [hideUnused, setHideUnused] = useState(false)
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set())
  const [hover, setHover] = useState<Selection>(null)
  const [selected, setSelected] = useState<Selection>(null)

  const { leaves, hubs, max } = useMemo(
    () => layout(data, new Set(kinds), hideUnused, unfolded),
    [data, kinds, hideUnused, unfolded],
  )
  const origins = useMemo(() => new Map(data.origins.map(o => [o.id, o])), [data.origins])

  if (data.items.length === 0)
    return (
      <Empty>
        {data.origins.length === 0 && data.project.displayPath === data.project.id
          ? 'This project’s folder is unknown, so its setup can’t be mapped.'
          : 'Nothing in the setup applies to this project.'}
      </Empty>
    )

  const width = (uses: number | null) => (uses ? 1 + (5 * Math.log1p(uses)) / Math.log1p(max) : 1)
  const radius = (uses: number | null) => (uses ? 3.5 + (3.5 * Math.log1p(uses)) / Math.log1p(max) : 3.5)

  const toggleFold = (originId: string) =>
    setUnfolded(prev => {
      const next = new Set(prev)
      if (next.has(originId)) next.delete(originId)
      else next.add(originId)
      return next
    })

  // What to highlight: the hovered (else selected) leaf with its hub, or a hub with all its leaves.
  const active = hover ?? selected
  const activeLeaf = active?.type === 'item' ? leaves.find(l => l.key === active.key) : undefined
  const activeOrigin = active?.type === 'origin' ? active.id : activeLeaf?.originId
  const lit = (leaf: Leaf) => !active || (activeLeaf ? leaf.key === activeLeaf.key : leaf.originId === activeOrigin)
  const litHub = (hub: Hub) => !active || hub.origin.id === activeOrigin

  const configured = data.items.filter(i => !isUnplaced(origins.get(i.origin)))
  const measurable = configured.filter(i => i.uses !== null)
  const usedCount = measurable.filter(i => (i.uses ?? 0) > 0).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          multiple
          value={kinds}
          onValueChange={v => setKinds(v as Kind[])}
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label="Kinds to show"
        >
          {KINDS.map(k => (
            <ToggleGroupItem key={k} value={k} className="gap-1.5">
              <span className={cn('size-2 rounded-full', KIND_CLASS[k].bg)} />
              {KIND_LABEL[k][1]} ({data.items.filter(i => i.kind === k).length})
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle variant="outline" size="sm" pressed={hideUnused} onPressedChange={setHideUnused}>
          Hide unused
        </Toggle>
        <span className="text-[11px] text-muted-foreground">
          {usedCount} of {measurable.length} configured items used here
        </span>
      </div>
      <CoverageNote coverage={data.coverage} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 border">
          {leaves.length === 0 ? (
            <div className="p-4">
              <Empty>Nothing to show with these filters.</Empty>
            </div>
          ) : (
            <svg
              viewBox="-500 -500 1000 1000"
              className="mx-auto block aspect-square w-full max-w-[52rem] select-none font-mono"
              onMouseLeave={() => setHover(null)}
            >
              <title>{`Setup of ${data.project.name}: ${data.items.length} items from ${data.origins.length} places`}</title>
              {/* center → hubs */}
              {hubs.map(hub => {
                const [x, y] = xy(hub.angle, R_HUB)
                return (
                  <line
                    key={`e:${hub.origin.id}`}
                    x1={0}
                    y1={0}
                    x2={x}
                    y2={y}
                    strokeWidth={width(hub.uses)}
                    strokeDasharray={hub.uses ? undefined : '4 4'}
                    className={cn(
                      'stroke-foreground/40 transition-opacity',
                      hub.origin.enabled === false && 'opacity-40',
                      !litHub(hub) && 'opacity-15',
                    )}
                  />
                )
              })}
              {/* hubs → leaves */}
              {leaves.map(leaf => {
                const hub = hubs.find(h => h.origin.id === leaf.originId)
                if (!hub) return null
                return (
                  <path
                    key={`e:${leaf.key}`}
                    d={radialLink(hub.angle, R_HUB, leaf.angle, R_LEAF)}
                    fill="none"
                    strokeWidth={width(leaf.uses)}
                    strokeDasharray={leaf.uses === 0 || leaf.enabled === false ? '4 4' : undefined}
                    className={cn(
                      'transition-opacity',
                      leaf.uses && leaf.kind !== 'fold' ? KIND_CLASS[leaf.kind].stroke : 'stroke-muted-foreground/50',
                      leaf.enabled === false && 'opacity-40',
                      !lit(leaf) && 'opacity-10',
                    )}
                  />
                )
              })}
              {/* leaves */}
              {leaves.map(leaf => {
                const deg = (leaf.angle * 180) / Math.PI
                const flip = Math.cos(leaf.angle) < 0
                const select = () => {
                  if (!leaf.item) toggleFold(leaf.originId)
                  setSelected(leaf.item ? { type: 'item', key: leaf.key } : { type: 'origin', id: leaf.originId })
                }
                return (
                  // biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>
                  <g
                    key={leaf.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${leaf.label}: ${leaf.uses === null ? 'usage not recorded' : `${leaf.uses} calls`}`}
                    transform={`rotate(${deg.toFixed(2)})`}
                    className={cn('cursor-pointer outline-none transition-opacity', !lit(leaf) && 'opacity-25')}
                    onMouseEnter={() => setHover({ type: 'item', key: leaf.key })}
                    onFocus={() => setHover({ type: 'item', key: leaf.key })}
                    onBlur={() => setHover(null)}
                    onClick={select}
                    onKeyDown={onActivate(select)}
                  >
                    {leaf.kind === 'fold' ? (
                      <rect
                        x={R_LEAF - 6}
                        y={-6}
                        width={12}
                        height={12}
                        rx={2}
                        className="fill-background stroke-foreground"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <circle
                        cx={R_LEAF}
                        r={radius(leaf.uses)}
                        strokeWidth={1.5}
                        className={cn(
                          KIND_CLASS[leaf.kind].stroke,
                          leaf.uses ? KIND_CLASS[leaf.kind].fill : 'fill-background',
                          leaf.enabled === false && 'opacity-50',
                          selected?.type === 'item' && selected.key === leaf.key && 'stroke-foreground',
                        )}
                      />
                    )}
                    <text
                      x={flip ? -(R_LEAF + 12) : R_LEAF + 12}
                      dy="0.32em"
                      transform={flip ? 'rotate(180)' : undefined}
                      textAnchor={flip ? 'end' : 'start'}
                      className={cn(
                        'text-[12px]',
                        leaf.enabled === false || leaf.uses === 0 ? 'fill-muted-foreground' : 'fill-foreground',
                      )}
                    >
                      {cut(leaf.label)}
                      {leaf.uses ? <tspan className="fill-muted-foreground"> {shortCount(leaf.uses)}</tspan> : null}
                    </text>
                  </g>
                )
              })}
              {/* hubs */}
              {hubs.map(hub => {
                const [x, y] = xy(hub.angle, R_HUB)
                const right = Math.cos(hub.angle) >= 0
                const label = cut(hub.origin.label, 20)
                const select = () => {
                  if (hub.foldable) toggleFold(hub.origin.id)
                  setSelected({ type: 'origin', id: hub.origin.id })
                }
                return (
                  // biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>
                  <g
                    key={hub.origin.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${hub.origin.label}${hub.foldable ? (hub.folded ? ', expand' : ', fold') : ''}`}
                    className={cn('cursor-pointer outline-none transition-opacity', !litHub(hub) && 'opacity-30')}
                    onMouseEnter={() => setHover({ type: 'origin', id: hub.origin.id })}
                    onFocus={() => setHover({ type: 'origin', id: hub.origin.id })}
                    onBlur={() => setHover(null)}
                    onClick={select}
                    onKeyDown={onActivate(select)}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={hub.foldable ? 10 : 7}
                      strokeWidth={1.5}
                      strokeDasharray={hub.origin.enabled === false ? '3 2' : undefined}
                      className={cn(
                        'fill-background',
                        selected?.type === 'origin' && selected.id === hub.origin.id
                          ? 'stroke-primary'
                          : 'stroke-foreground',
                      )}
                    />
                    {hub.foldable ? (
                      <text
                        x={x}
                        y={y}
                        dy="0.35em"
                        textAnchor="middle"
                        className="pointer-events-none fill-foreground text-[14px]"
                      >
                        {hub.folded ? '+' : '−'}
                      </text>
                    ) : null}
                    {/* A plate behind the label so edges don't run through it (monospace: 0.6em per character). */}
                    <rect
                      x={right ? x + 11 : x - 17 - label.length * 7.2}
                      y={y - 9}
                      width={label.length * 7.2 + 6}
                      height={18}
                      rx={2}
                      className="pointer-events-none fill-background/90"
                    />
                    <text
                      x={x + (right ? 14 : -14)}
                      y={y}
                      dy="0.32em"
                      textAnchor={right ? 'start' : 'end'}
                      className="fill-foreground text-[12px] font-medium"
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
              {/* center */}
              <circle r={R_CENTER} className="fill-primary" />
              <text dy="0.32em" textAnchor="middle" className="fill-primary-foreground text-[11px] font-medium">
                {cut(data.project.name, 10)}
              </text>
            </svg>
          )}
        </div>
        <Details
          data={data}
          selection={selected}
          origins={origins}
          hubs={hubs}
          leaves={leaves}
          onToggleFold={toggleFold}
          onClear={() => setSelected(null)}
        />
      </div>

      <Lists data={data} origins={origins} />
    </div>
  )
}

function CoverageNote({ coverage }: { coverage: MapData['coverage'] }) {
  const missing = coverage.transcripts - coverage.indexed - coverage.behind
  const notes: string[] = []
  if (missing > 0)
    notes.push(
      coverage.indexing
        ? `Usage covers ${coverage.transcripts - missing} of ${coverage.transcripts} transcripts so far; counts update as indexing runs.`
        : `${missing} of ${coverage.transcripts} transcripts aren't indexed yet, so they aren't counted.`,
    )
  if (coverage.behind > 0)
    notes.push(
      `${coverage.behind} ${coverage.behind === 1 ? 'transcript has' : 'transcripts have'} grown since indexing (a session may still be running), so recent calls may be missing.`,
    )
  return notes.length ? <p className="text-[11px] text-muted-foreground">{notes.join(' ')}</p> : null
}

function Legend() {
  return (
    <div className="space-y-2 text-[11px] text-muted-foreground">
      <svg viewBox="0 0 40 30" className="h-8 w-10" aria-hidden="true">
        <line x1={0} y1={5} x2={40} y2={5} className="stroke-foreground/60" strokeWidth={4} />
        <line x1={0} y1={15} x2={40} y2={15} className="stroke-foreground/60" strokeWidth={1.5} />
        <line x1={0} y1={25} x2={40} y2={25} className="stroke-foreground/60" strokeWidth={1} strokeDasharray="4 4" />
      </svg>
      <p>
        Thicker lines: more calls from this project's sessions. Dashed: never called here, or switched off. Hollow dots:
        unused. Hooks run on events, so transcripts can't count them.
      </p>
      <p>Square nodes are folded plugins; click a plugin to expand or fold it.</p>
    </div>
  )
}

function Details({
  data,
  selection,
  origins,
  hubs,
  leaves,
  onToggleFold,
  onClear,
}: {
  data: MapData
  selection: Selection
  origins: Map<string, Origin>
  hubs: Hub[]
  leaves: Leaf[]
  onToggleFold: (originId: string) => void
  onClear: () => void
}) {
  let title: ReactNode = 'How to read it'
  let body: ReactNode = <Legend />
  if (selection?.type === 'item') {
    const item = leaves.find(l => l.key === selection.key)?.item
    const origin = item ? origins.get(item.origin) : undefined
    if (item) {
      title = item.label
      body = (
        <div className="space-y-3">
          <KeyValues
            items={[
              ['kind', <Tag key="k">{KIND_LABEL[item.kind][0]}</Tag>],
              ['from', origin?.label ?? '—'],
              ['state', state(item.enabled, isUnplaced(origin))],
              ['calls', item.uses === null ? 'not recorded' : item.uses.toLocaleString()],
              ['sessions', item.uses === null ? '—' : item.sessions],
              [
                'last used',
                item.lastUsedAt ? (
                  <span key="l" title={date(item.lastUsedAt)}>
                    {ago(item.lastUsedAt)}
                  </span>
                ) : (
                  '—'
                ),
              ],
            ]}
          />
          <ItemLink item={item} origin={origin} />
        </div>
      )
    }
  } else if (selection?.type === 'origin') {
    const origin = origins.get(selection.id)
    const hub = hubs.find(h => h.origin.id === selection.id)
    if (origin) {
      const items = data.items.filter(i => i.origin === origin.id)
      const measurable = items.filter(i => i.uses !== null)
      title = origin.label
      body = (
        <div className="space-y-3">
          <KeyValues
            items={[
              ['items', foldLabel(items) || 'none'],
              ['used here', `${measurable.filter(i => (i.uses ?? 0) > 0).length} of ${measurable.length}`],
              ['calls', items.reduce((n, i) => n + (i.uses ?? 0), 0).toLocaleString()],
              ...(origin.kind === 'plugin'
                ? ([
                    ['state', state(origin.enabled, false)],
                    [
                      'always-on context',
                      origin.contextTokens === null ? '—' : `${shortCount(origin.contextTokens)} tokens`,
                    ],
                  ] as [ReactNode, ReactNode][])
                : []),
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {hub?.foldable ? (
              <Button variant="outline" size="sm" onClick={() => onToggleFold(origin.id)}>
                {hub.folded ? 'Expand' : 'Fold'}
              </Button>
            ) : null}
            {origin.pluginId ? (
              <Button variant="outline" size="sm" render={<Link to="/plugins/$id" params={{ id: origin.pluginId }} />}>
                Open plugin
              </Button>
            ) : null}
          </div>
        </div>
      )
    }
  }
  return (
    <Section
      title={title}
      className="h-fit"
      actions={
        selection ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null
      }
    >
      {body}
    </Section>
  )
}

function state(enabled: boolean | null, unplaced: boolean): ReactNode {
  if (unplaced) return 'not in the setup now'
  return (
    <span className="flex items-center gap-1.5">
      <Dot on={enabled} />
      {enabled === null ? 'Claude Code would ask' : enabled ? 'on' : 'off here'}
    </span>
  )
}

function ItemLink({ item, origin }: { item: Item; origin: Origin | undefined }) {
  if (isUnplaced(origin)) return null
  const button = (to: ReactElement, label: string) => (
    <Button variant="outline" size="sm" render={to}>
      {label}
    </Button>
  )
  switch (item.kind) {
    case 'skill':
      return button(<Link to="/skills" search={item.ref ? { open: item.ref } : {}} />, 'Open in Skills')
    case 'agent':
      return button(<Link to="/agents" search={item.ref ? { open: item.ref } : {}} />, 'Open in Agents')
    case 'command':
      return button(
        <Link to="/agents" search={{ tab: 'commands', ...(item.ref ? { open: item.ref } : {}) }} />,
        'Open in Commands',
      )
    case 'mcp':
      return button(<Link to="/mcp" />, 'Open MCP servers')
    case 'hook':
      return button(<Link to="/hooks" />, 'Open hooks')
  }
}

function Lists({ data, origins }: { data: MapData; origins: Map<string, Origin> }) {
  const unused = data.origins
    .filter(o => !isUnplaced(o))
    .map(o => ({ origin: o, items: data.items.filter(i => i.origin === o.id && i.uses === 0) }))
    .filter(g => g.items.length > 0)
  const unplaced = data.items
    .filter(i => isUnplaced(origins.get(i.origin)))
    .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))
  const unusedCount = unused.reduce((n, g) => n + g.items.length, 0)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={`Configured but never used here (${unusedCount})`}
        description="Loaded for this project, but no session here called it. Hooks are left out: they run on events."
      >
        {unused.length === 0 ? (
          <p className="text-xs text-muted-foreground">Everything configured here has been used.</p>
        ) : (
          <div className="space-y-3">
            {unused.map(g => (
              <div key={g.origin.id} className="space-y-1.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium">{g.origin.label}</span>
                  <span className="text-muted-foreground">
                    {g.items.length}
                    {g.origin.contextTokens ? ` · ${shortCount(g.origin.contextTokens)} always-on tokens` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.items.map(i => (
                    <span key={i.id} className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px]">
                      <span className={cn('size-1.5 rounded-full', KIND_CLASS[i.kind].bg)} />
                      {i.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={`Used but not in the setup (${unplaced.length})`}
        description="Called by this project's sessions, but not found in the setup on disk: built into Claude Code, bundled, or since removed."
      >
        {unplaced.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {unplaced.map(i => (
              <li key={i.id} className="flex items-center gap-2">
                <span className={cn('size-2 shrink-0 rounded-full', KIND_CLASS[i.kind].bg)} />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                <span className="text-muted-foreground">{origins.get(i.origin)?.label}</span>
                <span className="w-14 text-right tabular-nums">{shortCount(i.uses ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
