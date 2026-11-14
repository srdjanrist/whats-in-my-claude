import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  BarList,
  Dot,
  Empty,
  KeyValues,
  Mono,
  PageHeader,
  QueryView,
  Section,
  StatCard,
  Tag,
} from '@/components/common'
import { columnHelper, DataTable } from '@/components/data-table'
import { DetailSheet } from '@/components/detail-sheet'
import { JsonView } from '@/components/markdown'
import { ProjectMap } from '@/components/project-map'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InstructionViewer, MemoryViewer } from '@/components/viewers'
import { type client, q, type Res } from '@/lib/api'
import { ago, bytes, date, modelLabel, shortCount, totalTokens, usd } from '@/lib/format'

export const Route = createFileRoute('/projects/$id')({ component: ProjectPage })

type ProjectData = Res<(typeof client.api.projects)[':id']['$get']>
type SessionRow = ProjectData['sessions'][number]

const h = columnHelper<SessionRow>()
const sessionColumns = [
  h.accessor(r => r.title ?? r.id, {
    id: 'title',
    header: 'Session',
    cell: ({ row: { original: s } }) => (
      <div className="max-w-xl min-w-0">
        <Link to="/sessions/$id" params={{ id: s.id }} className="block truncate font-medium hover:underline">
          {s.title ?? s.id}
        </Link>
        {s.prompt && s.prompt !== s.title ? (
          <div className="truncate text-[11px] text-muted-foreground">{s.prompt}</div>
        ) : null}
      </div>
    ),
  }),
  h.accessor('lastAt', {
    header: 'Last active',
    cell: i => <span className="whitespace-nowrap">{ago(i.getValue())}</span>,
  }),
  h.accessor(r => r.prompts ?? 0, { id: 'prompts', header: 'Prompts', cell: i => i.getValue() || '—' }),
  h.accessor(r => totalTokens(r.tokens), {
    id: 'tokens',
    header: 'Tokens',
    cell: i => (i.getValue() ? shortCount(i.getValue()) : '—'),
  }),
  h.accessor('subagents', { header: 'Subagents', cell: i => i.getValue() || '—' }),
  h.accessor('size', { header: 'Size', cell: i => bytes(i.getValue()) }),
]

function ProjectPage() {
  const { id } = Route.useParams()
  const query = useQuery(q.project(id))
  return <QueryView query={query}>{data => <ProjectBody data={data} />}</QueryView>
}

function ProjectBody({ data }: { data: ProjectData }) {
  const p = data.project
  const [memory, setMemory] = useState<string | null>(null)
  const [instruction, setInstruction] = useState<string | null>(null)
  const cfg = data.config
  const configCount =
    cfg.mcp.length + cfg.agents.length + cfg.commands.length + cfg.skills.length + cfg.hooks.length + cfg.plugins.length
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Dot on={p.exists} title={p.exists ? 'exists on disk' : 'folder no longer exists'} />
            {p.name}
          </span>
        }
        description={<Mono>{data.displayPath}</Mono>}
        actions={p.sources.map(s => (
          <Tag key={s} tone="user">
            {s}
          </Tag>
        ))}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Sessions" value={p.sessionCount} hint={`+ ${p.subagentCount} subagents`} />
        <StatCard label="Prompts" value={p.promptCount.toLocaleString()} hint="from history" />
        <StatCard label="Memories" value={p.memoryCount} />
        <StatCard
          label="Tokens"
          value={shortCount(totalTokens(p.tokens))}
          hint={`${shortCount(p.tokens.output)} output`}
        />
        <StatCard label="Cost (recorded)" value={p.costUSD ? usd(p.costUSD) : '—'} hint="sessions with cost data" />
        <StatCard label="Last active" value={ago(p.lastActiveAt)} hint={date(p.lastActiveAt)} />
        <StatCard label="Transcripts" value={bytes(p.transcriptBytes)} />
      </div>
      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions ({data.sessions.length})</TabsTrigger>
          <TabsTrigger value="memory">Memory ({data.memory.items.length})</TabsTrigger>
          <TabsTrigger value="instructions">Instructions ({cfg.instructions.length})</TabsTrigger>
          <TabsTrigger value="config">Config ({configCount})</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="usage">Last session usage</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="pt-2">
          <DataTable
            data={data.sessions}
            columns={sessionColumns}
            searchText={s => `${s.title ?? ''} ${s.prompt ?? ''}`}
            initialSort={[{ id: 'lastAt', desc: true }]}
            empty="No transcripts for this project (they may have been deleted)."
          />
        </TabsContent>
        <TabsContent value="memory" className="space-y-3 pt-2">
          {data.memory.dir ? (
            <p className="text-[11px] text-muted-foreground">
              {data.memory.dir.hasIndex
                ? `MEMORY.md lists ${data.memory.dir.index.length} entries`
                : 'No MEMORY.md index'}
              {data.memory.dir.orphans.length ? ` · ${data.memory.dir.orphans.length} files not in the index` : ''}
              {data.memory.dir.dead.length ? ` · ${data.memory.dir.dead.length} index entries without a file` : ''}
            </p>
          ) : null}
          {data.memory.items.length === 0 ? (
            <Empty>No memories for this project.</Empty>
          ) : (
            <ul className="divide-y border">
              {data.memory.items.map(m => (
                <li key={m.file}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 p-3 text-left text-xs hover:bg-muted/50"
                    onClick={() => setMemory(m.file)}
                  >
                    <Tag tone={m.type ?? 'user'}>{m.type ?? 'untyped'}</Tag>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-muted-foreground">{m.description}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{ago(m.modified)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="instructions" className="pt-2">
          {cfg.instructions.length === 0 ? (
            <Empty>No CLAUDE.md / AGENTS.md at the project root.</Empty>
          ) : (
            <ul className="divide-y border">
              {cfg.instructions.map(f => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 p-3 text-left text-xs hover:bg-muted/50"
                    onClick={() => setInstruction(f.path)}
                  >
                    <Tag tone="project">{f.kind}</Tag>
                    <Mono className="flex-1 truncate">{f.displayPath}</Mono>
                    <span className="text-muted-foreground">{f.lines} lines</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="config" className="space-y-4 pt-2">
          <ProjectConfig data={data} />
        </TabsContent>
        <TabsContent value="map" className="pt-2">
          <ProjectMap id={p.id} />
        </TabsContent>
        <TabsContent value="usage" className="pt-2">
          {data.state ? (
            <Section
              title="Last session (from ~/.claude.json)"
              description="Claude Code records the totals of the most recent session per project."
            >
              <div className="space-y-4">
                <KeyValues
                  items={[
                    ['cost', usd(data.state.lastCost)],
                    ['lines', `+${data.state.lastLinesAdded ?? 0} / −${data.state.lastLinesRemoved ?? 0}`],
                    [
                      'session',
                      data.state.lastSessionId ? (
                        <Link
                          key="s"
                          to="/sessions/$id"
                          params={{ id: data.state.lastSessionId }}
                          className="underline"
                        >
                          {data.state.lastSessionId}
                        </Link>
                      ) : (
                        '—'
                      ),
                    ],
                    ['trust dialog accepted', data.state.hasTrustDialogAccepted ? 'yes' : 'no'],
                  ]}
                />
                <BarList
                  items={Object.entries(data.state.lastModelUsage).map(([model, u]) => ({
                    key: model,
                    label: `${modelLabel(model)} · ${usd(u.costUSD)}`,
                    value: u.outputTokens,
                  }))}
                  format={v => `${shortCount(v)} out`}
                />
              </div>
            </Section>
          ) : (
            <Empty>Not in ~/.claude.json.</Empty>
          )}
        </TabsContent>
      </Tabs>
      <DetailSheet open={memory !== null} onClose={() => setMemory(null)} title={memory ?? ''}>
        {memory ? <MemoryViewer projectId={p.id} file={memory} /> : null}
      </DetailSheet>
      <DetailSheet
        open={instruction !== null}
        onClose={() => setInstruction(null)}
        title={instruction?.split('/').pop() ?? ''}
      >
        {instruction ? <InstructionViewer path={instruction} /> : null}
      </DetailSheet>
    </>
  )
}

function ProjectConfig({ data }: { data: ProjectData }) {
  const cfg = data.config
  const blocks = [
    cfg.settings ? (
      <Section key="s" title=".claude/settings.json">
        <JsonView value={cfg.settings} className="max-h-96" />
      </Section>
    ) : null,
    cfg.settingsLocal ? (
      <Section key="sl" title=".claude/settings.local.json">
        <JsonView value={cfg.settingsLocal} className="max-h-96" />
      </Section>
    ) : null,
    cfg.mcp.length ? (
      <Section key="m" title="MCP servers" description="Values of env and headers are never shown.">
        <ul className="space-y-2 text-xs">
          {cfg.mcp.map(m => (
            <li key={m.id} className="flex flex-wrap items-center gap-2">
              <Dot
                on={m.enabled}
                title={m.enabled === null ? 'awaiting approval' : m.enabled ? 'enabled' : 'disabled'}
              />
              <span className="font-medium">{m.name}</span>
              <Tag>{m.scope}</Tag>
              <Mono>{m.url ?? [m.command, ...m.args].join(' ')}</Mono>
              {m.inlineSecrets.length ? <Tag tone="security">inline secret</Tag> : null}
            </li>
          ))}
        </ul>
      </Section>
    ) : null,
    cfg.plugins.length ? (
      <Section key="p" title="Plugins enabled here">
        <ul className="space-y-1 text-xs">
          {cfg.plugins.map(pl => (
            <li key={pl.id} className="flex items-center gap-2">
              <Dot on={pl.enabled} />
              <Link to="/plugins/$id" params={{ id: pl.id }} className="hover:underline">
                {pl.id}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    ) : null,
    cfg.hooks.length ? (
      <Section key="h" title="Hooks">
        <ul className="space-y-1.5 text-xs">
          {cfg.hooks.map(hk => (
            <li key={hk.id} className="flex flex-wrap items-center gap-2">
              <Tag tone="project">{hk.event}</Tag>
              {hk.matcher ? <Mono>{hk.matcher}</Mono> : null}
              <Mono className="break-all">{hk.command}</Mono>
            </li>
          ))}
        </ul>
      </Section>
    ) : null,
    cfg.agents.length || cfg.commands.length || cfg.skills.length ? (
      <Section key="d" title="Agents, commands & skills">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {cfg.agents.map(a => (
            <Tag key={a.id} tone="agents">
              agent: {a.name}
            </Tag>
          ))}
          {cfg.commands.map(c => (
            <Tag key={c.id} tone="user">
              {c.name}
            </Tag>
          ))}
          {cfg.skills.map(s => (
            <Tag key={s.id} tone="claude-ai">
              skill: {s.name}
            </Tag>
          ))}
        </div>
      </Section>
    ) : null,
  ].filter(Boolean)
  return blocks.length ? (
    <div className="grid gap-4 lg:grid-cols-2">{blocks}</div>
  ) : (
    <Empty>No project-level Claude configuration.</Empty>
  )
}
