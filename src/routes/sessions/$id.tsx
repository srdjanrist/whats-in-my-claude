import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ExternalLink, GitBranch, Waypoints } from 'lucide-react'
import { BarList, KeyValues, Mono, PageHeader, QueryView, Section, StatCard, Tag } from '@/components/common'
import { Conversation } from '@/components/conversation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type client, q, type Res } from '@/lib/api'
import { bytes, dateTime, duration, modelLabel, shortCount, totalTokens, usd } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionPage,
  validateSearch: (s: Record<string, unknown>): { agent?: string } =>
    typeof s.agent === 'string' ? { agent: s.agent } : {},
})

type SessionData = Res<(typeof client.api.sessions)[':id']['$get']>

function SessionPage() {
  const { id } = Route.useParams()
  const query = useQuery(q.session(id))
  return <QueryView query={query}>{data => <SessionBody data={data} />}</QueryView>
}

function SessionBody({ data }: { data: SessionData }) {
  const { agent } = Route.useSearch()
  const s = data.session
  const st = data.stats
  const toolCalls = Object.values(st.toolCalls).reduce((a, b) => a + b, 0)
  const selected = agent ? data.subagents.find(a => a.agentId === agent) : undefined
  return (
    <>
      <PageHeader
        title={s.title ?? s.id}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to="/projects/$id" params={{ id: s.projectDir }} className="font-mono hover:underline">
              {s.displayCwd ?? s.projectDir}
            </Link>
            {st.gitBranches.length ? (
              <span className="flex items-center gap-1">
                <GitBranch className="size-3" />
                {st.gitBranches.join(', ')}
              </span>
            ) : null}
            <Mono>{s.id}</Mono>
          </span>
        }
        actions={
          <>
            {st.versions.length ? <Badge variant="outline">Claude Code {st.versions.at(-1)}</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/sessions/$id/map" params={{ id: s.id }} />}
            >
              <Waypoints />
              Open session map
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Prompts" value={st.humanPrompts} />
        <StatCard label="Responses" value={st.assistantMessages.toLocaleString()} />
        <StatCard label="Tool calls" value={toolCalls.toLocaleString()} />
        <StatCard
          label="Tokens"
          value={shortCount(totalTokens(st.tokens))}
          hint={`${shortCount(st.tokens.output)} output`}
        />
        <StatCard
          label="Cost"
          value={st.cost ? usd(st.cost.costUSD) : '—'}
          hint={st.cost ? 'recorded by Claude Code' : 'not recorded'}
        />
        <StatCard
          label="Span"
          value={st.firstAt && st.lastAt ? duration(st.lastAt - st.firstAt) : '—'}
          hint={`${duration(st.workMs)} working`}
        />
        <StatCard label="Compactions" value={st.compactions} />
        <StatCard label="Transcript" value={bytes(s.size)} hint={`${st.lines.toLocaleString()} lines`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Details">
          <KeyValues
            items={[
              ['started', dateTime(st.firstAt)],
              ['last activity', dateTime(st.lastAt)],
              ['title source', s.titleSource],
              [
                'first prompt',
                <span key="p" className="line-clamp-4">
                  {s.prompt}
                </span>,
              ],
              ['permission modes', st.permissionModes.join(', ') || '—'],
              ['lines added / removed', st.cost ? `+${st.cost.linesAdded} / −${st.cost.linesRemoved}` : '—'],
              ['API errors', st.apiErrors],
              [
                'plan',
                data.plans.length
                  ? data.plans.map(p => (
                      <Link key={p.slug} to="/plans" search={{ open: p.slug }} className="block underline">
                        {p.title}
                      </Link>
                    ))
                  : '—',
              ],
              [
                'continued in',
                data.continuedIn ? (
                  data.continuedIn.exists ? (
                    <Link key="c" to="/sessions/$id" params={{ id: data.continuedIn.id }} className="underline">
                      {data.continuedIn.title ?? data.continuedIn.id}
                    </Link>
                  ) : (
                    <Mono key="c">{data.continuedIn.id}</Mono>
                  )
                ) : (
                  '—'
                ),
              ],
              [
                'file',
                <Mono key="f" className="break-all">
                  {s.file}
                </Mono>,
              ],
            ]}
          />
          {st.prLinks.length ? (
            <div className="mt-4 space-y-1 text-xs">
              <div className="text-muted-foreground">Pull requests</div>
              {st.prLinks.map(pr => (
                <a
                  key={pr.url}
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 underline"
                >
                  <ExternalLink className="size-3" />
                  {pr.repository ?? ''} #{pr.number}
                </a>
              ))}
            </div>
          ) : null}
        </Section>
        <Section title="Models">
          <BarList
            items={Object.entries(st.models).map(([model, m]) => ({
              key: model,
              label: `${modelLabel(model)} · ${m.messages} responses`,
              value: m.output,
            }))}
            format={v => `${shortCount(v)} out`}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <span className="text-muted-foreground">input</span>
            <span className="tabular-nums">{st.tokens.input.toLocaleString()}</span>
            <span className="text-muted-foreground">cache read</span>
            <span className="tabular-nums">{st.tokens.cacheRead.toLocaleString()}</span>
            <span className="text-muted-foreground">cache write</span>
            <span className="tabular-nums">{st.tokens.cacheWrite.toLocaleString()}</span>
            <span className="text-muted-foreground">output</span>
            <span className="tabular-nums">{st.tokens.output.toLocaleString()}</span>
          </div>
        </Section>
        <Section title="Tools">
          <BarList
            items={Object.entries(st.toolCalls)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 14)
              .map(([tool, n]) => ({ key: tool, label: <span className="font-mono">{tool}</span>, value: n }))}
          />
        </Section>
      </div>

      {data.subagents.length ? (
        <Section
          title={`Subagents (${data.subagents.length})`}
          description="Click one to read its own transcript below."
          actions={
            <Link
              to="/sessions/$id/map"
              params={{ id: s.id }}
              search={agent ? { agent } : {}}
              className="shrink-0 text-xs underline"
            >
              See how they connect on the map →
            </Link>
          }
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <Link
              to="/sessions/$id"
              params={{ id: s.id }}
              search={{}}
              resetScroll={false}
              className={cn('border p-2 text-xs hover:bg-muted/50', !agent && 'border-primary bg-primary/5')}
            >
              <div className="font-medium">Main conversation</div>
              <div className="text-[11px] text-muted-foreground">{s.title}</div>
            </Link>
            {data.subagents.map(a => (
              <Link
                key={a.agentId}
                to="/sessions/$id"
                params={{ id: s.id }}
                search={{ agent: a.agentId }}
                resetScroll={false}
                className={cn(
                  'border p-2 text-xs hover:bg-muted/50',
                  agent === a.agentId && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center gap-2">
                  <Tag tone="agents">{a.type ?? 'agent'}</Tag>
                  {a.isFork ? <Tag tone="user">fork</Tag> : null}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {a.tokens ? `${shortCount(totalTokens(a.tokens))} tok` : bytes(a.size)}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2">{a.description ?? a.agentId}</div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title={selected ? `Subagent: ${selected.description ?? selected.agentId}` : 'Conversation'}
        description="Tool calls, results, thinking and injected context are collapsed. Known token formats are masked."
      >
        <Conversation key={agent ?? 'main'} sessionId={s.id} agent={agent} />
      </Section>
    </>
  )
}
