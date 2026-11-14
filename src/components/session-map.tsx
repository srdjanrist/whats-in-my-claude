// The session map page's body: stat cards, the timeline, a details panel for
// whatever is selected, and what the session keeps on disk. The selection is
// owned by the route (it lives in the URL); this only reads and requests it.
import { Link } from '@tanstack/react-router'
import { type ReactNode, useMemo } from 'react'
import { BarList, KeyValues, Mono, Section, StatCard } from '@/components/common'
import {
  type Focus,
  type MapAgent,
  type MapData,
  type MapFile,
  type Selection,
  SessionTimeline,
  TYPE_LABEL,
  type TypeKey,
  TypeTag,
  typeClass,
  typeKey,
  whoClass,
  whoName,
} from '@/components/session-timeline'
import { Button } from '@/components/ui/button'
import { bytes, clock, dateTime, duration, modelLabel, plural, shortCount, totalTokens } from '@/lib/format'
import { buildScale, type Span } from '@/lib/timeline-scale'
import { cn } from '@/lib/utils'

/** What a selection lights up, or null when nothing (known) is selected. */
function focusOf(data: MapData, selection: Selection): Focus | null {
  if (!selection) return null
  if ('file' in selection) {
    // A file lights up whoever read or changed it.
    const f = data.files.find(x => x.id === selection.file)
    if (!f) return null
    const whos = new Set(f.events.map(e => e.who))
    return { agents: new Set([...whos].filter(w => w !== 'main')), main: whos.has('main') }
  }
  if (selection.agent === 'main') return { agents: new Set(), main: true }
  const byId = new Map(data.agents.map(a => [a.id, a]))
  const agent = byId.get(selection.agent)
  if (!agent) return null
  // The agent, everything it launched, and its ancestors for context.
  const agents = new Set([agent.id])
  const stack = [...agent.children]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    agents.add(id)
    stack.push(...(byId.get(id)?.children ?? []))
  }
  for (let p = byId.get(agent.parent); p && !agents.has(p.id); p = byId.get(p.parent)) agents.add(p.id)
  return { agents, main: true }
}

/** Valid selection only: unknown ids count as nothing selected. */
function resolve(data: MapData, selection: Selection): Selection {
  if (!selection) return null
  if ('file' in selection) return data.files.some(f => f.id === selection.file) ? selection : null
  return selection.agent === 'main' || data.agents.some(a => a.id === selection.agent) ? selection : null
}

export function SessionMap({
  data,
  selection: requested,
  onSelect,
}: {
  data: MapData
  selection: Selection
  onSelect: (s: Selection) => void
}) {
  const selection = resolve(data, requested)
  const focus = useMemo(() => focusOf(data, selection), [data, selection])
  const scale = useMemo(() => {
    const spans: Span[] = [...data.main.segments, ...data.agents.flatMap(a => a.segments)]
    for (const p of data.main.prompts) if (p.at !== null) spans.push({ from: p.at, to: p.at })
    return buildScale(spans)
  }, [data])
  const s = data.summary

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Prompts" value={s.prompts} />
        <StatCard
          label="Subagents"
          value={s.agents}
          hint={
            [s.nested ? `${s.nested} nested` : '', s.forks ? plural(s.forks, 'fork') : '']
              .filter(Boolean)
              .join(' · ') || null
          }
        />
        <StatCard
          label="Tool calls"
          value={s.toolCalls.toLocaleString()}
          hint={s.agents ? `${s.subagentToolCalls.toLocaleString()} in subagents` : null}
        />
        <StatCard
          label="Tokens"
          value={shortCount(s.tokens)}
          hint={s.agents ? `${shortCount(s.subagentTokens)} in subagents` : null}
        />
        <StatCard
          label="Files"
          value={data.files.length}
          hint={`${s.filesEdited} changed${s.filesCreated ? ` · ${s.filesCreated} new` : ''}`}
        />
        <StatCard label="Stored" value={bytes(s.storedBytes)} hint={`in ${plural(data.stored.length, 'place')}`} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {scale.empty ? (
          <div className="border p-6 text-center text-xs text-muted-foreground">
            No timestamps in this session's transcripts, so there is nothing to draw.
          </div>
        ) : (
          <SessionTimeline data={data} scale={scale} focus={focus} selection={selection} onSelect={onSelect} />
        )}
        <Details data={data} selection={selection} onSelect={onSelect} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Stored data={data} />
        <Linked data={data} />
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- details

function Details({
  data,
  selection,
  onSelect,
}: {
  data: MapData
  selection: Selection
  onSelect: (s: Selection) => void
}) {
  let title: ReactNode = 'How to read it'
  let body: ReactNode = <Legend data={data} />
  if (selection && 'file' in selection) {
    const file = data.files.find(f => f.id === selection.file)
    if (file) {
      title = 'File'
      body = <FileDetails data={data} file={file} onSelect={onSelect} />
    }
  } else if (selection?.agent === 'main') {
    title = 'Main session'
    body = <MainDetails data={data} onSelect={onSelect} />
  } else if (selection) {
    const agent = data.agents.find(a => a.id === selection.agent)
    if (agent) {
      title = 'Subagent'
      body = <AgentDetails data={data} agent={agent} onSelect={onSelect} />
    }
  }
  return (
    <Section
      title={title}
      className="h-fit lg:sticky lg:top-4"
      actions={
        selection ? (
          <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Clear
          </Button>
        ) : null
      }
    >
      {body}
    </Section>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
}

/** A button that selects an agent (or main), drawn as its colored name. */
function WhoButton({ data, who, onSelect }: { data: MapData; who: string; onSelect: (s: Selection) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ agent: who })}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-left hover:underline"
    >
      <span className={cn('size-2 shrink-0 rounded-full', whoClass(data, who).bg)} />
      <span className="truncate">{whoName(data, who)}</span>
    </button>
  )
}

/** The files someone touched, each a button that selects the file. */
function TouchedFiles({
  files,
  who,
  onSelect,
}: {
  files: MapFile[]
  who: Set<string>
  onSelect: (s: Selection) => void
}) {
  const touched = files.flatMap(f => {
    const mine = f.events.filter(e => who.has(e.who))
    if (mine.length === 0) return []
    const reads = mine.filter(e => e.kind === 'read').length
    const changes = mine.length - reads
    return [
      { f, what: [reads ? `read ${reads}×` : '', changes ? `changed ${changes}×` : ''].filter(Boolean).join(' · ') },
    ]
  })
  return (
    <div className="space-y-1.5">
      <Label>Files · {touched.length}</Label>
      {touched.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1">
          {touched.map(({ f, what }) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect({ file: f.id })}
                className="flex w-full items-center justify-between gap-2 border px-2 py-1 text-left text-[11px] hover:bg-muted/50"
                title={f.id}
              >
                <span className="flex min-w-0">
                  <span className="min-w-0 shrink-[999] truncate text-muted-foreground">{f.dir}</span>
                  <span className="max-w-full shrink-0 truncate">{f.name}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{what}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolCalls({ calls }: { calls: Record<string, number> }) {
  const items = Object.entries(calls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  if (items.length === 0) return null
  return (
    <div className="space-y-1.5">
      <Label>Tool calls</Label>
      <BarList
        items={items.map(([tool, n]) => ({ key: tool, label: <span className="font-mono">{tool}</span>, value: n }))}
      />
    </div>
  )
}

function AgentDetails({ data, agent, onSelect }: { data: MapData; agent: MapAgent; onSelect: (s: Selection) => void }) {
  const launch = !agent.parentKnown
    ? 'The call that launched it wasn’t found in the transcripts.'
    : agent.parent === 'main'
      ? `Launched by the main session at ${clock(agent.launchedAt)}${agent.afterPrompt ? `, after prompt ${agent.afterPrompt}` : ''}.`
      : `Launched by another subagent at ${clock(agent.launchedAt)}.`
  const children = data.agents.filter(a => agent.children.includes(a.id))
  const calls = Object.values(agent.toolCalls).reduce((a, b) => a + b, 0)
  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <TypeTag type={agent.type} isFork={agent.isFork} />
        <p className="font-medium leading-snug">{agent.description ?? agent.id}</p>
        <p className="text-[11px] text-muted-foreground">
          {launch}
          {agent.isFork ? ' A fork starts with a copy of its parent’s conversation.' : ''}
        </p>
      </div>
      <KeyValues
        items={[
          ['parent', <WhoButton key="p" data={data} who={agent.parent} onSelect={onSelect} />],
          ['model', agent.model ? modelLabel(agent.model) : '—'],
          ['started', agent.firstAt ? dateTime(agent.firstAt) : '—'],
          ['ran for', agent.firstAt !== null && agent.lastAt !== null ? duration(agent.lastAt - agent.firstAt) : '—'],
          ['tokens', shortCount(totalTokens(agent.tokens))],
          ['tool calls', calls.toLocaleString()],
          ['status', agent.status === 'running' ? 'still running' : agent.status === 'done' ? 'finished' : '—'],
          ['transcript', bytes(agent.bytes)],
          ['id', <Mono key="i">{agent.id}</Mono>],
        ]}
      />
      {children.length ? (
        <div className="space-y-1.5">
          <Label>Launched · {children.length}</Label>
          <ul className="space-y-1">
            {children.map(c => (
              <li key={c.id}>
                <WhoButton data={data} who={c.id} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ToolCalls calls={agent.toolCalls} />
      <TouchedFiles files={data.files} who={new Set([agent.id])} onSelect={onSelect} />
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/sessions/$id" params={{ id: data.session.id }} search={{ agent: agent.id }} />}
      >
        Read its transcript
      </Button>
    </div>
  )
}

function MainDetails({ data, onSelect }: { data: MapData; onSelect: (s: Selection) => void }) {
  const { main } = data
  return (
    <div className="space-y-4 text-xs">
      <KeyValues
        items={[
          ['model', main.model ? modelLabel(main.model) : '—'],
          ['span', main.firstAt !== null && main.lastAt !== null ? duration(main.lastAt - main.firstAt) : '—'],
          ['tokens', shortCount(totalTokens(main.tokens))],
          [
            'tool calls',
            Object.values(main.toolCalls)
              .reduce((a, b) => a + b, 0)
              .toLocaleString(),
          ],
          ['subagents', data.agents.filter(a => a.parent === 'main').length],
        ]}
      />
      <div className="space-y-1.5">
        <Label>Prompts · {main.prompts.length}</Label>
        <ol className="space-y-1.5">
          {main.prompts.map(p => (
            <li key={p.n} className="grid grid-cols-[1.25rem_4.25rem_minmax(0,1fr)] gap-1 text-[11px]">
              <span className="font-semibold tabular-nums">{p.n}</span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">{clock(p.at)}</span>
              <span className="line-clamp-2">{p.text || '—'}</span>
            </li>
          ))}
        </ol>
      </div>
      <ToolCalls calls={main.toolCalls} />
      <TouchedFiles files={data.files} who={new Set(['main'])} onSelect={onSelect} />
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/sessions/$id" params={{ id: data.session.id }} />}
      >
        Read the conversation
      </Button>
    </div>
  )
}

function FileDetails({ data, file, onSelect }: { data: MapData; file: MapFile; onSelect: (s: Selection) => void }) {
  const whos = new Set(file.events.map(e => e.who))
  const summary = [
    file.reads ? `Read ${file.reads}×` : '',
    file.edits ? `changed ${file.edits}×` : '',
    `by ${plural(whos.size, 'agent')}${whos.has('main') ? ' (main included)' : ''}`,
  ]
    .filter(Boolean)
    .join(', ')
  type Row = { at: number | null; key: string; who: string | null; what: string }
  const rows: Row[] = [
    ...file.events.map((e, i) => ({
      at: e.at,
      key: `e${i}`,
      who: e.who,
      what: `${e.failed ? 'failed ' : ''}${e.tool}`,
    })),
    ...file.versions.map(v => ({
      at: v.at,
      key: `v${v.version}`,
      who: null,
      what: v.exists ? `backup v${v.version}` : 'didn’t exist yet',
    })),
  ].sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY))
  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <p className="break-all font-medium leading-snug">
          <span className="font-normal text-muted-foreground">{file.dir}</span>
          {file.name}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {summary}.{file.created ? ' Created in this session.' : ''}
          {file.inCwd ? '' : ' Outside the session’s folder.'}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>History</Label>
        <ul className="divide-y">
          {rows.map(r => (
            <li key={r.key} className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-2 py-1 text-[11px]">
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">{clock(r.at)}</span>
              {r.who ? (
                <WhoButton data={data} who={r.who} onSelect={onSelect} />
              ) : (
                <span className="text-muted-foreground">file history</span>
              )}
              <span className="text-muted-foreground">{r.what}</span>
            </li>
          ))}
        </ul>
      </div>
      {file.versions.length ? (
        <p className="text-[11px] text-muted-foreground">
          Claude Code backs a file up once per turn, before the first change, so backups don’t line up one-to-one with
          edits. Backups are counted, never opened.
        </p>
      ) : null}
    </div>
  )
}

function Legend({ data }: { data: MapData }) {
  const keys = new Set<TypeKey>(['main', ...data.agents.map(a => typeKey(a.type, a.isFork))])
  return (
    <div className="space-y-3 text-[11px] text-muted-foreground">
      <p>
        Click a row to see what it did and the files it read or changed. The selection is kept in the URL, so back,
        forward and reload keep it.
      </p>
      <ul className="space-y-1">
        {[...keys].map(k => (
          <li key={k} className="flex items-center gap-2">
            <span className={cn('size-2.5', typeClass(k).bg)} />
            {TYPE_LABEL[k]}
          </li>
        ))}
      </ul>
      <ul className="space-y-1">
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-semibold text-background">
            1
          </span>
          a prompt you typed
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-0.5 bg-chart-3" />
          main launched a subagent
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-4 border-x bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_5px)]" />
          idle time, collapsed
        </li>
      </ul>
    </div>
  )
}

// ------------------------------------------------------------ disk & links

const STORED_COLORS = ['bg-foreground', 'bg-chart-3', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5', 'bg-chart-1']

function Stored({ data }: { data: MapData }) {
  const total = Math.max(1, data.summary.storedBytes)
  const color = (i: number) => STORED_COLORS[i % STORED_COLORS.length]
  return (
    <Section
      title={`Stored on disk · ${bytes(data.summary.storedBytes)}`}
      description="Everything under ~/.claude that belongs to this session. Sizes come from file metadata; nothing here is opened."
    >
      <div className="space-y-3">
        <div className="flex h-2.5 overflow-hidden bg-muted">
          {data.stored.map((item, i) => (
            <span
              key={item.key}
              title={`${item.label} · ${bytes(item.bytes)}`}
              className={cn('h-full border-r-2 border-background', color(i))}
              style={{ width: `${(item.bytes / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="overflow-x-auto">
          <ul className="min-w-[520px] divide-y text-xs">
            {data.stored.map((item, i) => (
              <li
                key={item.key}
                className="grid grid-cols-[10rem_minmax(0,1fr)_5.5rem_4.5rem] items-center gap-3 py-1.5"
              >
                <span className="flex items-center gap-2">
                  <span className={cn('size-2 shrink-0', color(i))} />
                  {item.label}
                </span>
                <span className="min-w-0" title={item.note ?? undefined}>
                  <Mono className="block truncate">{item.path}</Mono>
                </span>
                <span className="text-[11px] text-muted-foreground">{plural(item.files, 'file')}</span>
                <span className="text-right tabular-nums">{bytes(item.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

function Linked({ data }: { data: MapData }) {
  const { linked } = data
  const sessionLink = (id: string, title: string | null) => (
    <Link to="/sessions/$id/map" params={{ id }} className="block underline">
      {title ?? id}
    </Link>
  )
  return (
    <Section title="Linked" className="h-fit">
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <Label>Continued from</Label>
          {linked.continuedFrom.length ? (
            linked.continuedFrom.map(s => <div key={s.id}>{sessionLink(s.id, s.title)}</div>)
          ) : (
            <p className="text-muted-foreground">
              {linked.continuedFromPartial ? 'None found yet (still indexing).' : 'Started fresh.'}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label>Continued in</Label>
          {linked.continuedIn ? (
            linked.continuedIn.exists ? (
              sessionLink(linked.continuedIn.id, linked.continuedIn.title)
            ) : (
              <Mono>{linked.continuedIn.id} (transcript deleted)</Mono>
            )
          ) : (
            <p className="text-muted-foreground">Not continued.</p>
          )}
        </div>
        <div className="space-y-1">
          <Label>Plans</Label>
          {linked.plans.length ? (
            linked.plans.map(p => (
              <Link key={p.slug} to="/plans" search={{ open: p.slug }} className="block underline">
                {p.title}
                {p.agentId ? <span className="text-muted-foreground"> (by a subagent)</span> : null}
              </Link>
            ))
          ) : (
            <p className="text-muted-foreground">None.</p>
          )}
        </div>
      </div>
    </Section>
  )
}
